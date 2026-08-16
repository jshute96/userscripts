// ==UserScript==
// @name         Garmin Connect → Strava: Upload new activities with one click
// @namespace    https://github.com/jshute96/userscripts
// @version      0.2.3
// @description  Adds Upload to Strava button on Garmin's toolbar, and an Upload from Garmin item on Strava's upload menu. Either one uploads all the rides you haven't uploaded yet.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://connect.garmin.com/*
// @match        https://www.strava.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        GM_openInTab
// @grant        GM_registerMenuCommand
// @grant        window.onurlchange
// @noframes
// @run-at       document-idle
// ==/UserScript==

// One script, two origins. Garmin Connect drives the batch; the Strava
// upload page is the other half of the same conversation. They share a
// single GM storage namespace (GM storage is per-script, not per-origin),
// which is the only channel that reaches across the origin boundary.

(function () {
  'use strict';

  const TAG = '[garmin-dl]';

  // ------------------------------------------------------------ storage keys
  // All of these live in this script's GM storage, visible from both
  // connect.garmin.com and www.strava.com.

  // Array of activity IDs we've already sent. `null` means "never run".
  const K_SEEN = 'seenActivityIds';
  // { batchId, ids, count, state: 'sending' | 'done', ts } — the batch
  // currently in flight. The Strava side reads `count` to know when it
  // has everything.
  const K_HANDOFF = 'handoff';
  // { batchId, who } — set by the first Strava tab to pick up a batch, so
  // two open upload tabs don't both try to consume it.
  const K_CLAIM = 'claim';
  // { batchId, id, name, seq, gz } — exactly one file at a time. gzipped
  // and base64'd because chrome.storage.local is capped at 10 MB for the
  // whole extension and a raw TCX runs to several MB. Measured: a 6.5 MB
  // TCX gzips to 366 KB, ~488 KB once base64'd.
  const K_FILE = 'file';
  // { batchId, seq } — the Strava side's receipt for K_FILE, so the Garmin
  // side knows the slot is free for the next one.
  const K_TAKEN = 'fileTaken';
  // { batchId, count, ts } — Strava confirming the files are attached and
  // uploading. Only after this do we record the activities as seen.
  const K_ACK = 'ack';
  // { batchId, reason } — the Strava side reporting it can't take the
  // batch, so the Garmin side fails now instead of waiting out a timeout.
  const K_FAIL = 'failure';
  // { ts, message } — a note left for the sign-in page we're about to
  // open, so the explanation lands in the tab the user ends up looking at.
  const K_SIGNIN_HINT = 'signinHint';

  // A batch is abandoned if nothing picks it up in this long — the Strava
  // tab may have landed on the login page, or been closed.
  const HANDOFF_TIMEOUT_MS = 90000;
  // How long to let an already-open Strava upload tab claim a batch
  // before we open one ourselves. Short by default — an open tab only
  // needs a storage round-trip — and long when the run was started from
  // Strava, because that tab is still navigating to the upload page.
  const CONSUMER_GRACE_MS = 2500;
  const CONSUMER_GRACE_FROM_STRAVA_MS = 25000;
  // How long to let a claim propagate before re-reading it to see who
  // won. Must comfortably exceed the manager's write debounce (150 ms in
  // SourceMonkey) plus the service-worker round trip and broadcast.
  const CLAIM_SETTLE_MS = 600;
  // Ignore a handoff left behind by a run that died half way through.
  const HANDOFF_STALE_MS = 15 * 60 * 1000;
  // Keep the seen list from growing without bound. Garmin's activity list
  // page shows 20 at a time, so this is far more history than we need.
  const SEEN_LIMIT = 500;

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
  // Strava tab in particular sits idle for most of a minute waiting on
  // the Garmin side, and a blank page gives no sign anything is
  // happening — or that the tab is the right one to be looking at.
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
  // logs. Most of a transfer is Garmin's export endpoint generating and
  // shipping several MB of XML — measured at ~1s per ride — so when this
  // feels slow the logs should say where the time actually went.
  const since = (mark) => {
    const ms = performance.now() - mark;
    return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
  };

  // btoa() takes a binary string, and String.fromCharCode(...bytes) blows
  // the argument limit on anything over ~100 KB, so go in chunks.
  function bytesToBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

  function base64ToBytes(b64) {
    const s = atob(b64);
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return bytes;
  }

  async function gzipToBase64(blob) {
    const stream = blob.stream().pipeThrough(new CompressionStream('gzip'));
    const buf = await new Response(stream).arrayBuffer();
    return bytesToBase64(new Uint8Array(buf));
  }

  async function base64ToBlob(b64) {
    const src = new Blob([base64ToBytes(b64)]);
    const stream = src.stream().pipeThrough(new DecompressionStream('gzip'));
    return await new Response(stream).blob();
  }

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
  //                          Garmin Connect side
  // =====================================================================

  const ACTIVITIES_URL = 'https://connect.garmin.com/app/activities';
  const STRAVA_UPLOAD_URL = 'https://www.strava.com/upload/select';
  const STRAVA_LOGIN_URL = 'https://www.strava.com/login';
  const ACTIVITIES_PATH = '/app/activities';

  // Strava's "Upload from Garmin" menu item points here. A signed-out
  // visit to /app/* 302s to /signin/?service=… on the same origin, and
  // the browser carries the fragment across the redirect — so the hash
  // survives to tell the sign-in page that we're the reason it's there.
  const TRIGGER_HASH = '#upload-from-garmin';
  const GARMIN_APP_RE = /^\/app(\/|$)/;
  const GARMIN_SIGNIN_RE = /^\/signin(\/|$)/;

  const ACTIVITIES_BUTTON_ID = 'jshute-garmin-activities-btn';
  const UPLOAD_BUTTON_ID = 'jshute-garmin-upload-to-strava-btn';

  // The CSS-module class names have build-hash suffixes
  // (e.g. TopHeaderBarView_navToggle__WzQWw); match by stable prefix.
  const TOGGLE_SELECTOR = 'button[class*="TopHeaderBarView_navToggle"]';

  let garminAppStarted = false;
  let signinNoticeShown = false;
  let triggerHandled = false;

  function initGarmin() {
    console.log(TAG, 'init on', location.pathname);
    // `@match` is the whole site, but we only act under /app/*. The
    // initial document can easily be somewhere else — the root, or the
    // sign-in page — and Garmin's SPA then routes into /app/* by
    // pushState with no reload. Without re-dispatching on URL changes the
    // buttons would never appear in that tab, which is the trap CLAUDE.md
    // describes under "SPA sites: broaden @match, gate inside the script".
    window.addEventListener('urlchange', onGarminUrl);
    onGarminUrl();
  }

  function onGarminUrl() {
    if (GARMIN_SIGNIN_RE.test(location.pathname)) {
      // We match all of connect.garmin.com precisely so we're running
      // here: a signed-out visit never reaches /app/*, and without this
      // the Strava-initiated flow would look like it did nothing.
      if (location.hash === TRIGGER_HASH && !signinNoticeShown) {
        signinNoticeShown = true;
        console.log(TAG, 'sign-in page instead of the activities list');
        toast("You're not signed in to Garmin. Sign in here, then click " +
          'Upload from Garmin again.', 0);
      }
      return;
    }

    if (!GARMIN_APP_RE.test(location.pathname)) {
      console.log(TAG, `${location.pathname} is outside /app/; waiting for the app`);
      return;
    }

    if (!garminAppStarted) {
      garminAppStarted = true;
      sweepStaleBatch();
      installButtons();
      registerMenuCommands();
    }
    // startTriggeredRun clears the hash, which itself fires urlchange —
    // and a second run would re-send everything. Once only.
    if (location.hash === TRIGGER_HASH && !triggerHandled) {
      triggerHandled = true;
      startTriggeredRun();
    }
  }

  // A run that dies without rejecting — tab closed, navigated away —
  // never reaches clearBatchKeys(), and leaves a ~425 KB gzipped payload
  // parked in GM storage. HANDOFF_STALE_MS only stops us *reading* one of
  // those; nothing deleted it. Sweep on init so they can't accumulate
  // against the extension's 10 MB budget.
  function sweepStaleBatch() {
    const handoff = GM_getValue(K_HANDOFF, null);
    if (!handoff || !handoff.ts) return;
    const age = Date.now() - handoff.ts;
    if (age <= HANDOFF_STALE_MS) return;
    console.log(TAG, `clearing an abandoned batch from ${Math.round(age / 60000)} ` +
      'minutes ago');
    clearBatchKeys();
  }

  // Entered from Strava's "Upload from Garmin". The tab is opened in the
  // foreground, which matters: the first-run prompt() and every notice
  // below would be invisible in a background tab.
  async function startTriggeredRun() {
    // Drop the hash so a reload doesn't silently start another transfer.
    history.replaceState(null, '', location.pathname + location.search);

    if (location.pathname !== ACTIVITIES_PATH) {
      window.location.assign(ACTIVITIES_URL + TRIGGER_HASH);
      return;
    }

    console.log(TAG, 'triggered from Strava; waiting for the activity list');
    try {
      await waitForStableList();
    } catch (err) {
      console.log(TAG, 'activity list never appeared:', err && err.message);
      toast("Couldn't read the activities list — reload and try again.", 0);
      return;
    }
    startUpload(true);
  }

  // The list streams in a row at a time, so "the first link exists" is too
  // early — we'd diff against a partial page and call older rides new.
  // Wait for the count to hold steady instead.
  function waitForStableList(timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      let last = -1;
      let stableTicks = 0;
      const tick = () => {
        const count = listedActivities().length;
        if (count > 0 && count === last) {
          if (++stableTicks >= 2) return resolve(count);
        } else {
          stableTicks = 0;
        }
        last = count;
        if (Date.now() > deadline) return reject(new Error('list never settled'));
        setTimeout(tick, 300);
      };
      tick();
    });
  }

  // ------------------------------------------------------- activity list

  // Every row in the activities list links to /app/activity/<id>. The row
  // markup is CSS-module soup, but the href is stable and is the only
  // thing we need.
  function listedActivities() {
    const out = [];
    const seen = new Set();
    for (const a of document.querySelectorAll('a[href*="/app/activity/"]')) {
      const id = ((a.getAttribute('href') || '').match(/\/app\/activity\/(\d+)/) || [])[1];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, name: (a.textContent || '').trim() });
    }
    return out;
  }

  function loadSeen() {
    // Returning null when GM storage is missing keeps every caller — the
    // badges especially, which run off a MutationObserver — from throwing
    // under the Playwright fixture, which injects the body with no GM_*.
    const stored = GM_getValue(K_SEEN, null);
    return Array.isArray(stored) ? stored : null;
  }

  function recordSeen(ids) {
    const merged = [...ids, ...(loadSeen() || [])];
    GM_setValue(K_SEEN, [...new Set(merged)].slice(0, SEEN_LIMIT));
    refreshNewBadges();
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

  // Idempotent, and safe to call as often as the observer fires: it adds
  // and removes only where the row disagrees with the stored history.
  function refreshNewBadges() {
    if (location.pathname !== ACTIVITIES_PATH) return;
    const rows = document.querySelectorAll(ROW_SELECTOR);
    if (!rows.length) return;
    const seen = loadSeen();
    // Before the first upload there's no history to compare against, so
    // every row would be "new" — badging all twenty says nothing.
    const seenSet = seen === null ? null : new Set(seen);
    let added = 0;
    let removed = 0;
    for (const row of rows) {
      const id = rowActivityId(row);
      const wanted = !!id && seenSet !== null && !seenSet.has(id);
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
      console.log(TAG, `New badges: ${added} added, ${removed} removed`);
    }
  }

  // Mark the newest `count` listed activities as unsent and everything
  // else — listed or remembered — as sent. This is how both the first-run
  // prompt and the menu command set the starting point.
  function keepNewestUnsent(listed, count) {
    const unsent = new Set(listed.slice(0, count).map((a) => a.id));
    const older = listed.slice(count).map((a) => a.id);
    const merged = [...older, ...(loadSeen() || [])].filter((id) => !unsent.has(id));
    GM_setValue(K_SEEN, [...new Set(merged)].slice(0, SEEN_LIMIT));
    refreshNewBadges();
  }

  // Ask for a count, defaulting to 1. Returns null if the user cancels or
  // types something that isn't a number, in which case nothing changes.
  function askCount(message, max, defaultCount = 1) {
    const answer = window.prompt(message, String(Math.min(defaultCount, max)));
    if (answer === null) return null;
    const count = parseInt(answer.trim(), 10);
    if (!Number.isFinite(count) || count < 0) {
      console.log(TAG, `didn't understand "${answer}"; nothing changed`);
      toast(`"${answer}" isn't a number — nothing changed.`);
      return null;
    }
    return Math.min(count, max);
  }

  // ------------------------------------------------------------ download

  // Garmin's own "Export to TCX" menu item fetches this endpoint. It needs
  // the session's CSRF token — which the server puts in a <meta> tag on
  // every page — plus an X-app-ver header; without either it answers 401.
  // The app version is in the ?bust= query on the page's own asset URLs.
  function garminApiHeaders() {
    const csrf = document.querySelector('meta[name="csrf-token"]');
    const asset = document.querySelector('link[href*="bust="], script[src*="bust="]');
    const bust = asset && ((asset.href || asset.src).match(/bust=([\d.]+)/) || [])[1];
    return {
      'Connect-Csrf-Token': csrf ? csrf.content : '',
      'X-app-ver': bust || '5.27.2.1',
    };
  }

  async function fetchTcx(id) {
    const url = `/gc-api/download-service/export/tcx/activity/${id}`;
    let response = await fetch(url, { headers: garminApiHeaders(), credentials: 'include' });
    if (response.status === 401) {
      // The SPA can sit open long enough for the session to lapse, and
      // then every gc-api call 401s. Re-requesting a normal page refreshes
      // the cookies; if that doesn't take, the user needs to reload.
      console.log(TAG, `401 on activity ${id}, refreshing the session and retrying`);
      await fetch(ACTIVITIES_PATH, { credentials: 'include' });
      response = await fetch(url, { headers: garminApiHeaders(), credentials: 'include' });
    }
    if (!response.ok) throw new Error(`export failed for ${id}: HTTP ${response.status}`);
    return await response.blob();
  }

  // Save to the browser's download folder under the name Garmin itself
  // uses, activity_<id>.tcx. Chrome asks once per site before allowing a
  // run of programmatic downloads.
  function saveToDisk(id, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `activity_${id}.tcx`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  // ----------------------------------------------------------- the batch

  // A promise that rejects the moment the Strava side reports it can't
  // take this batch, and otherwise never settles — so racing it against a
  // wait turns "the upload tab bounced to the login page" into an
  // immediate, specific error instead of a 90-second timeout.
  function failureWatcher(batchId) {
    return waitForValue(K_FAIL, (v) => v && v.batchId === batchId, HANDOFF_STALE_MS)
      .then(
        (v) => { throw new Error(v.reason); },
        () => new Promise(() => {}),
      );
  }

  // Prefer a Strava upload tab that's already open — in particular the
  // one the user clicked "Upload from Garmin" in, which navigates itself
  // to the upload page and waits to be offered a batch. Only if nobody
  // claims within the grace period do we open a tab of our own.
  async function ensureConsumer(batchId, fromStrava) {
    const grace = fromStrava ? CONSUMER_GRACE_FROM_STRAVA_MS : CONSUMER_GRACE_MS;
    try {
      await waitForValue(K_CLAIM, (v) => v && v.batchId === batchId, grace);
      console.log(TAG, 'an open Strava upload tab claimed the batch; not opening one');
    } catch {
      console.log(TAG, `no upload tab claimed the batch within ${grace}ms; opening one`);
      // GM_openInTab is an extension API, so unlike window.open it
      // doesn't need the click's user activation — which the first-run
      // prompt() would have spent by now anyway.
      GM_openInTab(STRAVA_UPLOAD_URL, { active: false, setParent: true });
    }
  }

  async function runBatch(batchId, activities, fromStrava) {
    const batchStart = performance.now();
    const ids = activities.map((a) => a.id);
    GM_setValue(K_HANDOFF, {
      batchId, ids, count: ids.length, state: 'sending', ts: Date.now(),
    });
    // Runs alongside the first fetch rather than blocking it: an
    // existing upload tab usually claims well before we have a file to
    // hand over, so the reuse case costs nothing.
    ensureConsumer(batchId, fromStrava);
    const failed = failureWatcher(batchId);
    // The watcher outlives a successful batch — it holds a listener and a
    // long timer. Attaching a no-op handler marks it handled, so a K_FAIL
    // written afterwards can't surface as an unhandled rejection. The
    // Promise.race calls below still see the rejection.
    failed.catch(() => {});

    let seq = 0;
    let index = 0;
    for (const activity of activities) {
      index += 1;
      const step = activities.length === 1 ? '' : ` (${index} of ${activities.length})`;
      setStatus(`Downloading ${activity.name || 'activity'}${step}…`);
      const fetchStart = performance.now();
      const blob = await fetchTcx(activity.id);
      console.log(TAG, `fetched activity ${activity.id} ` +
        `(${blob.size} bytes in ${since(fetchStart)})`);
      saveToDisk(activity.id, blob);

      setStatus(`Compressing ${activity.name || 'activity'}${step}…`);
      const gzipStart = performance.now();
      const gz = await gzipToBase64(blob);
      const gzipTime = since(gzipStart);
      seq += 1;
      GM_setValue(K_FILE, {
        batchId, id: activity.id, name: `activity_${activity.id}.tcx`, seq, gz,
      });
      console.log(TAG, `handed activity ${activity.id} to Strava ` +
        `(${gz.length} base64 chars, compressed in ${gzipTime})`);
      const receiptStart = performance.now();
      setStatus(`Sending ${activity.name || 'activity'}${step} to Strava…`);

      // Only one file sits in storage at a time — wait for the receipt
      // before fetching the next, so we never hold more than one in the
      // extension's 10 MB storage budget.
      const taken = await Promise.race([failed, waitForValue(
        K_TAKEN,
        (v) => v && v.batchId === batchId && v.seq === seq,
        HANDOFF_TIMEOUT_MS,
      )]);
      if (!taken) throw new Error('no receipt from the Strava tab');
      console.log(TAG, `Strava took activity ${activity.id} (${since(receiptStart)})`);
    }

    GM_setValue(K_HANDOFF, {
      batchId, ids, count: ids.length, state: 'done', ts: Date.now(),
    });
    console.log(TAG, 'all files sent; waiting for Strava to confirm the upload');
    setStatus('Waiting for Strava to start the upload…');

    await Promise.race([failed,
      waitForValue(K_ACK, (v) => v && v.batchId === batchId, HANDOFF_TIMEOUT_MS)]);

    // Only now — after the files are actually attached and uploading — do
    // these count as sent. Anything short of that leaves them new, so the
    // next click retries them.
    recordSeen(ids);
    console.log(TAG, `Strava confirmed ${ids.length} file(s) after ` +
      `${since(batchStart)} total; recorded as sent`);
    setStatus(`Sent ${plural(ids.length, 'activity', 'activities')} to Strava.`,
      { done: true });
  }

  function clearBatchKeys() {
    for (const key of [K_HANDOFF, K_CLAIM, K_FILE, K_TAKEN, K_ACK, K_FAIL]) {
      GM_deleteValue(key);
    }
  }

  // ------------------------------------------------------------- buttons

  function onActivitiesClick(event) {
    event.preventDefault();
    console.log(TAG, 'Activities clicked');
    window.location.assign(ACTIVITIES_URL);
  }

  function onUploadClick(event) {
    event.preventDefault();
    startUpload(false);
  }

  // `fromStrava` means the run was started by Strava's "Upload from
  // Garmin" item, so the tab that started it is on its way to the upload
  // page and should be given time to take the batch itself.
  function startUpload(fromStrava) {
    // Everything that needs the click's user-activation — reading the
    // list, opening tabs — happens synchronously here. GM_getValue is
    // synchronous, so the whole decision is made before we yield.
    if (location.pathname !== ACTIVITIES_PATH) {
      console.log(TAG, 'not on the activities list; navigating there first');
      toast('Opening the Activities list — click Upload to Strava again.');
      window.location.assign(ACTIVITIES_URL);
      return;
    }

    const listed = listedActivities();
    if (!listed.length) {
      console.log(TAG, 'no activity links found on the page');
      toast('No activities found on this page.');
      return;
    }

    const seen = loadSeen();
    const seenSet = new Set(seen || []);
    const recognized = listed.filter((a) => seenSet.has(a.id)).length;

    let fresh;
    if (seen === null || recognized === 0) {
      // Either we've never run, or our memory has nothing in common with
      // what's on the page — a cleared history, or a long enough gap that
      // the whole list has turned over. Both look identical from here:
      // every activity is "new", and silently sending twenty rides to
      // Strava is not what anyone wants. Ask instead.
      const headline = seen === null
        ? 'First upload.'
        : 'None of the listed activities have been uploaded before.';
      const count = askCount(
        `${headline} The newest N activities will be uploaded to Strava. ` +
        `How many should we send? (0–${listed.length})\n\n` +
        'After this, previously uploaded activities will be remembered.',
        listed.length);
      if (count === null) {
        console.log(TAG, 'first-run prompt cancelled; nothing changed');
        return;
      }
      // Everything older than the newest `count` is declared already
      // uploaded right away. The ones we're about to send are recorded
      // only once Strava confirms them, same as any other batch.
      keepNewestUnsent(listed, count);
      console.log(TAG, `first run: sending the newest ${count} of ${listed.length}, ` +
        `recorded the other ${listed.length - count} as already sent`);
      if (count === 0) {
        toast(`Recorded all ${listed.length} listed activities as already uploaded.`);
        return;
      }
      // Listed newest first; send oldest first so Strava lists them in
      // the order they happened.
      fresh = listed.slice(0, count).reverse();
    } else {
      fresh = listed.filter((a) => !seenSet.has(a.id)).reverse();
      if (!fresh.length) {
        console.log(TAG, 'no new activities');
        toast('No new activities to send.');
        return;
      }
    }

    console.log(TAG, `${fresh.length} new activit${fresh.length === 1 ? 'y' : 'ies'}:`,
      fresh.map((a) => a.id).join(', '));

    clearBatchKeys();
    const batchId = `b${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    setStatus(`Starting — ${plural(fresh.length, 'new activity', 'new activities')} to send…`);

    runBatch(batchId, fresh, fromStrava).catch((err) => {
      const message = (err && err.message) || 'unknown error';
      console.log(TAG, 'batch failed:', message);
      clearBatchKeys();

      if (/signed in/.test(message)) {
        // The upload tab that bounced is in the background, and a page
        // can't pull itself to the front — window.focus() from a
        // background tab is ignored. So open the login page in the
        // foreground instead, and leave the explanation there, where the
        // user will actually be looking.
        GM_setValue(K_SIGNIN_HINT, {
          ts: Date.now(),
          message: `Sign in to Strava, then click Upload to Strava on the Garmin ` +
            `tab to send ${fresh.length} activit${fresh.length === 1 ? 'y' : 'ies'}.`,
        });
        GM_openInTab(STRAVA_LOGIN_URL, { active: true, setParent: true });
        setStatus(`${message}. Sign in on the Strava tab, then click Upload to ` +
          'Strava again.', { error: true });
        return;
      }
      setStatus(`Transfer failed: ${message}. Nothing was recorded as sent — ` +
        'reload and try again.', { error: true });
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
      "Download every activity that hasn't been sent to Strava yet as TCX, " +
      'and upload it', onUploadClick);
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

  function registerMenuCommands() {
    GM_registerMenuCommand('Set how many activities are unsent…', () => {
      const listed = listedActivities();
      if (!listed.length) {
        console.log(TAG, 'menu: no activities listed on this page');
        toast('No activities listed on this page — open the Activities list first.');
        return;
      }
      const count = askCount(
        'The newest N activities will be marked as not yet uploaded, so the ' +
        `next upload sends them. How many? (0–${listed.length})\n\n` +
        'Everything older is recorded as already uploaded.',
        listed.length);
      if (count === null) return;
      keepNewestUnsent(listed, count);
      console.log(TAG, `menu: left the newest ${count} of ${listed.length} unsent`);
      toast(count === 0
        ? `Marked all ${listed.length} listed activities as already uploaded.`
        : `The newest ${count} will be sent on the next upload.`);
    });
    GM_registerMenuCommand('Forget which activities were sent', () => {
      GM_deleteValue(K_SEEN);
      clearBatchKeys();
      refreshNewBadges();
      console.log(TAG, 'cleared the sent-activity history');
      toast('Cleared the sent-activity history — the next upload will ask how ' +
        'many to send.');
    });
  }

  // =====================================================================
  //                          Strava upload side
  // =====================================================================

  // The upload page is a plain multipart form — no Dropzone instance on
  // this element — and the page starts uploading as soon as the input
  // fires a change event. So attaching the files is the whole submit.
  const STRAVA_INPUT_SELECTOR =
    'form[action*="/upload/files"] input[type="file"][name="files[]"]';

  // We match all of strava.com, not just /upload/*, so that a redirect to
  // the login page still lands somewhere this script runs and can say so.
  const STRAVA_UPLOAD_PATH_RE = /^\/upload(\/|$)/;
  // How soon after a batch starts a non-upload Strava page counts as "the
  // tab we just opened got bounced" rather than ordinary browsing.
  const BOUNCE_WINDOW_MS = 60000;

  // Strava's global nav holds the upload drop-down. Plain server-rendered
  // markup, no framework: li.upload-menu > ul.options > li > a.
  const STRAVA_MENU_SELECTOR = 'li.upload-menu ul.options';
  const STRAVA_MENU_ITEM_ID = 'jshute-strava-upload-from-garmin';
  const GARMIN_TRIGGER_URL = ACTIVITIES_URL + TRIGGER_HASH;

  function ensureStravaMenuItem() {
    if (document.getElementById(STRAVA_MENU_ITEM_ID)) return false;
    const list = document.querySelector(STRAVA_MENU_SELECTOR);
    if (!list) return false;

    const item = document.createElement('li');
    item.id = STRAVA_MENU_ITEM_ID;
    const link = document.createElement('a');
    link.href = GARMIN_TRIGGER_URL;
    link.title = 'Open Garmin Connect and upload every activity that ' +
      "hasn't been sent to Strava yet";
    // Borrow the Upload activity icon so our label lines up with the
    // items below it rather than sitting flush against the edge.
    const icon = document.createElement('span');
    icon.className = 'upload-activity app-icon icon-upload-activity';
    link.appendChild(icon);
    link.appendChild(document.createTextNode('Upload from Garmin'));
    link.addEventListener('click', (event) => {
      event.preventDefault();
      // Foreground, so the first-run prompt and any notices are visible,
      // and so this Strava page survives for the upload tab to come back to.
      console.log(TAG, 'Upload from Garmin clicked; opening Garmin activities');
      GM_openInTab(GARMIN_TRIGGER_URL, { active: true, setParent: true });
      // Put *this* tab on the upload page so it can take the files
      // itself. Garmin waits for a claim before opening its own tab, so
      // the transfer lands back here rather than in a third tab. Done
      // after GM_openInTab, since navigating away tears this script down.
      if (!STRAVA_UPLOAD_PATH_RE.test(location.pathname)) {
        console.log(TAG, 'sending this tab to the upload page to receive the files');
        window.location.assign(STRAVA_UPLOAD_URL);
      }
    });
    item.appendChild(link);
    list.insertBefore(item, list.firstElementChild);
    console.log(TAG, 'added "Upload from Garmin" to the upload menu');
    return true;
  }

  function initStrava() {
    console.log(TAG, 'init on', location.pathname);

    // The nav is on every Strava page, and Strava re-renders parts of it
    // on navigation, so keep re-adding the item if it goes missing.
    ensureStravaMenuItem();
    new MutationObserver(() => ensureStravaMenuItem())
      .observe(document.body, { childList: true, subtree: true });

    // A note left by the Garmin side just before it opened this page.
    const hint = GM_getValue(K_SIGNIN_HINT, null);
    if (hint && Date.now() - hint.ts < 60000) {
      GM_deleteValue(K_SIGNIN_HINT);
      console.log(TAG, 'showing the sign-in hint left by the Garmin tab');
      toast(hint.message, 0);
    }

    const handoff = GM_getValue(K_HANDOFF, null);
    const live = handoff && handoff.state === 'sending' &&
      Date.now() - handoff.ts <= HANDOFF_STALE_MS;

    if (STRAVA_UPLOAD_PATH_RE.test(location.pathname)) {
      // An open upload tab is a standing offer to be the consumer — for
      // the batch running right now and for every later one. So the
      // listener goes on unconditionally and is never torn down: a tab
      // left on this page should keep taking batches for as long as it's
      // open, not just the first.
      //
      // The guard is per-batch rather than a latch. Latching would leave
      // the tab deaf after one transfer (and deaf forever if it lost a
      // claim race), which is exactly the case tab reuse exists for.
      let offered = null;
      const offer = (candidate) => {
        if (!candidate || candidate.state !== 'sending') return;
        if (offered === candidate.batchId) return;
        if (Date.now() - candidate.ts > HANDOFF_STALE_MS) return;
        offered = candidate.batchId;
        tryClaim(candidate);
      };
      GM_addValueChangeListener(K_HANDOFF, (key, oldValue, newValue) => offer(newValue));
      if (live) {
        offer(handoff);
      } else {
        console.log(TAG, 'no batch in flight; waiting to be offered one');
      }
      return;
    }

    if (!live) {
      console.log(TAG, 'no batch in flight; idle');
      return;
    }

    {
      // Strava sends signed-out visitors from /upload/select to /login,
      // and the upload tab we opened is the overwhelmingly likely source
      // of a non-upload Strava page seconds after a batch started. Report
      // it so the Garmin side fails immediately with a useful message
      // rather than waiting out its timeout.
      if (Date.now() - handoff.ts > BOUNCE_WINDOW_MS) {
        console.log(TAG, `on ${location.pathname}, not the upload page; leaving the ` +
          'batch alone (too long after it started to blame this tab)');
        return;
      }
      // Only a sign-in page is real evidence that the upload tab
      // bounced. Any other Strava page is far more likely to be the user
      // browsing in a different tab while a transfer runs — killing
      // their batch for that would be a false positive.
      if (!/login|signup|onboarding/.test(location.pathname)) {
        console.log(TAG, `on ${location.pathname} during a transfer; not the upload ` +
          'page but not a sign-in page either, so leaving the batch alone');
        return;
      }
      const reason = "Strava isn't signed in";
      console.log(TAG, `${reason}; reporting the batch as failed`);
      GM_setValue(K_FAIL, { batchId: handoff.batchId, reason });
      return;
    }
  }

  // Take the batch, but only if we actually won it.
  //
  // GM storage has no compare-and-swap: `GM_setValue` is an
  // unconditional last-write-wins overwrite. Two upload tabs get the
  // same `handoff` broadcast at the same instant, both read no claim,
  // and both write one — so a bare read-then-write would have both tabs
  // collecting the same files and uploading the ride to Strava twice.
  //
  // Instead: write optimistically, let the writes settle, then re-read.
  // Both tabs converge on the same stored value, so exactly one sees its
  // own id and proceeds; the loser stands down.
  function tryClaim(handoff) {
    const me = `s${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const existing = GM_getValue(K_CLAIM, null);
    if (existing && existing.batchId === handoff.batchId) {
      console.log(TAG, 'another upload tab already claimed this batch; idle');
      return;
    }
    GM_setValue(K_CLAIM, { batchId: handoff.batchId, who: me });

    setTimeout(() => {
      const winner = GM_getValue(K_CLAIM, null);
      if (!winner || winner.batchId !== handoff.batchId || winner.who !== me) {
        console.log(TAG, 'lost the claim race to another upload tab; idle');
        return;
      }
      console.log(TAG, `claimed batch ${handoff.batchId}, expecting ${handoff.count} file(s)`);
      setStatus(`Downloading ${plural(handoff.count, 'activity', 'activities')} from Garmin…`);
      collect(handoff.batchId, handoff.count).catch((err) => {
        const message = (err && err.message) || 'unknown error';
        console.log(TAG, 'collection failed:', message);
        setStatus(/timed out/.test(message)
          ? "Gave up waiting for Garmin — the transfer didn't finish. Nothing was " +
            'uploaded; start it again from the Garmin tab.'
          : `Transfer failed: ${message}`, { error: true });
      });
    }, CLAIM_SETTLE_MS);
  }

  async function collect(batchId, count) {
    const collectStart = performance.now();
    const files = [];
    let seq = 0;
    while (files.length < count) {
      seq += 1;
      setStatus(count === 1
        ? 'Downloading from Garmin…'
        : `Downloading activity ${files.length + 1} of ${count} from Garmin…`);
      const waitStart = performance.now();
      const record = await waitForValue(
        K_FILE,
        (v) => v && v.batchId === batchId && v.seq === seq,
        HANDOFF_TIMEOUT_MS,
      );
      const waitTime = since(waitStart);
      setStatus(`Unpacking ${record.name} (${files.length + 1} of ${count})…`);
      const unpackStart = performance.now();
      const blob = await base64ToBlob(record.gz);
      files.push(new File([blob], record.name, { type: 'application/vnd.garmin.tcx+xml' }));
      console.log(TAG, `received ${record.name} (${blob.size} bytes), ` +
        `${files.length}/${count} — waited ${waitTime} for Garmin, ` +
        `unpacked in ${since(unpackStart)}`);
      // Free the slot so the Garmin side sends the next one. Clearing the
      // payload first keeps at most one file in storage.
      GM_deleteValue(K_FILE);
      GM_setValue(K_TAKEN, { batchId, seq });
    }

    setStatus(`Received all ${plural(count, 'activity', 'activities')} — waiting for ` +
      'Garmin to finish…');
    await waitForValue(
      K_HANDOFF,
      (v) => v && v.batchId === batchId && v.state === 'done',
      HANDOFF_TIMEOUT_MS,
    );

    setStatus(`Attaching ${plural(files.length, 'file', 'files')} to the upload form…`);
    const input = await waitForElement(STRAVA_INPUT_SELECTOR, 30000);
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    console.log(TAG, `attached ${files.length} file(s) and started the upload ` +
      `(${since(collectStart)} since claiming the batch)`);

    GM_setValue(K_ACK, { batchId, count: files.length, ts: Date.now() });
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

  if (location.hostname.endsWith('strava.com')) {
    initStrava();
  } else {
    initGarmin();
  }
})();
