// ==UserScript==
// @name         Strava: Show multiple rank summaries on segment leaderboard pane
// @namespace    https://github.com/jshute96/userscripts
// @version      0.2.4
// @description  Enhances the segment leaderboard to show the ranks for multiple dimensions all at once, computes a rank for My Results, and adds month and week views.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://www.strava.com/activities/*
// @grant        none
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[strava-ranks]';
  const PANEL_CLASS = 'jshute-rank-panel';
  const ROW_CLASS = 'jshute-rank-row';
  const NUM_CLASS = 'jshute-rank-num';
  const SLASH_CLASS = 'jshute-rank-slash';
  const COUNT_CLASS = 'jshute-rank-count';
  const ACTIVE_CLASS = 'jshute-rank-active';
  const STYLE_MARK = 'data-jshute-rank-style';
  // Strava's own class for "this row is you", which renders the row bold.
  const HIGHLIGHT_CLASS = 'current-athlete';
  const DEBOUNCE_MS = 100;
  // A leaderboard with no segment id yet is the normal first frame, so say so
  // only once it has gone on long enough to mean the anchor moved.
  const WAITING_WARN_MS = 10000;

  // Rows to show, top to bottom.
  //
  // `params` are the leaderboard endpoint's query parameters. `filter` is the
  // data-filter value of the dropdown option we click to switch the table.
  // `injectOption: true` means Strava has no such option and we add one — see
  // "Extending Strava's dropdown" below.
  //
  // The two lists are independent. `inPanel: false` keeps a view in the dropdown
  // without giving it a row, which also means it is never prefetched — a row is
  // what costs a request per segment expanded.
  const DIMENSIONS = [
    {
      key: 'overall',
      label: 'All-time',
      filter: 'overall',
      params: { filter: 'overall', gender: 'all' },
      // The server reports viewer_rank whatever the page size, so ask for the
      // smallest response that carries it.
      perPage: 1,
    },
    {
      key: 'current_year',
      label: 'This Year',
      filter: 'current_year',
      params: { filter: 'current_year', date_range: 'this_year' },
      perPage: 1,
    },
    {
      key: 'this_month',
      label: 'This Month',
      filter: 'current_year',
      params: { filter: 'current_year', date_range: 'this_month' },
      perPage: 1,
      injectOption: true,
    },
    {
      key: 'this_week',
      label: 'This Week',
      filter: 'current_year',
      params: { filter: 'current_year', date_range: 'this_week' },
      perPage: 1,
      injectOption: true,
      // Selectable from the dropdown, but not worth a row or a request.
      inPanel: false,
    },
    {
      key: 'my_results',
      label: 'My Results',
      filter: 'my_results',
      params: { filter: 'my_results' },
      // No viewer_rank here, so the rank has to be found among the rows.
      rankFromRows: true,
      perPage: 10,
    },
  ];

  // This endpoint meters hard and recovers slowly: one burst of requests tripped
  // it, and every /segments/ URL kept returning 429 for at least 24 hours after —
  // in a logged-out browser too, so don't assume a fresh session escapes it.
  // Since failures aren't cached (so a blip recovers), back off explicitly
  // instead — otherwise every re-render would retry into a throttle that may
  // well extend itself.
  const RATE_LIMIT_COOLDOWN_MS = 60000;
  let cooldownUntil = 0;

  // The server silently clamps per_page to 100 — ask for 1000 and it echoes 100.
  const MAX_PER_PAGE = 100;
  // 500 of your own efforts on one segment before we give up and show a dash.
  const MAX_PAGES = 5;

  // segmentId:dimensionKey -> Promise<{rank, count}>. Kept across re-renders so
  // switching filters (which rebuilds the whole leaderboard) doesn't refetch.
  const cache = new Map();

  // ------------------------------------------------------------- page facts

  // The expanded segment effort's id is in the URL: expanding a segment
  // pushState()s /activities/<activity>/segments/<effort>.
  function currentEffortId() {
    const m = location.pathname.match(/^\/activities\/\d+\/segments\/(\d+)/);
    return m ? m[1] : null;
  }

  // The "View full leaderboard" link is the only place the segment id appears
  // in the leaderboard's own markup.
  function segmentIdFor(leaderboard) {
    const link = leaderboard.querySelector('.leaderboard-footer a[href*="/segments/"]');
    const m = link && link.getAttribute('href').match(/\/segments\/(\d+)/);
    return m ? m[1] : null;
  }

  // Strava swaps the Athlete and Date columns rather than rebuilding the table,
  // so a hidden Athlete column is what "we're in My Results" looks like.
  function showingMyResults(leaderboard) {
    const athleteCol = leaderboard.querySelector('th.results-col-js');
    return !!athleteCol && athleteCol.offsetParent === null;
  }

  // ------------------------------------------------------------- fetching

  // Same endpoint the dropdown uses. Same-origin, session cookies, no CSRF
  // token needed.
  async function fetchLeaderboard(segmentId, params) {
    if (Date.now() < cooldownUntil) {
      throw new Error('backing off after HTTP 429');
    }
    const query = new URLSearchParams(Object.assign(
      { page: 1, per_page: 10, viewer_context: true }, params));
    const url = `/segments/${segmentId}/leaderboard?${query}`;
    const response = await fetch(url, {
      credentials: 'same-origin',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    if (response.status === 429) {
      // Requests go out together, so several can come back 429 at once. Only
      // the one that opens the cooldown says so.
      if (Date.now() >= cooldownUntil) {
        console.log(`${TAG} rate limited; pausing lookups for ` +
          `${RATE_LIMIT_COOLDOWN_MS / 1000}s`);
      }
      cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return response.json();
  }

  // My Results returns no viewer_rank at all — every row is you, so there is no
  // "your position among these" for the server to report. The rank we want is
  // the current ride's position among your own efforts, which is the `rank` of
  // whichever returned row is this activity's effort.
  function rankOfCurrentEffort(rows) {
    const effortId = currentEffortId();
    if (!effortId) return null;
    const mine = (rows || []).find((row) => String(row.id) === effortId);
    return mine ? mine.rank : null;
  }

  // A date_range Strava doesn't recognize is ignored rather than rejected, and
  // the response quietly falls back to all-time. The echoed parameter is the
  // only way to tell that apart from a real answer.
  function checkDateRange(data, dimension) {
    const asked = dimension.params.date_range || null;
    if ((data.date_range || null) !== asked) {
      throw new Error(`server ignored date_range=${asked}`);
    }
  }

  // Finding the current effort's rank means finding its row, so a rank past the
  // page size needs more rows. Start at the ten the table itself shows — which
  // is where the effort is for almost everyone, and the cheapest request — and
  // only page through hundreds when it isn't there. Paging is sequential rather
  // than parallel so the common "found on the next page" case costs one request,
  // not MAX_PAGES of them.
  async function rankByPaging(segmentId, dimension, first) {
    const rows = first.top_results || [];
    let rank = rankOfCurrentEffort(rows);
    const count = first.top_results_count;
    if (rank != null || count <= rows.length) return rank;

    const pages = Math.min(Math.ceil(count / MAX_PER_PAGE), MAX_PAGES);
    for (let page = 1; page <= pages; page++) {
      const chunk = await fetchLeaderboard(
        segmentId, Object.assign({}, dimension.params, { page, per_page: MAX_PER_PAGE }));
      rank = rankOfCurrentEffort(chunk.top_results);
      if (rank != null) return rank;
    }
    console.log(`${TAG} effort not among the first ` +
      `${Math.min(pages * MAX_PER_PAGE, count)} of ${count} ` +
      `${dimension.key} results`);
    return null;
  }

  function ranksFor(segmentId, dimension) {
    const cacheKey = `${segmentId}:${dimension.key}`;
    if (!cache.has(cacheKey)) {
      const pending = (async () => {
        const first = await fetchLeaderboard(
          segmentId, Object.assign({}, dimension.params, { per_page: dimension.perPage }));
        checkDateRange(first, dimension);
        const rank = dimension.rankFromRows
          ? await rankByPaging(segmentId, dimension, first)
          : first.viewer_rank;
        const result = { rank: rank == null ? null : rank, count: first.top_results_count };
        console.log(`${TAG} segment ${segmentId} ${dimension.key}: ` +
          `${result.rank == null ? '-' : result.rank}/${result.count}`);
        return result;
      })();
      // Never cache a failure. This endpoint rate-limits (429), and a cached
      // rejection would keep a segment permanently blank instead of retrying on
      // the next render.
      pending.catch(() => cache.delete(cacheKey));
      cache.set(cacheKey, pending);
    }
    return cache.get(cacheKey);
  }

  // ------------------------------------------------------------- rendering

  function installStyles() {
    if (document.head.querySelector(`style[${STYLE_MARK}]`)) return;
    const style = document.createElement('style');
    style.setAttribute(STYLE_MARK, '');
    // One grid for the whole panel rather than a flex box per row: a row that
    // sized itself put its own numbers wherever its own text ended, so a wide
    // total (2963 /31357 against 27 /53) knocked that row out of line with the
    // rest, and rows arriving in different orders rearranged it again.
    //
    // Four columns — label, rank, slash, total — so both numbers right-justify
    // to their own edge and the slash sits in a column of its own between them.
    // Each column is as wide as the widest thing in it and simply widens when a
    // slower lookup brings a wider number. The slash carries equal padding on
    // both sides, so the gap is symmetric rather than Strava's space-then-slash.
    //
    // Rows stay real elements — they carry the click handler, the active class
    // and the dimension key — but generate no box of their own, so their cells
    // are direct children of the grid and share its columns.
    style.textContent = `
      .${PANEL_CLASS} {
        display: grid; grid-template-columns: 1fr auto auto auto;
        align-items: baseline; font-size: 14px; line-height: 18px;
      }
      .${PANEL_CLASS} .${ROW_CLASS} { display: contents; cursor: pointer; }
      .${PANEL_CLASS} .${ROW_CLASS} > * { white-space: nowrap; }
      .${PANEL_CLASS} .${NUM_CLASS} { text-align: right; padding-left: 8px; }
      .${PANEL_CLASS} .${SLASH_CLASS} { padding: 0 0.25em; }
      .${PANEL_CLASS} .${COUNT_CLASS} { text-align: right; }
      .${PANEL_CLASS} .${ACTIVE_CLASS} > * { background: #eee; }
      .${PANEL_CLASS} .${ROW_CLASS}:hover > * { background: #f5f5f5; }
    `;
    document.head.appendChild(style);
  }

  // Reuse Strava's own .rank element and inner markup rather than restyling a
  // lookalike, so these read identically to the all-time rank beside them —
  // including the space before the slash, which comes from the whitespace
  // Strava's template leaves inside the <strong>, and the fact that .rank strong
  // is not actually bold.
  function renderValue(cells, result) {
    for (const cell of Object.values(cells)) cell.textContent = '';
    if (result === null) {
      cells.num.textContent = '…';
      return;
    }
    const rank = document.createElement('strong');
    rank.textContent = result.rank == null ? '–' : result.rank;
    cells.num.appendChild(rank);
    // The slash is its own cell, so the spacing around it is padding rather
    // than the space character Strava's own markup uses.
    cells.slash.textContent = '/';
    cells.count.textContent = result.count;
  }

  // ------------------------------------------- extending Strava's dropdown
  //
  // Strava's filter click handler is a switch over data-filter values, and it
  // has no case for a month or a week — its `current_year` case hard-codes
  // date_range: 'this_year'. The switch lives in a closure we can't add a case
  // to, and the options list is rebuilt from a template on every render.
  //
  // So rather than reimplementing the table, we let Strava handle the entire
  // click — request, re-render, column swap, dropdown label — and substitute the
  // single query parameter it doesn't know to send, inside the model's own sync.
  // Everything downstream is Strava's code path, unchanged.

  // { range, segmentId } while a click is in flight. Scoped to the segment whose
  // dropdown was clicked, because with two segments expanded an unrelated sync
  // firing in between would otherwise take the range with it — and the injected
  // view would render This Year's data under a "This Month" label, which is the
  // exact failure this whole approach refuses to ship.
  let pendingRange = null;
  let canExtendDropdown = false;
  let warnedNoStrava = false;

  // Backbone resolves the request URL from options.url or the model's own url.
  function syncIsForSegment(leaderboardModel, options, segmentId) {
    if (!segmentId) return true;
    const raw = (options && options.url)
      || (leaderboardModel && (typeof leaderboardModel.url === 'function'
        ? leaderboardModel.url() : leaderboardModel.url));
    const named = typeof raw === 'string' && raw.match(/\/segments\/(\d+)/);
    // Reject only a request that names a *different* segment. A URL we can't
    // read is treated as a match, so an unexpected shape falls back to the old
    // "next sync wins" behavior rather than dropping the range silently.
    return !named || named[1] === segmentId;
  }

  // Last line of defense for the substitution: an unrecognized or dropped
  // date_range comes back as an ordinary all-time leaderboard rather than an
  // error, so the only way to know the table on screen is the view that was
  // asked for is to read the parameter the server echoes.
  function verifyRenderedRange(originalSuccess, range) {
    return function (response) {
      const echoed = (response && response.date_range) || null;
      if (echoed !== range) {
        console.log(`${TAG} table came back as date_range=${echoed}, not ` +
          `${range}; the view shown is not the one selected`);
      }
      if (typeof originalSuccess === 'function') {
        return originalSuccess.apply(this, arguments);
      }
    };
  }

  function patchLeaderboardSync() {
    const model = window.Strava && window.Strava.Models
      && window.Strava.Models.SegmentLeaderboard;
    const proto = model && model.prototype;
    if (!proto || typeof proto.sync !== 'function') {
      // Only the extra date ranges depend on this; without it the panel still
      // works, minus the two views Strava has no option for. Don't inject
      // options we can't make work — a This Month that quietly showed This Year
      // would be worse than not offering it.
      if (!warnedNoStrava) {
        warnedNoStrava = true;
        console.log(`${TAG} Strava.Models.SegmentLeaderboard not reachable ` +
          '(page-context access needed); skipping the extra date ranges');
      }
      return false;
    }
    if (proto.jshutePatched) return true;
    const original = proto.sync;
    proto.sync = function (method, leaderboardModel, options) {
      const wanted = pendingRange;
      if (wanted && options && options.data
          && syncIsForSegment(leaderboardModel, options, wanted.segmentId)) {
        options.data = Object.assign({}, options.data, { date_range: wanted.range });
        options.success = verifyRenderedRange(options.success, wanted.range);
        // One request only. The click handler clears it on the next tick anyway,
        // in case Strava's handler decided not to fetch at all.
        pendingRange = null;
      }
      return original.call(this, method, leaderboardModel, options);
    };
    proto.jshutePatched = true;
    console.log(`${TAG} patched leaderboard sync; extra date ranges available`);
    return true;
  }

  // Runs before Strava's own delegated handler, so the range is in place by the
  // time its click handler reaches fetch(). Registered once, on the document.
  function onFilterClickCapture(event) {
    const option = event.target.closest && event.target.closest('.drop-down-menu .clickable');
    if (!option) return;
    const key = option.dataset.jshuteKey || '';
    const dimension = DIMENSIONS.find((d) => d.key === key);
    const range = dimension ? dimension.params.date_range : null;
    // Remember which of ours is showing. Strava's own options clear it, which is
    // what tells the panel that none of our injected views is current.
    const leaderboard = option.closest('.segment-leaderboard');
    if (leaderboard) leaderboard.dataset.jshuteActive = key;
    pendingRange = range
      ? { range, segmentId: leaderboard && segmentIdFor(leaderboard) }
      : null;
    // A stale range would otherwise ride along on the next unrelated fetch.
    setTimeout(() => { pendingRange = null; }, 0);
  }

  function injectOptions(leaderboard) {
    if (!canExtendDropdown) return;
    const list = leaderboard.querySelector('.drop-down-menu.leaderboard-filter ul.options');
    if (!list) return;
    const own = list.querySelector('.clickable[data-filter="current_year"]:not([data-jshute-key])');
    let after = own && own.closest('li');
    if (!after) return;
    for (const dimension of DIMENSIONS) {
      if (!dimension.injectOption) continue;
      const existing = list.querySelector(`.clickable[data-jshute-key="${dimension.key}"]`);
      if (existing) { after = existing.closest('li'); continue; }
      const item = document.createElement('li');
      const clickable = document.createElement('div');
      clickable.className = 'clickable';
      // data-filter is what Strava's switch reads, so it takes the current_year
      // path; data-jshute-key is what tells us to swap the range.
      clickable.dataset.filter = dimension.filter;
      clickable.dataset.jshuteKey = dimension.key;
      clickable.textContent = dimension.label;
      item.appendChild(clickable);
      after.after(item);
      after = item;
    }
  }

  // Strava rebuilds the dropdown label from the first option matching the
  // response's filter, and both of our injected views report back as
  // `current_year` — so both would read "This Year". Correct it to the view
  // actually showing.
  function correctFilterLabel(leaderboard) {
    const key = leaderboard.dataset.jshuteActive;
    if (!key) return;
    const dimension = DIMENSIONS.find((d) => d.key === key);
    const label = leaderboard.querySelector('.drop-down-menu .selection .filter-js');
    if (!dimension || !label) return;
    const current = label.textContent.trim();
    if (current === dimension.label) return;
    // The remembered key is only cleared by clicking one of Strava's own
    // options, so a re-render from any other cause could leave it forcing a
    // label onto a table that has moved on. An injected view always lands on
    // the built-in option it borrows, so that is the only text worth
    // overwriting — anything else means the key is stale.
    const base = leaderboard.querySelector('.drop-down-menu ' +
      `.clickable[data-filter="${dimension.filter}"]:not([data-jshute-key])`);
    if (!base || base.textContent.trim() !== current) {
      delete leaderboard.dataset.jshuteActive;
      return;
    }
    label.textContent = dimension.label;
  }

  // Drive the table through Strava's own dropdown rather than re-rendering it
  // ourselves: its click handler is jQuery-delegated on the leaderboard root,
  // so a plain click() reaches it, and its render() then updates the dropdown
  // label from the option we clicked. The selection stays consistent for free.
  function selectFilter(leaderboard, dimension) {
    const selector = dimension.injectOption
      ? `.drop-down-menu .clickable[data-jshute-key="${dimension.key}"]`
      : `.drop-down-menu .clickable[data-filter="${dimension.filter}"]:not([data-jshute-key])`;
    const option = leaderboard.querySelector(selector);
    if (!option) {
      console.log(`${TAG} no dropdown option for ${dimension.key}`);
      return;
    }
    console.log(`${TAG} switching table to ${dimension.key}`);
    option.click();
  }

  function buildPanel(leaderboard, segmentId) {
    const panel = document.createElement('div');
    panel.className = `spans-half ${PANEL_CLASS}`;

    for (const dimension of DIMENSIONS.filter((d) => d.inPanel !== false)) {
      const row = document.createElement('div');
      row.className = ROW_CLASS;
      row.dataset.jshuteKey = dimension.key;

      const label = document.createElement('span');
      label.className = 'jshute-rank-label';
      label.textContent = dimension.label;

      // Every cell carries Strava's own .rank class, so each part keeps the
      // weight it has in Strava's markup: the container is 300 and the <strong>
      // inside the number is 400, which reads darker rather than bolder.
      const cells = {};
      for (const [name, cls] of [['num', NUM_CLASS], ['slash', SLASH_CLASS],
        ['count', COUNT_CLASS]]) {
        cells[name] = document.createElement('span');
        cells[name].className = `rank ${cls}`;
      }
      renderValue(cells, null);

      row.append(label, cells.num, cells.slash, cells.count);
      row.addEventListener('click', () => selectFilter(leaderboard, dimension));
      panel.appendChild(row);

      ranksFor(segmentId, dimension).then(
        (result) => { renderValue(cells, result); fitDetail(leaderboard); },
        (error) => {
          console.log(`${TAG} ${dimension.key} lookup failed:`, error);
          renderValue(cells, null);
          cells.num.textContent = '?';
          fitDetail(leaderboard);
        });
    }
    return panel;
  }

  // The expanded segment detail is absolutely positioned with `overflow: hidden`
  // and an inline height Strava measures once, when it renders the detail —
  // mirrored as a padding-bottom on every cell of the row, to reserve the space.
  // Anything added afterwards is simply clipped, which cost us the "View full
  // leaderboard" button. Grow both to fit when our content overflows.
  //
  // Only ever grows, so it converges rather than fighting Strava's own value,
  // and re-runs if Strava re-measures after a filter change.
  function fitDetail(leaderboard) {
    const detail = leaderboard.closest('.segment-effort-detail');
    const content = detail && detail.querySelector(':scope > .content');
    if (!content) return;
    const reserved = parseFloat(detail.style.height);
    if (!reserved) return;
    const needed = Math.ceil(content.getBoundingClientRect().height);
    // Strava's own value can sit a sub-pixel under the ceiling of the measured
    // height, so ignore a 1px shortfall rather than nudging it on every render.
    if (needed <= reserved + 1) return;
    detail.style.height = `${needed}px`;
    const row = detail.closest('tr');
    for (const cell of row ? row.children : []) {
      if (cell.style.paddingBottom) cell.style.paddingBottom = `${needed}px`;
    }
    console.log(`${TAG} grew segment detail ${reserved}px -> ${needed}px to fit`);
  }

  // Mark whichever of our rows matches the filter the table is currently
  // showing. Runs on every pass, since the table can also be switched from the
  // dropdown itself.
  function markActiveRow(panel, leaderboard) {
    // For our injected views the dropdown label is ambiguous (both report as
    // This Year), so the remembered key wins where we have one. Otherwise fall
    // back to the label, which also catches the user picking from the dropdown.
    const activeKey = leaderboard.dataset.jshuteActive;
    const selected = leaderboard.querySelector('.drop-down-menu .selection .filter-js');
    const selectedText = selected ? selected.textContent.trim().toLowerCase() : '';
    for (const row of panel.querySelectorAll(`.${ROW_CLASS}`)) {
      const dimension = DIMENSIONS.find((d) => d.key === row.dataset.jshuteKey);
      const active = activeKey
        ? row.dataset.jshuteKey === activeKey
        : !!dimension && dimension.label.toLowerCase() === selectedText;
      row.classList.toggle(ACTIVE_CLASS, active);
    }
  }

  // In My Results every row is you, so Strava's own highlight rule (row athlete
  // === viewer) is switched off there and no row is bold. The row worth calling
  // out instead is this ride's effort.
  function highlightCurrentEffort(leaderboard) {
    if (!showingMyResults(leaderboard)) return;
    const effortId = currentEffortId();
    if (!effortId) return;
    const link = leaderboard.querySelector(
      `tbody a[href="/segment_efforts/${effortId}"]`);
    const row = link && link.closest('tr');
    if (!row || row.classList.contains(HIGHLIGHT_CLASS)) return;
    row.classList.add(HIGHLIGHT_CLASS);
    console.log(`${TAG} highlighted this ride's effort in My Results`);
  }

  // In My Results, Strava has no rank to report and prints an en dash. We do
  // have one — where this ride sits among your own efforts — so fill in Strava's
  // own display rather than showing the answer on the right beside a dash on the
  // left. Only the <strong> placeholder is replaced, leaving the " /N" text node
  // Strava rendered, so the result is its own markup with a number in it.
  //
  // Nothing needs undoing: a filter change rebuilds the whole subtree from the
  // server's response, taking this with it.
  function fillInViewerRank(leaderboard, segmentId) {
    if (!showingMyResults(leaderboard)) return;
    const prComparison = leaderboard.querySelector('.pr-comparison');
    if (!prComparison) return;
    // The viewer's block is the last one Strava renders; on someone else's
    // activity the first belongs to them, and is not ours to touch.
    const halves = [...prComparison.querySelectorAll(`.spans-half:not(.${PANEL_CLASS})`)];
    const rank = halves.length ? halves[halves.length - 1].querySelector('.rank') : null;
    const placeholder = rank && rank.querySelector('strong');
    if (!placeholder || placeholder.dataset.jshuteFilled) return;
    if (/\d/.test(placeholder.textContent)) return;

    const dimension = DIMENSIONS.find((d) => d.key === 'my_results');
    if (!dimension) return;
    ranksFor(segmentId, dimension).then((result) => {
      if (result.rank == null || !showingMyResults(leaderboard)) return;
      if (!placeholder.isConnected || placeholder.dataset.jshuteFilled) return;
      // Strava's own markup puts whitespace inside this <strong>, and that is
      // where the space before the slash comes from. Keep it.
      placeholder.textContent = ` ${result.rank} `;
      placeholder.dataset.jshuteFilled = '1';
      console.log(`${TAG} filled in My Results rank ${result.rank} on Strava's own display`);
    }, () => {});
  }

  // The first sweep after a segment is expanded usually beats the footer link
  // into the DOM, so "no segment id" is the normal startup path, not a failure —
  // until it goes on, at which point the link is the selector that moved.
  let waitingSince = 0;
  let warnedWaiting = false;

  function enhance(leaderboard) {
    const prComparison = leaderboard.querySelector('.pr-comparison');
    if (!prComparison) return;
    const segmentId = segmentIdFor(leaderboard);
    if (!segmentId) {
      if (!waitingSince) waitingSince = Date.now();
      if (!warnedWaiting && Date.now() - waitingSince > WAITING_WARN_MS) {
        warnedWaiting = true;
        console.log(`${TAG} still no segment id after ` +
          `${WAITING_WARN_MS / 1000}s; check ` +
          '.leaderboard-footer a[href*="/segments/"]');
      }
      return;
    }
    waitingSince = 0;
    warnedWaiting = false;

    let panel = prComparison.querySelector(`.${PANEL_CLASS}`);
    if (!panel) {
      installStyles();
      panel = buildPanel(leaderboard, segmentId);
      prComparison.appendChild(panel);
      fitDetail(leaderboard);
      console.log(`${TAG} added rank panel for segment ${segmentId}`);
    }
    injectOptions(leaderboard);
    correctFilterLabel(leaderboard);
    markActiveRow(panel, leaderboard);
    highlightCurrentEffort(leaderboard);
    fillInViewerRank(leaderboard, segmentId);
  }

  // Every filter change replaces the whole .segment-leaderboard subtree, taking
  // our panel with it, so this has to re-run rather than fire once.
  function sweep() {
    // Strava's bundles may not have run yet at document-idle, so keep trying
    // until the model exists.
    if (!canExtendDropdown) canExtendDropdown = patchLeaderboardSync();
    for (const leaderboard of document.querySelectorAll('.segment-leaderboard')) {
      enhance(leaderboard);
    }
  }

  let pending = null;
  function scheduleSweep() {
    if (pending) return;
    pending = setTimeout(() => { pending = null; sweep(); }, DEBOUNCE_MS);
  }

  console.log(`${TAG} init`);
  canExtendDropdown = patchLeaderboardSync();
  document.addEventListener('click', onFilterClickCapture, true);
  new MutationObserver(scheduleSweep).observe(document.body, {
    childList: true,
    subtree: true,
  });
  sweep();
})();
