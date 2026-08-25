// ==UserScript==
// @name         Garmin Connect → Strava: Upload new activities with one click
// @namespace    https://github.com/jshute96/userscripts
// @version      0.4.5
// @description  Adds an Upload to Strava button to Garmin's toolbar and an Upload from Garmin item to Strava's upload menu. Either sends all new rides you haven't uploaded yet.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://connect.garmin.com/*
// @match        https://www.strava.com/*
// @connect      connect.garmin.com
// @connect      www.strava.com
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_openInTab
// @grant        GM_registerMenuCommand
// @grant        window.onurlchange
// @grant        window.focus
// @noframes
// @run-at       document-idle
// ==/UserScript==

// One script, two origins. It reads Garmin's activity list and pulls
// each TCX with `GM_xmlhttpRequest`, which the manager runs from the
// extension — so the same three requests work identically from a Garmin
// tab and from a Strava tab.
//
// That means the Strava upload page can fetch the files itself. When
// the run starts on Strava, nothing leaves the tab: it downloads from
// Garmin and attaches the files to the form in one go, with no Garmin
// tab involved at all. When it starts from the button on Garmin, the
// only thing crossing between the two tabs is a short list of activity
// ids — the bytes never do.
//
// Two things had to be true for that, and neither is the default:
//
//   1. The request carries the user's Garmin cookies. `fetch` from a
//      service worker is anonymous unless the manager asks otherwise.
//   2. It carries `Sec-Fetch-Site: same-origin`. Cloudflare fronts
//      connect.garmin.com and rejects /gc-api/* at the edge without it,
//      and a service worker's fetch always says `none`. `Sec-` headers
//      are forbidden to all JS, so only a manager that routes them
//      around `fetch` can set it — see `garminApiHeaders`.
//
// Before both, the bytes had to be fetched in a Garmin tab and shuttled
// to Strava through GM storage, gzipped and a chunk at a time, because
// Garmin sends no CORS headers and 403s the preflight. That apparatus is
// what this version deletes.

(function () {
  'use strict';

  const TAG = '[garmin-dl]';

  // ------------------------------------------------------------ storage keys
  // All of these live in this script's GM storage, visible from both
  // connect.garmin.com and www.strava.com.

  // { requestId, activities: [{id, name}], ts } — the Garmin side asking
  // a Strava upload tab to fetch and upload these. Nothing but ids and
  // names; the tab that takes it does all the work.
  const K_REQUEST = 'request';
  // { requestId, who } — set by the first Strava tab to pick up a
  // request, so two open upload tabs don't both run it.
  const K_CLAIM = 'claim';
  // { requestId, done, total } — the working tab reporting how far it
  // has got, so the Garmin tab's status panel can follow along.
  const K_PROGRESS = 'progress';
  // { requestId, ok, count, error } — the outcome, so the Garmin side
  // can report it and stop waiting.
  const K_RESULT = 'result';
  // { ts, count } — files were just attached to Strava's upload form.
  // Written by whichever tab did it, on *both* paths: a run handed over
  // from Garmin has a requestId and reports through `result`, but a run
  // the Strava tab started itself has none, and an open Garmin tab still
  // needs to know its badges are stale. Deliberately not folded into
  // `result` for that reason.
  const K_UPLOADED = 'lastUpload';
  // { ts, message } — a note left for the sign-in page we're about to
  // open, so the explanation lands in the tab the user ends up looking at.
  const K_SIGNIN_HINT = 'signinHint';
  // { ts, activities: [{id, name}] } — a list this tab worked out on
  // some other Strava page, left for the upload page it is about to
  // navigate itself to. Not `request`: that key drives the claim
  // protocol between separate tabs, and this is one tab handing work to
  // its own next page load, which nobody else should take.
  const K_PENDING = 'pendingUpload';

  // How long the Garmin side waits for a Strava tab to finish. Only a
  // backstop against a tab that was closed mid-run: the status panel is
  // driven by K_PROGRESS, so a slow-but-alive transfer still looks alive.
  const RESULT_TIMEOUT_MS = 10 * 60 * 1000;
  // How long to let an already-open Strava upload tab claim a request
  // before we open one ourselves. An open tab only needs a storage
  // round-trip.
  const CONSUMER_GRACE_MS = 2500;
  // How long to let a claim propagate before re-reading it to see who
  // won. Must comfortably exceed the manager's write debounce (150 ms in
  // SourceMonkey) plus the service-worker round trip and broadcast.
  const CLAIM_SETTLE_MS = 600;
  // Ignore a request left behind by a run that died half way through.
  const REQUEST_STALE_MS = 15 * 60 * 1000;
  // Ignore a handoff left behind by a navigation that never arrived —
  // the user cancelled it, or went somewhere else instead. Short,
  // because the only legitimate gap is one page load.
  const PENDING_STALE_MS = 2 * 60 * 1000;
  // How long to let Strava turn accepted files into listed activities
  // before asking it what it has. Only affects how soon the New badges
  // clear; the next page load would fix them anyway.
  const UPLOAD_SETTLE_MS = 8000;
  // How long an answer about what's on Strava stays good enough to
  // repaint from without asking again. Only bounds how often navigating
  // back to the Activities list costs two requests; an upload refreshes
  // regardless of it.
  const BADGE_FRESH_MS = 60 * 1000;
  // Strava's list endpoint caps a page at 20 however large a `per_page`
  // we ask for (measured), so the only way to reach further back is more
  // requests. The cap is the backstop: 5 pages covers 100 Strava
  // activities, which is a lot of non-Garmin rides to have interleaved
  // into the window Garmin's newest 20 span. Hitting it is reported, not
  // silently absorbed — see stravaStarts.
  const STRAVA_PAGE_SIZE = 20;
  const STRAVA_MAX_PAGES = 5;
  // How far apart two start times may be and still be the same ride.
  // Measured across twelve consecutive activities, every Garmin
  // `startTimeGMT` matched its Strava `start_time` exactly, to the
  // second — the recording's start timestamp passes through the file
  // unchanged. The tolerance is only insurance against either side
  // changing how it rounds.
  const START_TOLERANCE_MS = 2000;
  // The window: how many of the most recent activities the script
  // considers at all, for both uploading and badging.
  //
  // 20 because that is exactly what Garmin's own list uses — measured,
  // its page requests `limit=20&start=0` and renders 20 rows before any
  // scrolling. (The API's own default, with no `limit`, is 99.) Matching
  // it keeps "what has a New badge" and "what an upload would send" the
  // same set, which is the whole point of the badges.
  //
  // The Activities page is infinite-scroll, not paged, so this has to be
  // enforced on the badge side too — see refreshNewBadges. Without that,
  // scrolling appends rows older than anything in the history and every
  // one of them gets marked New, promising an upload that would never
  // include them.
  const LIST_LIMIT = 20;

  // --------------------------------------------------------------- shared

  // `ms = 0` makes the notice stay until it's clicked. Use that for
  // anything the user has to act on — a timed toast in a tab they haven't
  // switched to yet is a message nobody reads.
  function toast(message, ms = 6000) {
    const el = document.createElement('div');
    el.textContent = message;
    Object.assign(el.style, {
      position: 'fixed', zIndex: '2147483647', top: '16px', right: '16px',
      maxWidth: '380px', padding: '10px 14px', borderRadius: '6px',
      background: 'rgba(20,20,20,0.92)', color: '#fff',
      font: '400 13px/18px "Open Sans", Helvetica, Arial, sans-serif',
      boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
      pointerEvents: ms > 0 ? 'none' : 'auto',
    });
    if (ms > 0) {
      setTimeout(() => el.remove(), ms);
    } else {
      el.style.cursor = 'pointer';
      el.title = 'Click to dismiss';
      el.addEventListener('click', () => el.remove());
    }
    document.body.appendChild(el);
  }

  // A single panel that stays put and gets rewritten as the transfer
  // moves along, rather than a series of toasts that each vanish. The
  // Strava upload page in particular is blank while it downloads, and
  // gives no other sign that anything is happening — or that the tab is
  // the right one to be looking at.
  const STATUS_ID = 'jshute-garmin-strava-status';

  function setStatus(message, options = {}) {
    const { done = false, error = false } = options;
    let el = document.getElementById(STATUS_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = STATUS_ID;
      Object.assign(el.style, {
        position: 'fixed', zIndex: '2147483647', top: '16px', right: '16px',
        maxWidth: '380px', padding: '10px 14px', borderRadius: '6px',
        color: '#fff', cursor: 'pointer',
        font: '400 13px/18px "Open Sans", Helvetica, Arial, sans-serif',
        boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
      });
      el.title = 'Click to dismiss';
      el.addEventListener('click', () => el.remove());
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.style.background = error ? 'rgba(140,26,26,0.94)'
      : done ? 'rgba(26,102,46,0.94)' : 'rgba(20,20,20,0.92)';
    // Successful endings clear themselves; anything the user needs to
    // read and act on stays until clicked.
    if (el.dataset.clearTimer) clearTimeout(Number(el.dataset.clearTimer));
    if (done) {
      el.dataset.clearTimer = String(setTimeout(() => el.remove(), 10000));
    }
  }

  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  // Elapsed time since a performance.now() mark, for the timing in the
  // logs. Most of a run is Garmin's export endpoint generating and
  // shipping several MB of XML — measured at ~1s per ride — so when this
  // feels slow the logs should say where the time actually went.
  const since = (mark) => {
    const ms = performance.now() - mark;
    return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
  };

  // Resolve when `key`'s value satisfies `predicate`, checking the current
  // value first so we don't miss a write that landed before we listened.
  function waitForValue(key, predicate, timeoutMs) {
    return new Promise((resolve, reject) => {
      const current = GM_getValue(key);
      if (predicate(current)) return resolve(current);
      let settled = false;
      const listenerId = GM_addValueChangeListener(key, (k, oldV, newV) => {
        if (settled || !predicate(newV)) return;
        settled = true;
        GM_removeValueChangeListener(listenerId);
        clearTimeout(timer);
        resolve(newV);
      });
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        GM_removeValueChangeListener(listenerId);
        reject(new Error(`timed out waiting for "${key}"`));
      }, timeoutMs);
    });
  }

  // =====================================================================
  //                        Talking to Garmin's API
  // =====================================================================
  //
  // These three requests are the entire Garmin side of the feature, and
  // they run the same way from either origin. `GM_xmlhttpRequest` issues
  // them from the extension rather than the page, which both sidesteps
  // CORS (Garmin sends no Access-Control-* headers and answers a
  // preflight with 403) and — as of the manager's credentialed-by-default
  // behavior — carries the user's Garmin cookies.

  const GARMIN_ORIGIN = 'https://connect.garmin.com';
  const ACTIVITIES_PATH = '/app/activities';
  const ACTIVITIES_URL = GARMIN_ORIGIN + ACTIVITIES_PATH;
  const GARMIN_SIGNIN_URL = GARMIN_ORIGIN + '/signin/';

  // Declared here rather than in the Strava section below because both
  // halves use them, and because SIGNIN_PAGES is built at load time —
  // referencing a `const` declared further down throws before the script
  // has done anything.
  const STRAVA_UPLOAD_URL = 'https://www.strava.com/upload/select';
  const STRAVA_LOGIN_URL = 'https://www.strava.com/login';
  const STRAVA_ORIGIN = 'https://www.strava.com';

  const hostLabel = (url) => (/strava\.com/.test(url) ? 'Strava' : 'Garmin');

  // GM_xmlhttpRequest is callback-shaped. Everything below wants a
  // promise, and wants a non-2xx to stay a resolved response (each
  // caller reads the status itself) while a transport failure rejects.
  function gmFetch(url, options = {}) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: options.method || 'GET',
        url,
        headers: options.headers,
        responseType: options.responseType,
        timeout: options.timeoutMs || 120000,
        onload: resolve,
        // Named from the URL rather than hardcoded: this serves both
        // sites, and "couldn't reach Garmin" for a Strava outage sends
        // debugging the wrong way.
        onerror: (err) => reject(new Error(
          `couldn't reach ${hostLabel(url)} ` +
          `(${(err && err.message) || 'network error'})`)),
        ontimeout: () => reject(new Error(`${hostLabel(url)} took too long to answer`)),
      });
    });
  }

  // The token lives in a <meta> on every server-rendered Garmin page.
  const extractCsrf = (html) => {
    const meta = (html.match(/<meta[^>]*name="csrf-token"[^>]*>/i) || [])[0] || '';
    return (meta.match(/content="([^"]+)"/i) || [])[1] || '';
  };

  function signedOutError(where) {
    const err = new Error(`You're not signed in to ${where}`);
    err.signedOutOf = where;
    return err;
  }

  // The activities page is a server-rendered 8 KB shell — the list itself
  // arrives later over the API — and it carries the two things the API
  // wants: the session's CSRF token in a <meta>, and the app version in
  // the ?bust= query on its own asset URLs. Signed out, the same request
  // 302s to /signin/ and the token isn't there, which is how both sides
  // detect a lapsed Garmin session.
  async function garminSession() {
    // `GM_xmlhttpRequest` has no `cache` option, so ask for revalidation
    // the HTTP way. Garmin sends no caching headers on this page at all,
    // which leaves it open to heuristic caching — and a token read from
    // a cached copy would look perfectly valid while belonging to a
    // session the request never actually established.
    const response = await gmFetch(ACTIVITIES_URL,
      { headers: { 'Cache-Control': 'no-cache' } });
    const html = response.responseText || '';
    const csrf = extractCsrf(html);
    if (/\/signin/.test(response.finalUrl || '') || !csrf) {
      console.log(TAG, 'Garmin sent us to the sign-in page');
      throw signedOutError('Garmin');
    }
    const bust = (html.match(/bust=([\d.]+)/) || [])[1];
    console.log(TAG, `Garmin session ok (app version ${bust || 'unknown'})`);
    return { csrf, bust };
  }

  // Connect-Csrf-Token is the one Garmin's own server enforces — without
  // it every gc-api call answers 403. X-app-ver isn't checked today, but
  // Garmin's own client always sends it and we have the value for free.
  //
  // Sec-Fetch-Site is the one that isn't Garmin's at all. Cloudflare
  // fronts connect.garmin.com and rejects /gc-api/* at the edge unless
  // the request says `same-origin` — the response comes back 403 with an
  // empty body and no `cf-cache-status`, never reaching Garmin. A
  // service worker's fetch always says `none`, a value no page can
  // produce, so without this every call fails no matter how right the
  // cookies and the token are. (`/app/activities` isn't covered by the
  // rule, which is why the session fetch above needs none of this.)
  //
  // `Sec-` headers are forbidden to all JS — fetch() strips them in the
  // service worker exactly as on a page — so this only works on a
  // manager that routes them around fetch. SourceMonkey compiles them
  // into a declarativeNetRequest rule; see its issue #21.
  function garminApiHeaders(session) {
    return {
      'Connect-Csrf-Token': session.csrf,
      'X-app-ver': session.bust || '5.27.2.1',
      'Sec-Fetch-Site': 'same-origin',
    };
  }

  // Newest first, same order and length as the list page shows.
  async function garminList(session, limit = LIST_LIMIT) {
    const url = `${GARMIN_ORIGIN}/gc-api/activitylist-service/activities/` +
      `search/activities?limit=${limit}&start=0`;
    const response = await gmFetch(url, {
      headers: garminApiHeaders(session), responseType: 'json',
    });
    if (response.status !== 200) {
      throw new Error(`couldn't read the Garmin activity list (HTTP ${response.status})`);
    }
    const rows = Array.isArray(response.response) ? response.response : [];
    return rows.map((a) => ({
      id: String(a.activityId),
      name: (a.activityName || '').trim() || 'activity',
      // "2026-08-15 17:10:28", UTC despite carrying no zone. This is the
      // recording's own start timestamp, and the only field that
      // survives the trip to Strava unaltered — see stravaStarts.
      start: Date.parse(String(a.startTimeGMT || '').replace(' ', 'T') + 'Z'),
    }));
  }

  // Strava's activity list, as its own /athlete/training page reads it.
  //
  // `X-Requested-With` is the whole of what it wants — no CSRF token, no
  // `Sec-Fetch-Site` override, and it answers a cross-origin
  // GM_xmlhttpRequest from a Garmin tab as the signed-in user (measured;
  // unlike Garmin's /gc-api, nothing here is fronted by an edge that
  // rejects an extension-shaped request). Which means one code path
  // serves both origins.
  //
  // Without that header the endpoint does not fail — it returns 200 and
  // the training page's HTML, because the URL is also a real page. So
  // "did it parse as JSON" is the only honest success test, and it
  // doubles as the signed-out test: signed out, this is a login page.
  async function stravaPage(page) {
    const url = `${STRAVA_ORIGIN}/athlete/training_activities` +
      '?keywords=&activity_type=&workout_type=&commute=&new_activity_only=false' +
      `&page=${page}&per_page=${STRAVA_PAGE_SIZE}`;
    const response = await gmFetch(url, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    let models = null;
    try {
      models = JSON.parse(response.responseText || '').models;
    } catch { /* HTML, not JSON — handled below */ }
    if (!Array.isArray(models)) {
      const err = new Error(response.status === 200
        ? "Strava answered with a page instead of the activity list, which " +
          'usually means the session has lapsed'
        : `couldn't read the Strava activity list (HTTP ${response.status})`);
      err.signedOutOf = 'Strava';
      throw err;
    }
    const starts = models.map((m) => Date.parse(m.start_time)).filter(Number.isFinite);
    if (starts.length !== models.length) {
      console.log(TAG, `${models.length - starts.length} of ${models.length} Strava ` +
        "activities on page had no readable start_time; they can't be matched");
    }
    // `count` is what Strava sent, `starts` what we could read. They are
    // not interchangeable: a short page means the end of the list, and
    // deciding that from `starts` would let one unreadable timestamp
    // stop the paging and claim we had read everything.
    return { starts, count: models.length };
  }

  // Every Strava start time back to `needed`, newest first.
  //
  // Strava holds activities from anywhere, not just Garmin, so there is
  // no fixed number of pages that covers a given stretch of Garmin's
  // list — we page until the times run past `needed`. `covered` is the
  // oldest moment this answer can speak for: -Infinity when we reached
  // the end of Strava's list, otherwise the oldest time we actually
  // read. Beyond it we know nothing, and the caller must not guess.
  async function stravaStarts(needed) {
    const starts = [];
    // Only a page we stopped *early* on bounds what we know. Running off
    // the end of the list, or past `needed`, leaves nothing unread that
    // could have mattered — so `covered` is only assigned when we give
    // up with pages still to go.
    let covered = -Infinity;
    let capped = false;
    for (let page = 1; page <= STRAVA_MAX_PAGES; page += 1) {
      const { starts: times, count } = await stravaPage(page);
      starts.push(...times);
      if (count < STRAVA_PAGE_SIZE) break; // the end of the list
      const oldest = times.length ? Math.min(...times) : -Infinity;
      if (oldest <= needed) break;
      if (page === STRAVA_MAX_PAGES) {
        covered = oldest;
        capped = true;
      }
    }
    console.log(TAG, `Strava lists ${starts.length} activities back to ` +
      (covered === -Infinity ? 'the start of the account' : new Date(covered).toISOString()));
    if (capped) {
      console.log(TAG, `stopped at the ${STRAVA_MAX_PAGES}-page cap without reaching ` +
        'the far end of the Garmin list; older Garmin activities are left unjudged');
    }
    return { starts, covered };
  }

  // The same endpoint Garmin's own "Export to TCX" menu item uses.
  async function fetchTcx(session, id) {
    const url = `${GARMIN_ORIGIN}/gc-api/download-service/export/tcx/activity/${id}`;
    const response = await gmFetch(url, {
      headers: garminApiHeaders(session), responseType: 'blob',
    });
    if (response.status !== 200) {
      throw new Error(`export failed for activity ${id} (HTTP ${response.status})`);
    }
    return response.response;
  }

  // Everything here rides on GM_xmlhttpRequest reaching Garmin as the
  // signed-in user *and* getting past Cloudflare, neither of which is
  // visible from the page. Both failures look the same from outside: a
  // 403 with an empty body. This tells them apart.
  //
  //  * `csrfAndSameOrigin` 200 while `csrfOnly` 403 => working normally.
  //    Both gates are real and independent, which is the point of
  //    running the two side by side.
  //  * `csrfAndSameOrigin` also 403 => the Sec-Fetch-Site override isn't
  //    reaching the wire. That's the manager's header surgery, not this
  //    script — see SourceMonkey issue #21.
  //  * a token that doesn't match the tab's => the extension's requests
  //    are in a different session from the tab's.
  //  * the activities page itself failing, or landing on /signin =>
  //    not signed in to Garmin at all.
  // Registered on Garmin only. Every request it makes goes to Garmin and
  // works identically from either origin, so putting it in the menu on
  // Strava as well only adds a Garmin-shaped command to every Strava
  // page. Run it from a Garmin tab — which is also the only place its
  // token comparison means anything.
  function registerDiagnostic() {
    GM_registerMenuCommand('Diagnose Garmin API access', async () => {
      const report = {};
      const dump = (label, value) => {
        report[label] = value;
        console.log(TAG, `diagnose ${label}:`, value);
      };
      try {
        const page = await gmFetch(ACTIVITIES_URL);
        const html = page.responseText || '';
        const csrf = extractCsrf(html);
        dump('activities page', {
          status: page.status, finalUrl: page.finalUrl, htmlLength: html.length,
        });
        // The token is session-bound and stable, so the extension's copy
        // matching this tab's is proof they're the same session.
        const inPage = document.querySelector('meta[name="csrf-token"]');
        dump('csrf token', {
          fromExtension: csrf ? `${csrf.slice(0, 8)}… (${csrf.length} chars)` : '(none found)',
          inThisTab: inPage ? `${inPage.content.slice(0, 8)}… (${inPage.content.length} chars)`
            : '(no token on this page)',
          same: inPage ? csrf === inPage.content : 'n/a',
        });

        const listUrl = `${GARMIN_ORIGIN}/gc-api/activitylist-service/activities/` +
          'search/activities?limit=1&start=0';
        for (const [label, headers] of Object.entries({
          noHeaders: {},
          csrfOnly: { 'Connect-Csrf-Token': csrf },
          sameOriginOnly: { 'Sec-Fetch-Site': 'same-origin' },
          // The four together are a 2x2 over the two gates, so the report
          // says which one is refusing rather than just that something is.
          csrfAndSameOrigin: { 'Connect-Csrf-Token': csrf, 'Sec-Fetch-Site': 'same-origin' },
        })) {
          const r = await gmFetch(listUrl, { headers });
          dump(`list (${label})`, {
            status: r.status, body: (r.responseText || '').slice(0, 200),
          });
        }
        // A second gc-api endpoint, with the headers a real call uses,
        // to show the fix isn't specific to the activity list.
        const profile = await gmFetch(
          `${GARMIN_ORIGIN}/gc-api/userprofile-service/socialProfile`,
          { headers: { 'Connect-Csrf-Token': csrf, 'Sec-Fetch-Site': 'same-origin' } });
        dump('social profile', {
          status: profile.status, body: (profile.responseText || '').slice(0, 120),
        });
      } catch (err) {
        dump('threw', (err && err.message) || String(err));
      }
      console.log(TAG, 'diagnose report:', JSON.stringify(report, null, 2));
      toast('Garmin API diagnosis written to the console.', 0);
    });

  }

  // =====================================================================
  //                       What counts as "new"
  // =====================================================================

  // Which of `listed` are not on Strava yet, oldest first so Strava
  // lists them in the order they happened, plus the ones we can't say
  // either way about.
  //
  // The join is the start timestamp. Nothing else survives the trip:
  // Strava recomputes moving time (2:46:18 against Garmin's 2:50:03 on
  // one measured ride) and elevation (960 m against 946 m), and trims
  // distance by a few meters. The start second is the recording's own,
  // and matched exactly on every activity we compared.
  function splitByStrava(listed, index) {
    const fresh = [];
    const unjudged = [];
    for (const activity of listed) {
      if (!Number.isFinite(activity.start) || activity.start < index.covered) {
        unjudged.push(activity);
      } else if (!index.has(activity.start)) {
        fresh.push(activity);
      }
    }
    return { fresh: fresh.reverse(), unjudged };
  }

  // Start times bucketed by second, so a lookup can sweep the tolerance
  // window without scanning the list.
  function startIndex({ starts, covered }) {
    const seconds = new Set(starts.map((t) => Math.round(t / 1000)));
    const slack = Math.round(START_TOLERANCE_MS / 1000);
    return {
      covered,
      has(ms) {
        const second = Math.round(ms / 1000);
        for (let d = -slack; d <= slack; d += 1) if (seconds.has(second + d)) return true;
        return false;
      },
    };
  }

  // The one question both sides ask: given Garmin's newest activities,
  // which are missing from Strava? Answered from the two lists every
  // time, so it is the same answer in every browser and on every
  // machine, and repairs itself after an upload made anywhere else.
  async function diffAgainstStrava(listed) {
    if (!listed.length) return { fresh: [], unjudged: [] };
    const oldest = Math.min(...listed.map((a) => a.start).filter(Number.isFinite));
    const index = startIndex(await stravaStarts(Number.isFinite(oldest) ? oldest : Date.now()));
    const split = splitByStrava(listed, index);
    if (split.unjudged.length) {
      console.log(TAG, `${split.unjudged.length} Garmin ` +
        `${split.unjudged.length === 1 ? 'activity is' : 'activities are'} older than ` +
        'anything we read from Strava; leaving them alone');
    }
    return split;
  }

  // Shared error reporting. A lapsed session on either site is the one
  // failure the user can actually do something about, so it gets the
  // sign-in page opened in front of them rather than a line of red text
  // in a tab they may not be looking at.
  //
  // `escalate: false` reports without opening anything. A Strava tab
  // serving a request from the Garmin button passes it: the failure
  // travels back over `result` and the tab the user actually clicked in
  // does the escalating, so one lapsed session opens one sign-in tab
  // rather than one per tab involved.
  const SIGNIN_PAGES = {
    Garmin: GARMIN_SIGNIN_URL,
    Strava: STRAVA_LOGIN_URL,
  };

  function reportFailure(err, context, options = {}) {
    const { escalate = true } = options;
    const message = (err && err.message) || 'unknown error';
    const site = err && err.signedOutOf;
    console.log(TAG, `${context}:`, message);
    if (site && SIGNIN_PAGES[site]) {
      setStatus(`${message}. Sign in on the ${site} tab, then try again.`, { error: true });
      if (!escalate) return;
      GM_setValue(K_SIGNIN_HINT, {
        ts: Date.now(),
        message: `Sign in to ${site}, then start the upload again.`,
      });
      GM_openInTab(SIGNIN_PAGES[site], { active: true, setParent: true });
      return;
    }
    setStatus(`Upload failed: ${message}. Nothing was recorded as sent — try again.`,
      { error: true });
  }

  // =====================================================================
  //                          Garmin Connect side
  // =====================================================================

  const GARMIN_APP_RE = /^\/app(\/|$)/;

  const ACTIVITIES_BUTTON_ID = 'jshute-garmin-activities-btn';
  const UPLOAD_BUTTON_ID = 'jshute-garmin-upload-to-strava-btn';

  // The CSS-module class names have build-hash suffixes
  // (e.g. TopHeaderBarView_navToggle__WzQWw); match by stable prefix.
  const TOGGLE_SELECTOR = 'button[class*="TopHeaderBarView_navToggle"]';

  let garminAppStarted = false;

  function initGarmin() {
    console.log(TAG, 'init on', location.pathname);
    // `@match` is the whole site, but we only act under /app/*. The
    // initial document can easily be somewhere else — the root, or the
    // sign-in page — and Garmin's SPA then routes into /app/* by
    // pushState with no reload. Without re-dispatching on URL changes the
    // buttons would never appear in that tab, which is the trap CLAUDE.md
    // describes under "SPA sites: broaden @match, gate inside the script".
    // Outside the /app/* gate below: the page we send a signed-out user
    // to is /signin/, which onGarminUrl() returns early for. Gating this
    // on /app/* means the note explaining why they're looking at a login
    // page never appears on the login page.
    showSigninHint();

    window.addEventListener('urlchange', onGarminUrl);
    onGarminUrl();

    // An upload that ran entirely on the Strava side still changes what
    // counts as new here. Invalidate first and re-ask second: the
    // invalidation is what makes this correct on a tab that isn't
    // looking at the Activities list right now, since the deferred
    // refresh below would find the wrong path and do nothing. Strava
    // needs a moment to turn an accepted file into a listed activity,
    // hence the delay before asking.
    GM_addValueChangeListener(K_UPLOADED, (key, oldV, newV) => {
      if (!newV) return;
      invalidateBadgeState();
      setTimeout(() => refreshBadgeState(true), UPLOAD_SETTLE_MS);
    });

    // Second trigger for the gear-menu item, independent of the
    // MutationObserver. The observer is the main path, but whether its
    // callback lands after React has finished building the menu depends
    // on how the render batches — and if it lands early, the menu is
    // fully rendered with no further mutation to retry on, so the item
    // silently never appears. Retrying briefly after a click on the gear
    // closes that window without polling. Registered once, globally, and
    // self-gating on the path (CLAUDE.md → SPA sites).
    document.addEventListener('click', (event) => {
      if (!ACTIVITY_PATH_RE.test(location.pathname)) return;
      const container = document.querySelector(GEAR_CONTAINER_SELECTOR);
      if (!container || !container.contains(event.target)) return;
      // ensureActivityMenuItem is idempotent, so extra passes are no-ops.
      for (const delay of [0, 60, 200, 500]) setTimeout(ensureActivityMenuItem, delay);
    }, true);
  }

  function onGarminUrl() {
    if (!GARMIN_APP_RE.test(location.pathname)) {
      console.log(TAG, `${location.pathname} is outside /app/; waiting for the app`);
      return;
    }
    // Outside the one-time init below, because arriving at the
    // Activities list by SPA navigation is the common case — the toolbar
    // button does exactly that — and the init guard would swallow it.
    // It self-gates on the path and on how old the last answer is.
    refreshBadgeState();
    if (garminAppStarted) return;
    garminAppStarted = true;
    sweepStaleRequest();
    installButtons();
    registerDiagnostic();
  }

  // A run that dies without reporting — tab closed, navigated away —
  // leaves a request parked in storage that a later Strava upload tab
  // would otherwise pick up and act on. Sweep on init.
  function sweepStaleRequest() {
    const request = GM_getValue(K_REQUEST, null);
    if (!request || !request.ts) return;
    const age = Date.now() - request.ts;
    if (age <= REQUEST_STALE_MS) return;
    console.log(TAG, `clearing an abandoned request from ${Math.round(age / 60000)} ` +
      'minutes ago');
    clearRequestKeys();
  }

  // ------------------------------------------------------------- badges

  // A "New" pill on each listed activity we haven't uploaded, so the list
  // itself says what the next click will send.
  const BADGE_CLASS = 'jshute-garmin-new-badge';
  // The row, and the second line within it holding the activity-type
  // button. The `__` guards against also matching activityTypeButton.
  const ROW_SELECTOR = '[class*="ActivityListItem_listItem__"]';
  const TYPE_LINE_SELECTOR = '[class*="ActivityListItem_activityType__"]';

  function makeBadge() {
    const badge = document.createElement('span');
    badge.className = BADGE_CLASS;
    badge.textContent = 'New';
    badge.title = "Not uploaded to Strava yet — this is one of the activities " +
      'Upload to Strava will send.';
    Object.assign(badge.style, {
      display: 'inline-block', marginLeft: '8px', padding: '0 6px',
      borderRadius: '8px',
      // Strava orange, so the badge reads as "bound for Strava" rather
      // than as something Garmin is telling you.
      background: '#fc4c02', color: '#fff',
      font: '600 10px/16px "Open Sans", Helvetica, Arial, sans-serif',
      textTransform: 'uppercase', letterSpacing: '0.04em',
      verticalAlign: 'middle', whiteSpace: 'nowrap',
    });
    return badge;
  }

  function rowActivityId(row) {
    const link = row.querySelector('a[href*="/app/activity/"]');
    if (!link) return null;
    return ((link.getAttribute('href') || '').match(/\/app\/activity\/(\d+)/) || [])[1] || null;
  }

  // The last answer from diffAgainstStrava, as ids: which rows to badge,
  // and which rows the answer covers at all. The badges are driven by a
  // MutationObserver that fires many times a second while the list
  // renders, and the answer costs two sites' worth of requests — so it
  // is fetched on a schedule of its own (refreshBadgeState) and read
  // from here. `null` until the first fetch lands, which badges nothing.
  let badgeState = null;

  // Bumped whenever something makes the current answer wrong. A fetch
  // reads it on the way in and drops its result if it changed while the
  // requests were in flight — otherwise an upload landing mid-fetch is
  // overwritten by an answer that predates it, and the badges stay
  // wrong until the next navigation.
  let badgeGeneration = 0;

  function invalidateBadgeState() {
    badgeState = null;
    badgeGeneration += 1;
    refreshNewBadges();
  }

  // Ask both sites again and repaint. Cheap enough to run on arriving at
  // the list and after an upload, too expensive to run per mutation — or
  // per lap of someone paging between Activities and a ride, hence the
  // freshness window. `force` is for the one caller that knows the
  // answer just changed: the upload that changed it.
  let badgeFetchInFlight = false;
  let badgeFetchPending = false;
  async function refreshBadgeState(force = false) {
    // The badges are the only consumer, and they exist on one page.
    if (location.pathname !== ACTIVITIES_PATH) return false;
    if (badgeFetchInFlight) {
      // Queue rather than drop: the in-flight answer is the one this
      // call is trying to replace, so returning here would leave the
      // badges on the stale side until the next navigation.
      badgeFetchPending = badgeFetchPending || force;
      return false;
    }
    if (!force && badgeState && Date.now() - badgeState.at < BADGE_FRESH_MS) {
      refreshNewBadges();
      return true;
    }
    badgeFetchInFlight = true;
    const generation = badgeGeneration;
    try {
      const listed = await garminList(await garminSession());
      const { fresh, unjudged } = await diffAgainstStrava(listed);
      if (generation !== badgeGeneration) {
        console.log(TAG, 'an upload landed while we were asking; dropping this answer');
        return false;
      }
      badgeState = {
        at: Date.now(),
        fresh: new Set(fresh.map((a) => a.id)),
        judged: new Set(listed.filter((a) => !unjudged.includes(a)).map((a) => a.id)),
      };
      console.log(TAG, `${fresh.length} of ${listed.length} listed activities ` +
        'are not on Strava yet');
      refreshNewBadges();
      return true;
    } catch (err) {
      // Quietly: this runs on every load of the activities page, and a
      // lapsed session is not worth a sign-in tab the user didn't ask
      // for. Clicking Upload to Strava reports it properly.
      console.log(TAG, "couldn't work out what's new:", (err && err.message) || err);
      return false;
    } finally {
      badgeFetchInFlight = false;
      if (badgeFetchPending) {
        badgeFetchPending = false;
        refreshBadgeState(true);
      }
    }
  }

  // Idempotent, and safe to call as often as the observer fires: it adds
  // and removes only where the row disagrees with the last answer.
  function refreshNewBadges() {
    if (location.hostname !== 'connect.garmin.com') return;
    if (location.pathname !== ACTIVITIES_PATH) return;
    const rows = document.querySelectorAll(ROW_SELECTOR);
    if (!rows.length) return;
    let added = 0;
    let removed = 0;
    let index = -1;
    for (const row of rows) {
      index += 1;
      const id = rowActivityId(row);
      // Rows past the window are outside what an upload looks at, and
      // the history says nothing about them either way — scrolling far
      // enough back always reaches activities from before the script was
      // installed. Badging those would advertise an upload that isn't
      // going to happen. Rows arrive newest-first, same order as the API,
      // so position is the window.
      const inWindow = index < LIST_LIMIT;
      const wanted = inWindow && !!id && !!badgeState
        && badgeState.judged.has(id) && badgeState.fresh.has(id);
      const existing = row.querySelector('.' + BADGE_CLASS);
      if (wanted && !existing) {
        const typeLine = row.querySelector(TYPE_LINE_SELECTOR);
        if (!typeLine) continue;
        // The type button is display:flex, so it takes the whole line and
        // an inline sibling drops underneath it. Make the line itself a
        // flex row so the badge sits alongside. The button shrinks to its
        // content width, which is what it looks like anyway.
        typeLine.style.display = 'flex';
        typeLine.style.alignItems = 'center';
        typeLine.appendChild(makeBadge());
        added += 1;
      } else if (!wanted && existing) {
        const typeLine = existing.parentElement;
        existing.remove();
        // Undo the flex we forced on for the badge's sake, so a row we no
        // longer mark is left exactly as Garmin laid it out.
        if (typeLine && !typeLine.querySelector('.' + BADGE_CLASS)) {
          typeLine.style.display = '';
          typeLine.style.alignItems = '';
        }
        removed += 1;
      }
    }
    if (added || removed) {
      const beyond = rows.length > LIST_LIMIT
        ? `; ${rows.length - LIST_LIMIT} scrolled-in rows past the newest ${LIST_LIMIT} left alone`
        : '';
      console.log(TAG, `New badges: ${added} added, ${removed} removed${beyond}`);
    }
  }

  // ----------------------------------------------------------- the run

  // Fetch both lists and diff them. Shared, because either side may be
  // the one that starts a run, and both reach both sites the same way.
  async function newActivities(session) {
    const listed = await garminList(session);
    console.log(TAG, `Garmin lists ${listed.length} recent activities`);
    const { fresh, unjudged } = await diffAgainstStrava(listed);
    if (!fresh.length) {
      console.log(TAG, 'no new activities');
      // "Everything is on Strava" would be a lie whenever some rides
      // were left unjudged — the page cap was hit, or a start time
      // wouldn't parse. Say what we actually checked.
      setStatus(unjudged.length
        ? `No new activities among the ${listed.length - unjudged.length} we could ` +
          `check. ${plural(unjudged.length, 'activity is', 'activities are')} older ` +
          "than anything read from Strava, and weren't checked — see the console."
        : 'No new activities to send — everything Garmin lists is already on Strava.',
        { done: true });
    } else {
      console.log(TAG, `${plural(fresh.length, 'new activity', 'new activities')}:`,
        fresh.map((a) => a.id).join(', '));
    }
    return fresh;
  }

  // Prefer a Strava upload tab that's already open. Only if nobody claims
  // within the grace period do we open a tab of our own.
  async function ensureConsumer(requestId) {
    try {
      await waitForValue(K_CLAIM, (v) => v && v.requestId === requestId, CONSUMER_GRACE_MS);
      // No status update: the tab that claimed it raises itself (see
      // tryClaim), so by now the user is looking at it, not at this.
      console.log(TAG, 'an open Strava upload tab took the request; not opening one');
    } catch {
      console.log(TAG, `no upload tab took the request within ${CONSUMER_GRACE_MS}ms; ` +
        'opening one');
      // Foreground: this is where the upload lands, where the status
      // shows, and where the user edits titles and clicks save. Watching
      // it happen in a background tab is no use to anybody.
      //
      // GM_openInTab is an extension API, so unlike window.open it
      // doesn't need the click's user activation.
      GM_openInTab(STRAVA_UPLOAD_URL, { active: true, setParent: true });
    }
  }

  // The Garmin side's whole job: work out what's new, hand the id list to
  // a Strava upload tab, and report what happens. The files themselves
  // are fetched over there.
  async function runFromGarmin() {
    setStatus('Checking Garmin for new activities…');
    const session = await garminSession();
    const fresh = await newActivities(session);
    if (!fresh.length) return;
    await dispatchToStrava(fresh);
  }

  // Hand a fixed list of activities to a Strava upload tab and report
  // what happens. The caller decides what's in the list — the whole diff
  // for the toolbar button, or a single activity for the gear menu — so
  // this half knows nothing about what counts as new.
  // One run at a time. dispatchToStrava starts by clearing the very keys
  // a run in flight is waiting on, so a second click — the toolbar button
  // twice, or the button and then the gear item — would strand the first
  // until its ten-minute timeout.
  let dispatchInFlight = false;

  async function dispatchToStrava(activities) {
    if (dispatchInFlight) {
      console.log(TAG, 'a run is already in flight; ignoring this one');
      setStatus('Already sending to Strava — wait for that to finish.');
      return;
    }
    dispatchInFlight = true;
    const start = performance.now();
    clearRequestKeys();
    const requestId = `r${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    // Narrowed on the way out: the working tab needs an id to fetch and
    // a name to show, and `start` is only ever used by the diff that
    // already happened here. Keeping the payload to what it says it is
    // costs one map.
    GM_setValue(K_REQUEST, {
      requestId,
      activities: activities.map(({ id, name }) => ({ id, name })),
      ts: Date.now(),
    });
    setStatus(`Handing ${plural(activities.length, 'activity', 'activities')} to Strava…`);

    // Runs alongside the wait rather than blocking it, so it needs its
    // own handler — nothing is awaiting it to surface a throw.
    ensureConsumer(requestId).catch((err) => {
      console.log(TAG, "couldn't open a Strava upload tab:", (err && err.message) || err);
    });

    const progressId = GM_addValueChangeListener(K_PROGRESS, (key, oldV, newV) => {
      if (!newV || newV.requestId !== requestId) return;
      setStatus(`Strava is downloading from Garmin — ${newV.done} of ${newV.total} done…`);
    });
    try {
      const result = await waitForValue(
        K_RESULT, (v) => v && v.requestId === requestId, RESULT_TIMEOUT_MS);
      if (!result.ok) {
        const err = new Error(result.error || 'the Strava tab reported a failure');
        if (result.signedOutOf) err.signedOutOf = result.signedOutOf;
        throw err;
      }
      console.log(TAG, `Strava uploaded ${result.count} file(s) in ${since(start)}`);
      setStatus(`Sent ${plural(result.count, 'activity', 'activities')} to Strava.`,
        { done: true });
    } finally {
      dispatchInFlight = false;
      GM_removeValueChangeListener(progressId);
      // Leaving a finished request in storage makes the next upload tab
      // to open think there's one in flight and try to claim it.
      clearRequestKeys();
    }
  }

  function clearRequestKeys() {
    for (const key of [K_REQUEST, K_CLAIM, K_PROGRESS, K_RESULT]) GM_deleteValue(key);
  }

  // -------------------------------------------- the activity page's menu

  // On a single activity's page, an "Upload to Strava" item at the top of
  // the gear (More…) menu, sending just that activity — whether or not
  // it counts as new. Useful for re-sending one after an edit, or picking
  // up something older than the window the buttons look at.
  const ACTIVITY_PATH_RE = /^\/app\/activity\/(\d+)/;
  // The gear menu's own container, tagged with a semantic CSS-module
  // prefix. Its items only exist in the DOM while the menu is open.
  const GEAR_CONTAINER_SELECTOR = '[class*="ActivitySettingsMenu_menuContainer"]';
  const MENU_WRAPPER_SELECTOR = '[class*="Menu_menuItemWrapper"]';
  const MENU_ITEM_SELECTOR = '[class*="Menu_menuItems"]';
  // Garmin's own separators between groups of items ("Set as PR" from
  // "Export File", and again before "Edit"). We copy one rather than
  // draw our own line, so ours matches whatever they look like.
  const MENU_DIVIDER_SELECTOR = '[class*="Menu_divider"]';
  const ACTIVITY_NAME_SELECTOR = '[class*="ActivityNameIconRow_activityNameIconRow"]';
  const MENU_ITEM_ID = 'jshute-garmin-upload-one-to-strava';

  // Read fresh at click time, not at insert time: the SPA can route to
  // another activity while a stale menu node is still around.
  function currentActivity() {
    const match = location.pathname.match(ACTIVITY_PATH_RE);
    if (!match) return null;
    const nameEl = document.querySelector(ACTIVITY_NAME_SELECTOR);
    const name = (nameEl && nameEl.textContent.trim()) || '';
    return { id: match[1], name: name || 'this activity' };
  }

  function onMenuItemClick(event) {
    event.preventDefault();
    event.stopPropagation();
    const activity = currentActivity();
    if (!activity) return;
    // React doesn't know this item exists, so it won't close the menu
    // for us. Toggling the gear button does. Re-queried rather than
    // captured at insert time: the SPA rebuilds this subtree, and a
    // captured node can be detached by the time it's clicked.
    const container = document.querySelector(GEAR_CONTAINER_SELECTOR);
    const gear = container && container.querySelector('button[class*="Menu_menuBtn"]');
    if (gear) gear.click();
    console.log(TAG, `gear menu: sending activity ${activity.id} to Strava`);
    setStatus(`Sending ${activity.name} to Strava…`);
    // Straight to dispatch — no list, no diff. Sending an activity that
    // is already on Strava is the point of the item, not a mistake to
    // guard against. Its badge clears on the next diff like any other,
    // since "already uploaded" is read off Strava rather than recorded.
    dispatchToStrava([activity]).catch((err) => {
      clearRequestKeys();
      reportFailure(err, 'upload failed');
    });
  }

  // Idempotent, and cheap enough to run from the observer: it returns at
  // the first missing piece, and the menu's items don't exist at all
  // until it's open.
  function ensureActivityMenuItem() {
    if (!ACTIVITY_PATH_RE.test(location.pathname)) return;
    const container = document.querySelector(GEAR_CONTAINER_SELECTOR);
    if (!container) return;
    const wrapper = container.querySelector(MENU_WRAPPER_SELECTOR);
    if (!wrapper || document.getElementById(MENU_ITEM_ID)) return;
    const sampleItem = wrapper.querySelector(MENU_ITEM_SELECTOR);
    if (!sampleItem) return;

    const item = document.createElement('div');
    item.id = MENU_ITEM_ID;
    // Copy a sibling's className rather than hardcoding the build-hashed
    // suffix, same reason as the toolbar buttons.
    item.className = sampleItem.className;
    item.textContent = 'Upload to Strava';
    item.addEventListener('click', onMenuItemClick);

    const sampleDivider = wrapper.querySelector(MENU_DIVIDER_SELECTOR);
    const divider = document.createElement('div');
    if (sampleDivider) {
      divider.className = sampleDivider.className;
    } else {
      // Only if Garmin ever stops grouping its own items.
      divider.style.borderTop = '1px solid rgba(0,0,0,0.12)';
      divider.style.margin = '4px 0';
    }

    wrapper.insertBefore(item, wrapper.firstElementChild);
    wrapper.insertBefore(divider, item.nextSibling);
    console.log(TAG, 'added "Upload to Strava" to the activity gear menu');
  }

  // ------------------------------------------------------------- buttons

  function onActivitiesClick(event) {
    event.preventDefault();
    console.log(TAG, 'Activities clicked');
    window.location.assign(ACTIVITIES_URL);
  }

  function onUploadClick(event) {
    event.preventDefault();
    console.log(TAG, 'Upload to Strava clicked');
    runFromGarmin().catch((err) => {
      clearRequestKeys();
      reportFailure(err, 'upload failed');
    });
  }

  // Inherit the className from an existing "secondary medium" Garmin
  // button (e.g. "Edit Home") so we automatically match its look,
  // without hardcoding the build-hashed CSS-module suffixes (which
  // change every deploy). We exclude `iconButton` variants — those
  // strip the background/padding and would make us look flat.
  const SECONDARY_SELECTOR =
    'button[class*="Button_btn"][class*="Button_secondary"][class*="Button_medium"]:not([class*="iconButton"])';
  const FALLBACK_SELECTORS = [
    'button[class*="Button_btn"][class*="Button_secondary"]:not([class*="iconButton"])',
    'button[class*="Button_btn"][class*="Button_medium"]:not([class*="iconButton"])',
  ];

  function findGarminButtonClass() {
    for (const selector of [SECONDARY_SELECTOR, ...FALLBACK_SELECTORS]) {
      const ref = document.querySelector(selector);
      if (ref) return ref.className;
    }
    return null;
  }

  // The properties makeButton's fallback sets inline. Inline styles beat
  // the CSS-module class we upgrade to later, so the upgrade has to clear
  // them or the button keeps the fallback look wearing the right class.
  const FALLBACK_STYLE_PROPS = ['padding', 'border', 'borderRadius', 'background',
    'backgroundColor', 'color', 'font', 'cursor', 'whiteSpace'];

  function makeButton(id, label, title, onClick) {
    const btn = document.createElement('button');
    btn.id = id;
    btn.type = 'button';
    btn.textContent = label;
    btn.title = title;
    const cls = findGarminButtonClass();
    if (cls) {
      btn.className = cls;
    } else {
      // Fallback: inline styling close to the Garmin "secondary"
      // button look, in case no reference button exists on this page.
      Object.assign(btn.style, {
        padding: '8px 16px',
        border: '0',
        borderRadius: '4px',
        background: '#d8d8d8',
        color: '#101010',
        font: '600 14px/20px "Open Sans", "Helvetica Neue", Helvetica, Arial, sans-serif',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      });
    }
    // Spacing, applied separately so it doesn't get clobbered by the
    // inherited className.
    btn.style.marginLeft = '8px';
    btn.addEventListener('click', onClick);
    return btn;
  }

  function ensureButtons() {
    if (document.getElementById(ACTIVITIES_BUTTON_ID)) return false;
    const toggle = document.querySelector(TOGGLE_SELECTOR);
    if (!toggle || !toggle.parentElement) return false;
    const activities = makeButton(
      ACTIVITIES_BUTTON_ID, 'Activities', 'Open the Activities list', onActivitiesClick);
    const upload = makeButton(
      UPLOAD_BUTTON_ID, 'Upload to Strava',
      "Send every activity that hasn't been uploaded to Strava yet", onUploadClick);
    toggle.parentElement.insertBefore(activities, toggle.nextSibling);
    toggle.parentElement.insertBefore(upload, activities.nextSibling);
    console.log(TAG, 'buttons inserted next to nav toggle');
    return true;
  }

  function installButtons() {
    if (!ensureButtons()) console.log(TAG, 'toggle not found yet; watching for it');

    // The Garmin SPA tears down and rebuilds the toolbar on some
    // navigations. Re-insert whenever it's missing. Also upgrade our
    // className if a "secondary" reference button (e.g. "Edit Home")
    // has rendered since we first inserted — at script start time
    // only the toolbar exists, and the toolbar's buttons are all
    // iconButton/primary variants.
    // Badge work is debounced: the list renders a row at a time, and our
    // own badge insertions re-trigger the observer. refreshNewBadges is
    // idempotent, so the worst case of a coalesced burst is a no-op pass.
    let badgeTimer = null;
    const scheduleBadges = () => {
      if (badgeTimer) return;
      badgeTimer = setTimeout(() => { badgeTimer = null; refreshNewBadges(); }, 150);
    };

    const observer = new MutationObserver(() => {
      scheduleBadges();
      // The gear menu is built and torn down every time it opens, so
      // this has to run on mutations rather than once at startup.
      ensureActivityMenuItem();
      if (ensureButtons()) return;
      const ref = document.querySelector(SECONDARY_SELECTOR);
      if (!ref) return;
      for (const id of [ACTIVITIES_BUTTON_ID, UPLOAD_BUTTON_ID]) {
        const existing = document.getElementById(id);
        if (!existing || /Button_secondary/.test(existing.className)) continue;
        if (ref.className === existing.className) continue;
        for (const prop of FALLBACK_STYLE_PROPS) existing.style[prop] = '';
        existing.className = ref.className;
        existing.style.marginLeft = '8px';
        console.log(TAG, `upgraded ${id} styling to secondary`);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    scheduleBadges();
  }


  // =====================================================================
  //                          Strava upload side
  // =====================================================================

  // The upload page is a plain multipart form — no Dropzone instance on
  // this element — and the page starts uploading as soon as the input
  // fires a change event. So attaching the files is the whole submit.
  const STRAVA_INPUT_SELECTOR =
    'form[action*="/upload/files"] input[type="file"][name="files[]"]';

  // We match all of strava.com, not just /upload/*, so the menu item can
  // go in the nav on every page, and so a redirect to the login page
  // still lands somewhere this script runs and can say so.
  const STRAVA_UPLOAD_PATH_RE = /^\/upload(\/|$)/;
  // How soon after a request starts a non-upload Strava page counts as
  // "the tab we just opened got bounced" rather than ordinary browsing.
  const BOUNCE_WINDOW_MS = 60000;

  // Strava's global nav holds the upload drop-down. Plain server-rendered
  // markup, no framework: li.upload-menu > ul.options > li > a.
  const STRAVA_MENU_SELECTOR = 'li.upload-menu ul.options';
  const STRAVA_MENU_ITEM_ID = 'jshute-strava-upload-from-garmin';
  // Set on the upload page's URL when we send this tab there to start a
  // run, so the page knows to start one on arrival. Bare when the link
  // is followed normally (a middle-click, say), and `=<nonce>` when we
  // navigate ourselves with an already-diffed list waiting in storage —
  // see takePending for why the nonce is there.
  const STRAVA_TRIGGER_HASH = '#upload-from-garmin';

  function ensureStravaMenuItem() {
    if (document.getElementById(STRAVA_MENU_ITEM_ID)) return false;
    const list = document.querySelector(STRAVA_MENU_SELECTOR);
    if (!list) return false;

    const item = document.createElement('li');
    item.id = STRAVA_MENU_ITEM_ID;
    const link = document.createElement('a');
    link.href = STRAVA_UPLOAD_URL + STRAVA_TRIGGER_HASH;
    link.title = 'Download every activity that has not been sent to Strava yet ' +
      'from Garmin Connect, and upload it here';
    // Borrow the Upload activity icon so our label lines up with the
    // items below it rather than sitting flush against the edge.
    const icon = document.createElement('span');
    icon.className = 'upload-activity app-icon icon-upload-activity';
    link.appendChild(icon);
    link.appendChild(document.createTextNode('Upload from Garmin'));
    link.addEventListener('click', (event) => {
      // Ctrl/Cmd/Shift-click means "open this href somewhere else", and
      // the href is the upload page — which does the whole run itself on
      // arrival. Swallowing those would navigate the current tab
      // instead, which is the opposite of what was asked for.
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      console.log(TAG, 'Upload from Garmin clicked');
      if (STRAVA_UPLOAD_PATH_RE.test(location.pathname)) {
        startStravaRun();
        return;
      }
      // The files have to be attached to the upload form, so the run has
      // to happen on that page — but only once we know there is
      // something to send. Everything before that point (the Garmin
      // session, both lists, the diff) is origin-independent
      // `GM_xmlhttpRequest` work that runs just as well from here, so we
      // do it here and leave the user where they were if the answer is
      // "nothing new" or "sign in first".
      checkThenGoToUpload();
    });
    item.appendChild(link);
    list.insertBefore(item, list.firstElementChild);
    console.log(TAG, 'added "Upload from Garmin" to the upload menu');
    return true;
  }

  // A note left by whichever side sent us to a sign-in page.
  function showSigninHint() {
    const hint = GM_getValue(K_SIGNIN_HINT, null);
    if (!hint || Date.now() - hint.ts >= 60000) return;
    GM_deleteValue(K_SIGNIN_HINT);
    console.log(TAG, 'showing the sign-in hint left by the other tab');
    toast(hint.message, 0);
  }

  function initStrava() {
    console.log(TAG, 'init on', location.pathname);

    // The nav is on every Strava page, and Strava re-renders parts of it
    // on navigation, so keep re-adding the item if it goes missing.
    ensureStravaMenuItem();
    new MutationObserver(() => ensureStravaMenuItem())
      .observe(document.body, { childList: true, subtree: true });

    showSigninHint();

    const request = GM_getValue(K_REQUEST, null);
    const live = request && Date.now() - request.ts <= REQUEST_STALE_MS;

    if (STRAVA_UPLOAD_PATH_RE.test(location.pathname)) {
      // An open upload tab is a standing offer to serve the Garmin
      // button — for a request in flight right now and for every later
      // one. So the listener goes on unconditionally and is never torn
      // down: a tab left on this page should keep taking requests for as
      // long as it's open, not just the first.
      //
      // The guard is per-request rather than a latch. Latching would
      // leave the tab deaf after one run (and deaf forever if it lost a
      // claim race), which is exactly the case tab reuse exists for.
      let offered = null;
      const offer = (candidate) => {
        if (!candidate || !candidate.requestId) return;
        if (offered === candidate.requestId) return;
        if (Date.now() - candidate.ts > REQUEST_STALE_MS) return;
        offered = candidate.requestId;
        tryClaim(candidate);
      };
      GM_addValueChangeListener(K_REQUEST, (key, oldValue, newValue) => offer(newValue));

      // Registered before this branch, not after it: a tab that arrived
      // here to run the Strava menu item's upload is still an upload tab
      // afterwards, and should go on serving the Garmin button like any
      // other. Returning early here left it deaf for the rest of its life.
      const triggered = location.hash === STRAVA_TRIGGER_HASH ||
        location.hash.startsWith(STRAVA_TRIGGER_HASH + '=');
      if (triggered) {
        const nonce = location.hash.slice(STRAVA_TRIGGER_HASH.length + 1);
        // Drop the hash so a reload doesn't silently start another run.
        history.replaceState(null, '', location.pathname + location.search);
        // No nonce means the link was followed rather than sent by our
        // own check — nothing is waiting for this load, so it does the
        // whole run itself.
        startStravaRun(nonce ? takePending(nonce) : null);
        return;
      }

      if (live) offer(request);
      else console.log(TAG, 'no request in flight; waiting to be offered one');
      return;
    }

    if (!live) {
      console.log(TAG, 'no request in flight; idle');
      return;
    }

    // Strava sends signed-out visitors from /upload/select to /login, and
    // the upload tab the Garmin side just opened is the overwhelmingly
    // likely source of a non-upload Strava page seconds after a request
    // started. Report it so the Garmin side fails immediately with a
    // useful message rather than waiting out its timeout.
    if (Date.now() - request.ts > BOUNCE_WINDOW_MS) {
      console.log(TAG, `on ${location.pathname}, not the upload page; leaving the ` +
        'request alone (too long after it started to blame this tab)');
      return;
    }
    // Only a sign-in page is real evidence that the upload tab bounced.
    // Any other Strava page is far more likely to be the user browsing in
    // a different tab while a run happens — killing it for that would be
    // a false positive.
    if (!/login|signup|onboarding/.test(location.pathname)) {
      console.log(TAG, `on ${location.pathname} during a run; not the upload page ` +
        'but not a sign-in page either, so leaving the request alone');
      return;
    }
    console.log(TAG, "Strava isn't signed in; reporting the request as failed");
    GM_setValue(K_RESULT, {
      requestId: request.requestId, ok: false,
      error: "You're not signed in to Strava", signedOutOf: 'Strava',
    });
  }

  // Started from Strava's own menu item, on the upload page. Everything
  // happens here — the list, the downloads, the upload — with no Garmin
  // tab involved. `pending` is the already-diffed list when we arrived
  // here from another Strava page; null when the menu item was clicked
  // on this page and the diff still has to be done.
  function startStravaRun(pending = null) {
    runOnStrava(pending).catch((err) => reportFailure(err, 'upload failed'));
  }

  // The list this tab left for itself on the way here, if it is still
  // fresh and is actually the one this load was sent for. Taken rather
  // than read: a reload of the upload page should not silently re-send a
  // list the previous load already handled.
  //
  // The nonce is what makes "left for itself" true. GM storage is global
  // and carries no tab identity, so without it any upload page loading
  // within the freshness window would swallow the value — and a second
  // tab that arrives to find it gone re-runs the diff, sees the same
  // activities still missing from Strava, and uploads every one of them
  // a second time. A value whose nonce doesn't match is left alone for
  // the load it belongs to.
  function takePending(nonce) {
    const pending = GM_getValue(K_PENDING, null);
    if (!pending || !pending.activities || !pending.activities.length) return null;
    if (pending.nonce !== nonce) {
      console.log(TAG, "the waiting list was left for a different page load; " +
        'leaving it and checking again');
      return null;
    }
    GM_deleteValue(K_PENDING);
    if (Date.now() - pending.ts > PENDING_STALE_MS) {
      console.log(TAG, 'the handed-over list is too old to trust; checking again');
      return null;
    }
    console.log(TAG, `picked up ${plural(pending.activities.length, 'activity', 'activities')} ` +
      'handed over from the page the upload was started on');
    return { activities: pending.activities };
  }

  // Clicked somewhere on Strava that isn't the upload page. Work out
  // what's new from right here, and only navigate once we know there is
  // something to attach — a signed-out session or an empty diff leaves
  // the user on the page they were reading.
  let stravaCheckInFlight = false;

  async function checkThenGoToUpload() {
    if (stravaCheckInFlight) {
      console.log(TAG, 'already checking; ignoring this click');
      setStatus('Already checking Garmin — wait for that to finish.');
      return;
    }
    stravaCheckInFlight = true;
    try {
      setStatus('Checking Garmin for new activities…');
      const session = await garminSession();
      // Says its own "nothing new" in the status panel.
      const fresh = await newActivities(session);
      if (!fresh.length) return;
      const nonce = `p${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      GM_setValue(K_PENDING, {
        ts: Date.now(),
        nonce,
        activities: fresh.map(({ id, name }) => ({ id, name })),
      });
      setStatus(`Found ${plural(fresh.length, 'new activity', 'new activities')} — ` +
        'going to the upload page…');
      console.log(TAG, 'going to the upload page to send them');
      window.location.assign(`${STRAVA_UPLOAD_URL}${STRAVA_TRIGGER_HASH}=${nonce}`);
    } catch (err) {
      reportFailure(err, 'upload failed');
    } finally {
      stravaCheckInFlight = false;
    }
  }

  // Take the request, but only if we actually won it.
  //
  // GM storage has no compare-and-swap: `GM_setValue` is an
  // unconditional last-write-wins overwrite. Two upload tabs get the
  // same `request` broadcast at the same instant, both read no claim,
  // and both write one — so a bare read-then-write would have both tabs
  // downloading the same activities and uploading each ride twice.
  //
  // Instead: write optimistically, let the writes settle, then re-read.
  // Both tabs converge on the same stored value, so exactly one sees its
  // own id and proceeds; the loser stands down.
  function tryClaim(request) {
    const me = `s${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const existing = GM_getValue(K_CLAIM, null);
    if (existing && existing.requestId === request.requestId) {
      console.log(TAG, 'another upload tab already claimed this request; idle');
      return;
    }
    GM_setValue(K_CLAIM, { requestId: request.requestId, who: me });

    setTimeout(() => {
      const winner = GM_getValue(K_CLAIM, null);
      if (!winner || winner.requestId !== request.requestId || winner.who !== me) {
        console.log(TAG, 'lost the claim race to another upload tab; idle');
        return;
      }
      console.log(TAG, `claimed request ${request.requestId} with ` +
        `${request.activities.length} activit${request.activities.length === 1 ? 'y' : 'ies'}`);
      // Raise this tab. The work, the status panel, and the editing the
      // user is about to do are all here, so this is where they should
      // be looking — and a reused background tab would otherwise be
      // invisible while the Garmin tab sat there saying nothing useful.
      //
      // Done by the tab that won the claim rather than by the Garmin
      // side, because it's the one that knows it's about to work, and
      // because `window.focus` only ever raises the caller.
      //
      // With `@grant window.focus` the manager selects this tab and
      // raises its window; without the grant this is the page's own
      // no-op for a background tab, so it degrades quietly rather than
      // throwing on a manager that lacks it.
      window.focus();
      runOnStrava(request).catch((err) => {
        // No escalation: the Garmin tab that started this opens the
        // sign-in page, so we don't each open our own.
        reportFailure(err, 'upload failed', { escalate: false });
        GM_setValue(K_RESULT, {
          requestId: request.requestId, ok: false,
          error: (err && err.message) || 'unknown error',
          signedOutOf: err && err.signedOutOf,
        });
      });
    }, CLAIM_SETTLE_MS);
  }

  // The whole upload, on the page that owns the form. `request` is the
  // Garmin side's handover (a fixed list of activities to send), or null
  // when this tab started the run itself and has to pick the list too.
  async function runOnStrava(request) {
    const start = performance.now();
    const requestId = request && request.requestId;

    setStatus(request
      ? 'Connecting to Garmin…'
      : 'Checking Garmin for new activities…');
    const session = await garminSession();

    // A handover from the Garmin button carries a fixed list; a run this
    // tab started itself has to pick one.
    const activities = request ? request.activities : await newActivities(session);
    if (!activities.length) return;

    const files = [];
    for (const activity of activities) {
      const step = activities.length === 1
        ? '' : ` (${files.length + 1} of ${activities.length})`;
      setStatus(`Downloading ${activity.name} from Garmin${step}…`);
      const fetchStart = performance.now();
      const blob = await fetchTcx(session, activity.id);
      files.push(new File([blob], `activity_${activity.id}.tcx`,
        { type: 'application/vnd.garmin.tcx+xml' }));
      console.log(TAG, `downloaded activity ${activity.id} ` +
        `(${blob.size} bytes in ${since(fetchStart)})`);
      if (requestId) {
        GM_setValue(K_PROGRESS, { requestId, done: files.length, total: activities.length });
      }
    }

    setStatus(`Attaching ${plural(files.length, 'file', 'files')} to the upload form…`);
    const input = await waitForElement(STRAVA_INPUT_SELECTOR, 30000);
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    console.log(TAG, `attached ${files.length} file(s) and started the upload ` +
      `(${since(start)} for the whole run)`);

    // Nothing to record about *which* activities went: what counts as
    // sent is read back off Strava, so they stop being new as soon as
    // Strava lists them. A run that dies before this point leaves them
    // new by construction, and the next click retries them. All any
    // other tab needs is that something changed.
    GM_setValue(K_UPLOADED, { ts: Date.now(), count: files.length });

    if (requestId) {
      // Retire the request here as well as on the Garmin side, so a run
      // whose initiating tab was closed still doesn't leave one parked.
      GM_deleteValue(K_REQUEST);
      GM_deleteValue(K_PROGRESS);
      GM_setValue(K_RESULT, { requestId, ok: true, count: files.length });
    }
    setStatus(`Uploading ${plural(files.length, 'activity', 'activities')} from Garmin.`,
      { done: true });
  }

  function waitForElement(selector, timeoutMs) {
    return new Promise((resolve, reject) => {
      const found = document.querySelector(selector);
      if (found) return resolve(found);
      const observer = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (!el) return;
        observer.disconnect();
        clearTimeout(timer);
        resolve(el);
      });
      observer.observe(document.body, { childList: true, subtree: true });
      const timer = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`never found "${selector}"`));
      }, timeoutMs);
    });
  }

  // =====================================================================

  // Only one copy per page. Two installs — the same script in two
  // managers, say — get separate GM storage, so their sent-activity
  // histories disagree and they fight over the "New" badges: one adds,
  // the other's MutationObserver removes, forever. Nothing else shows
  // it, since everything is idempotent by element id.
  //
  // Standing down isn't a fix — which copy wins is load order, decided
  // per tab, so the Garmin side can hand its id list to a storage the
  // Strava tab isn't reading. Hence the on-screen error. The marker
  // goes on the DOM: the sandboxes share only the live document.
  const CLAIM_ATTR = 'jshuteGarminStrava';
  if (document.documentElement.dataset[CLAIM_ATTR]) {
    const message = 'Two copies of the Garmin → Strava userscript are installed. ' +
      'Uploads and the New badges will not work properly until you uninstall ' +
      'one of them in your userscript manager and reload.';
    console.log(TAG, message);
    setStatus(message, { error: true });
    return;
  }
  document.documentElement.dataset[CLAIM_ATTR] = '1';

  if (location.hostname.endsWith('strava.com')) {
    initStrava();
  } else {
    initGarmin();
  }
})();
