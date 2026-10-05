// ==UserScript==
// @name         Spotify: Mark recently played tracks, from last.fm history
// @namespace    https://github.com/jshute96/userscripts
// @version      0.1.1
// @description  Marks tracks in playlists and albums that your last.fm history shows you played in the past week, so you can see where you left off.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://open.spotify.com/*
// last.fm's home page, only so the manager shows its icon and link.
// @match        https://www.last.fm/
// @connect      www.last.fm
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        GM_addStyle
// @grant        GM_log
// @grant        window.onurlchange
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // The last.fm @match is only for the manager's icon.
  if (location.hostname !== 'open.spotify.com') return;

  const log = (...args) => console.log('[recent-plays]', ...args);
  // Problems go through GM_log, which also writes to the page console, so
  // they show up in the manager's log for the script too.
  const warn = (...args) => GM_log(['[recent-plays]', ...args].join(' '));

  const LASTFM = 'https://www.last.fm';
  const HISTORY_DAYS = 7;
  const MAX_PAGES = 15;
  // Refetch the history when it's older than this, on navigation or when
  // the tab comes back into view, so newly scrobbled tracks get marked.
  const STALE_MS = 5 * 60 * 1000;
  // A data attribute, not a class: React rewrites the row's whole class
  // attribute when selection changes, which would drop ours.
  const MARK_ATTR = 'data-recent-plays';
  const MARKED = `[data-testid="tracklist-row"][${MARK_ATTR}]`;
  // The selected row gets a brighter green in place of Spotify's grey.
  const UNSELECTED = '[role="row"]:not([aria-selected="true"]) > ';
  const SELECTED = '[role="row"][aria-selected="true"] > ';

  GM_addStyle(`
    ${MARKED} {
      position: relative;
    }
    ${UNSELECTED}${MARKED} {
      background-color: rgba(30, 215, 96, 0.10) !important;
    }
    ${UNSELECTED}${MARKED}:hover {
      background-color: rgba(30, 215, 96, 0.18) !important;
    }
    ${SELECTED}${MARKED} {
      background-color: rgba(30, 215, 96, 0.30) !important;
    }
    /* The bar sits in the gap left of the row: inside it, it would
       overlap three-digit track numbers. */
    ${MARKED}::before {
      content: "";
      position: absolute;
      left: -8px;
      top: 0;
      bottom: 0;
      width: 4px;
      border-radius: 2px;
      background: #1ed760;
    }
  `);

  // key "title|artist" -> most recent play time (ms)
  let plays = new Map();
  let fetchedAt = 0;
  let fetching = null;

  // Lowercase, strip accents, drop version suffixes like " - Remastered"
  // and "(Reclaimed)", and collapse punctuation, since the two sites
  // format these differently.
  function norm(s) {
    return s
      .normalize('NFKD').replace(/\p{M}/gu, '')
      .toLowerCase()
      .replace(/\s+-\s+.*$/, '')
      .replace(/\s*[([].*?[)\]]/g, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  }

  const key = (title, artist) => norm(title) + '|' + norm(artist);

  function get(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        onload: (r) => r.status === 200
          ? resolve(new DOMParser().parseFromString(r.responseText, 'text/html'))
          : reject(new Error(`HTTP ${r.status} for ${url}`)),
        onerror: () => reject(new Error(`request failed for ${url}`)),
      });
    });
  }

  // The last.fm user comes from the logged-in header on the home page,
  // read once and then remembered.
  async function lastfmUser() {
    let user = GM_getValue('lastfmUser', '');
    if (user) return user;
    const doc = await get(LASTFM + '/');
    const link = doc.querySelector('a.auth-link[href^="/user/"]');
    user = link && decodeURIComponent(link.getAttribute('href').split('/')[2]);
    if (!user) throw new Error('not logged in to last.fm, so no username; log in there');
    log('found last.fm user', user);
    GM_setValue('lastfmUser', user);
    updateMenu();
    return user;
  }

  // Shown only while a username is stored. Resetting makes the next fetch
  // read it again from whoever is logged in to last.fm now.
  let menuId = null;
  function updateMenu() {
    if (menuId !== null) GM_unregisterMenuCommand(menuId);
    menuId = null;
    const user = GM_getValue('lastfmUser', '');
    if (user) menuId = GM_registerMenuCommand(`Reset last.fm user (${user})`, resetUser);
  }

  function resetUser() {
    log('reset last.fm user', GM_getValue('lastfmUser', ''));
    GM_deleteValue('lastfmUser');
    updateMenu();
    fetchedAt = 0;
    refresh();
  }

  // Play time of a history row: the edit form's unix timestamp, else the
  // tooltip like "Friday 25 Sep 2026, 11:23pm".
  function rowTime(row) {
    const input = row.querySelector('input[name="timestamp"]');
    if (input) return Number(input.value) * 1000;
    const title = row.querySelector('.chartlist-timestamp span[title]')?.title || '';
    const m = title.match(/(\d+) (\w{3}) (\d{4}), (\d+):(\d+)(am|pm)/);
    if (!m) return NaN;
    const hour = (Number(m[4]) % 12) + (m[6] === 'pm' ? 12 : 0);
    return new Date(`${m[1]} ${m[2]} ${m[3]} ${hour}:${m[5]}`).getTime();
  }

  async function fetchHistory() {
    const user = await lastfmUser();
    const cutoff = Date.now() - HISTORY_DAYS * 24 * 3600 * 1000;
    const found = new Map();
    for (let page = 1; page <= MAX_PAGES; page++) {
      let doc;
      try {
        doc = await get(`${LASTFM}/user/${encodeURIComponent(user)}/library?page=${page}`);
      } catch (e) {
        // Keep what the earlier pages found: the newest plays matter most.
        if (page === 1) throw e;
        warn(`stopped at page ${page}, keeping the plays found so far:`, e.message);
        break;
      }
      // Only rows with a play time are scrobbles. When the history is
      // private and we're logged out, last.fm shows Top Tracks instead,
      // in the same row markup but with no times.
      const rows = [...doc.querySelectorAll('tr.chartlist-row')]
        .map((row) => ({ row, time: rowTime(row) }))
        .filter(({ time }) => !Number.isNaN(time));
      if (!rows.length) {
        if (page === 1) {
          throw new Error(`no scrobbles visible for ${user}; if the history is private, log in to last.fm`);
        }
        break;
      }
      let reachedCutoff = false;
      for (const { row, time } of rows) {
        const title = row.querySelector('.chartlist-name a')?.title;
        const artist = row.querySelector('.chartlist-artist a')?.title;
        if (time < cutoff) { reachedCutoff = true; break; }
        if (!title || !artist) continue;
        const k = key(title, artist);
        if (!found.has(k)) found.set(k, time);
      }
      if (reachedCutoff) break;
      if (page === MAX_PAGES) warn('stopped at', MAX_PAGES, 'pages before reaching', HISTORY_DAYS, 'days');
    }
    return found;
  }

  function refresh() {
    if (fetching || Date.now() - fetchedAt < STALE_MS) return;
    fetching = fetchHistory()
      .then((found) => {
        plays = found;
        fetchedAt = Date.now();
        (plays.size ? log : warn)('loaded', plays.size, 'tracks played in the last', HISTORY_DAYS, 'days');
        markRows();
      })
      .catch((e) => {
        // Wait out the usual interval before trying again, rather than
        // retrying on every navigation.
        fetchedAt = Date.now();
        warn('failed to load last.fm history:', e.message,
          `(retrying in ${STALE_MS / 60000} minutes)`);
      })
      .finally(() => { fetching = null; });
  }

  function ago(time) {
    const hours = Math.round((Date.now() - time) / 3600000);
    if (hours < 1) return 'less than an hour ago';
    if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    return `${Math.round(hours / 24)} days ago`;
  }

  // Rows are virtualized and reused as the list scrolls, so work out each
  // row's state from its current content every time.
  function markRows() {
    let marked = 0;
    for (const row of document.querySelectorAll('[data-testid="tracklist-row"]')) {
      const title = row.querySelector('[data-testid="internal-track-link"]')?.textContent;
      const artists = [...row.querySelectorAll('a[href^="/artist/"]')].map((a) => a.textContent);
      let time;
      if (title) {
        for (const artist of artists) {
          time = plays.get(key(title, artist));
          if (time) break;
        }
      }
      const tip = time ? `Played on last.fm ${ago(time)}` : null;
      if (row.hasAttribute(MARK_ATTR) !== !!time) row.toggleAttribute(MARK_ATTR, !!time);
      if (tip) {
        marked++;
        if (row.title !== tip) row.title = tip;
      } else if (row.hasAttribute('title')) {
        row.removeAttribute('title');
      }
    }
    return marked;
  }

  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled || !plays.size) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; markRows(); });
  }).observe(document.body, { childList: true, subtree: true, characterData: true });

  // Violentmonkey has no window.onurlchange (it stays undefined, where
  // managers that support it set it to null); the Navigation API's
  // currententrychange fires on the same history changes.
  if (window.onurlchange === null) window.addEventListener('urlchange', refresh);
  else if (window.navigation) window.navigation.addEventListener('currententrychange', refresh);
  else log('no urlchange event or Navigation API; in-page navigation is not tracked');
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh();
  });

  // For debugging with eval --script.
  window.recentPlays = { get plays() { return plays; }, markRows, refresh, norm };

  log('init');
  updateMenu();
  refresh();
})();
