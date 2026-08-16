// ==UserScript==
// @name         Garmin Connect: Improve UI in MTB Dynamics jumps view
// @namespace    https://github.com/jshute96/userscripts
// @version      1.3.4
// @description  Colors jumps by size, links jumps on the map to rows in the jumps table, and adds filtering by minimum jump size. Find the large jumps easily!
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://connect.garmin.com/app/*
// @grant        none
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[mtb-jumps]';
  const STYLE_ID = 'jshute-mtb-jumps-style';
  const HIDE_CHARTS_BUTTON_ID = 'jshute-mtb-jumps-hide-charts-btn';
  const LEGEND_ID = 'jshute-mtb-jumps-legend';
  const METRIC_BUTTON_ID = 'jshute-mtb-jumps-metric-btn';
  // Stamped on each jump marker: its 1-based jump number. See
  // MARKER_SELECTOR below for why the markers need it.
  const MARKER_NUMBER_ATTR = 'data-mtb-jump';
  // Set on markers and table rows the slider filters out.
  const FILTERED_ATTR = 'data-mtb-jump-filtered';
  // The learned display unit for distance — see learnDistanceUnit().
  //
  // This is the *page's* localStorage, not GM storage: with `@grant none`
  // the script runs in Garmin's own JS context, so `localStorage` is
  // theirs, keyed to connect.garmin.com. Hence the prefix on the key —
  // we're sharing a namespace with the site.
  //
  // GM_setValue would be script-scoped and is what this repo's
  // add-config-setting skill uses, but that's for user *settings*; this
  // is a derived cache that can be relearned at any time from the table.
  // Granting a GM API also moves the whole script into the userscript
  // manager's sandbox, which is a real risk for a script that walks React
  // fibers and Leaflet internals — not worth it to protect a unit string.
  const DISTANCE_UNIT_STORAGE_KEY = 'jshute-mtb-jumps-distance-unit';
  // Garmin's jump marker icon: a gray disc, a white jump-arc glyph and a
  // near-black ring. We recolor the disc by substituting its fill.
  const ICON_URL = '/images/feature/mtb/jump.svg';
  const ICON_BASE_FILL = '#6C6C6C';
  // Set on <html>, which React never touches, so the hidden state
  // survives the charts re-rendering and SPA navigation.
  const CHARTS_HIDDEN_ATTR = 'data-jshute-charts-hidden';

  // The chart stack between the map and the tabs. `activity-charts` is
  // a plain semantic class, not a CSS module, so it has no build-hash
  // suffix to rot. Its first child is the toolbar row (Customize Charts
  // + Time/Distance); every child after that is one chart.
  const CHARTS_SELECTOR = '.activity-charts';
  const CUSTOMIZE_LABEL = /^customize charts$/i;

  // Garmin Connect is a SPA: it only pushState()s between pages, so we
  // match broadly and gate on the pathname.
  const ACTIVITY_PATH_RE = /^\/app\/activity\//;
  const isActivityPage = () => ACTIVITY_PATH_RE.test(location.pathname);

  // Jump markers on the Leaflet map. Garmin gives them no attributes at
  // all beyond the icon URL and a pixel transform, so the icon URL is
  // the only handle we start with.
  //
  // The `img[data-mtb-jump]` half of the selector matters because
  // coloring a marker (see "Gradient coloring" below) replaces its src
  // with a data: URI, after which the src test stops matching it. We
  // stamp the jump number on before swapping the src, so the marker
  // stays findable. A comma selector still yields document order, which
  // is jump order.
  const MARKER_SELECTOR =
    '.leaflet-marker-pane img[src*="/mtb/jump"], .leaflet-marker-pane img[data-mtb-jump]';
  // The MTB Dynamics jumps table. Class is a CSS module with a rotating
  // build-hash suffix, so match on the semantic prefix.
  const TABLE_SELECTOR = 'table[class*="mtbJumpsTable"]';
  // Cell indices within a jumps-table row: 0 is the trophy icon column.
  const CELL = { number: 1, score: 2, distance: 3, hangTime: 4, speed: 5 };

  // Index of the last jump marker that received a click, in map DOM
  // order. This is our primary jump-number source, because it works
  // even when the MTB Dynamics tab isn't open (the table only exists
  // in the DOM while that tab is selected).
  let lastClickedMarkerIndex = null;
  // The .leaflet-popup-pane we're currently observing. The map can be
  // torn down and rebuilt, so we re-check this and re-attach.
  let observedPopupPane = null;
  let popupObserver = null;
  // The jumps table gets re-rendered on every sort, and only exists
  // while the MTB Dynamics tab is selected, so this gets re-attached too.
  let observedTableBody = null;
  let tableObserver = null;
  // Jump number currently selected, from either side. Held here rather
  // than as DOM state so it survives the table being re-sorted, hidden
  // by a tab switch, or rebuilt.
  let selectedJumpNumber = null;

  console.log(TAG, 'init on', location.pathname);

  // ---------------------------------------------------------------
  // Reading the two sides
  // ---------------------------------------------------------------

  function getMarkers() {
    return [...document.querySelectorAll(MARKER_SELECTOR)];
  }

  // Returns [{ number, score, distance, hangTime, speed, row }], or []
  // if the MTB Dynamics tab isn't currently rendered.
  function getTableJumps() {
    const table = document.querySelector(TABLE_SELECTOR);
    if (!table) return [];
    const jumps = [];
    for (const row of table.querySelectorAll('tbody tr')) {
      const cells = row.cells;
      if (cells.length <= CELL.speed) continue;
      const text = (i) => cells[i].textContent.trim();
      const number = parseInt(text(CELL.number), 10);
      if (!Number.isFinite(number)) continue;
      jumps.push({
        number,
        score: text(CELL.score),
        distance: text(CELL.distance),
        hangTime: text(CELL.hangTime),
        speed: text(CELL.speed),
        row,
      });
    }
    return jumps;
  }

  // The popup body is <b>Jump</b> followed by one <div> per metric:
  // "Distance: 2.49 m" / "Hang time: 0.50 s" / "Speed: 17.8 kph".
  // Garmin renders no jump number and no score there.
  function parsePopup(content) {
    const out = {};
    for (const div of content.querySelectorAll('div')) {
      const m = /^([^:]+):\s*(.+)$/.exec(div.textContent.trim());
      if (!m) continue;
      const key = m[1].trim().toLowerCase();
      if (key === 'distance') out.distance = m[2].trim();
      else if (key === 'hang time') out.hangTime = m[2].trim();
      else if (key === 'speed') out.speed = m[2].trim();
    }
    return out.distance && out.hangTime && out.speed ? out : null;
  }

  // Distance/hang time/speed together are unique across a ride's jumps
  // (verified on a 36-jump activity), so the triple identifies a row.
  // This is what lets us name a popup without trusting marker order.
  function findRowByMetrics(jumps, metrics) {
    const matches = jumps.filter((j) =>
      j.distance === metrics.distance &&
      j.hangTime === metrics.hangTime &&
      j.speed === metrics.speed);
    return matches.length === 1 ? matches[0] : null;
  }

  // ---------------------------------------------------------------
  // Selection highlight on the table row
  // ---------------------------------------------------------------

  // Re-derived from selectedJumpNumber rather than remembered per row,
  // so a re-sort (which reorders rows and rewrites their cells) can't
  // leave the highlight stranded on the wrong jump.
  function applySelection() {
    const table = document.querySelector(TABLE_SELECTOR);
    if (!table) return;
    for (const row of table.querySelectorAll('tbody tr')) {
      const number = row.cells[CELL.number] &&
        parseInt(row.cells[CELL.number].textContent.trim(), 10);
      if (selectedJumpNumber !== null && number === selectedJumpNumber) {
        row.dataset.mtbJumpsSelected = '1';
      } else if (row.dataset.mtbJumpsSelected) {
        delete row.dataset.mtbJumpsSelected;
      }
    }
  }

  function setSelectedJump(number) {
    if (selectedJumpNumber === number) return;
    selectedJumpNumber = number;
    applySelection();
    if (number !== null) console.log(TAG, 'selected jump', number);
  }

  // A sort rewrites every row's cells, and switching away from the MTB
  // Dynamics tab and back rebuilds the table outright, so both the
  // selection highlight and the slider's filtering have to be re-derived
  // from the jump numbers rather than pinned to row elements.
  function onTableChanged() {
    applySelection();
    const jumps = getJumpsDetails();
    if (jumps && jumps.length) applyFilter(jumps);
  }

  // Watches for the re-sort / re-render. We only observe node and text
  // changes, never attributes, so our own dataset and filter writes don't
  // re-enter this.
  function ensureTableObserver() {
    const body = document.querySelector(`${TABLE_SELECTOR} tbody`);
    if (!body || body === observedTableBody) return;
    if (tableObserver) tableObserver.disconnect();
    tableObserver = new MutationObserver(onTableChanged);
    tableObserver.observe(body, { childList: true, subtree: true, characterData: true });
    observedTableBody = body;
    onTableChanged();
  }

  // ---------------------------------------------------------------
  // Popup: add the jump number (and score)
  // ---------------------------------------------------------------

  // The table shows a score per jump but Garmin's popup doesn't; add it
  // above the metrics, in the same order the table uses.
  function addScoreLine(content, title, jump) {
    if (content.querySelector('[data-mtb-jumps-score]')) return;
    const scoreDiv = document.createElement('div');
    scoreDiv.dataset.mtbJumpsScore = '1';
    scoreDiv.textContent = `Score: ${jump.score}`;
    title.insertAdjacentElement('afterend', scoreDiv);
  }

  function decoratePopups() {
    for (const content of document.querySelectorAll('.leaflet-popup-content')) {
      const title = content.querySelector('b');
      // Other map markers (start/end/segments) use the same popup pane;
      // only jump popups have a bare "Jump" title. That also doubles as
      // the "already done" test — once we've labeled it, it reads
      // "Jump 12" and no longer matches.
      //
      // Deliberately *not* a "we already looked at this one" flag on the
      // element: Leaflet creates one popup per marker and reuses that
      // same content node for the life of the page, so a flag set during
      // a moment when we couldn't identify the jump (e.g. the popup was
      // open before the MTB Dynamics tab was, so there was no table to
      // match against) would keep that jump unlabelled forever.
      if (!title) continue;
      const titleText = title.textContent.trim();
      const numbered = /^Jump\s+(\d+)$/.exec(titleText);
      if (!numbered && titleText !== 'Jump') continue;

      if (numbered) {
        // Already named, but it may still be missing its Score line: a
        // popup first opened while the MTB Dynamics tab was closed got
        // its number from marker order, with no table to read a score
        // from. Fill that in now rather than leaving it short forever.
        if (content.querySelector('[data-mtb-jumps-score]')) continue;
        const row = getTableJumps().find((j) => j.number === Number(numbered[1]));
        if (!row) continue;
        addScoreLine(content, title, row);
        console.log(TAG, 'added score to popup for jump', row.number);
        continue;
      }

      const metrics = parsePopup(content);
      if (!metrics) {
        console.log(TAG, 'jump popup with unrecognized body, leaving alone');
        continue;
      }

      const jumps = getTableJumps();
      const byMetrics = jumps.length ? findRowByMetrics(jumps, metrics) : null;
      const byOrder = lastClickedMarkerIndex === null ? null : lastClickedMarkerIndex + 1;

      if (byMetrics && byOrder !== null && byMetrics.number !== byOrder) {
        // The map-marker order and the table no longer agree — the
        // row-click direction below is built on that order, so this is
        // the canary for Garmin having changed how markers are emitted.
        console.warn(TAG, 'marker order disagrees with table: marker index',
          byOrder, 'vs table jump', byMetrics.number);
      }

      const number = byMetrics ? byMetrics.number : byOrder;
      if (number === null) {
        console.log(TAG, 'could not determine jump number for popup');
        continue;
      }

      title.textContent = `Jump ${number}`;
      if (byMetrics) addScoreLine(content, title, byMetrics);
      content.dataset.mtbJumpsNumbered = String(number);
      console.log(TAG, 'labeled popup as jump', number,
        byMetrics ? '(matched table row)' : '(from marker order)');
    }
  }

  // Which jump the open popup is showing, whether we labeled it just
  // now or on some earlier open.
  function openPopupJumpNumber() {
    const content = document.querySelector('.leaflet-popup-content');
    if (!content) return null;
    const flagged = parseInt(content.dataset.mtbJumpsNumbered, 10);
    if (Number.isFinite(flagged)) return flagged;
    const title = content.querySelector('b');
    const match = title && /^Jump\s+(\d+)$/.exec(title.textContent.trim());
    return match ? parseInt(match[1], 10) : null;
  }

  function onPopupsChanged() {
    // Leaflet removes the popup element entirely on close. Closing the
    // popup is the natural "nothing is selected any more" gesture, so
    // the table highlight follows it.
    if (!popupIsOpen()) {
      setSelectedJump(null);
      return;
    }
    decoratePopups();
    // Read the selection back off the popup rather than setting it while
    // labelling. Leaflet reuses each marker's content node for the life
    // of the page, so a popup that was labeled on an earlier open needs
    // no labelling now — and hanging the selection off that branch meant
    // clicking a jump on the map only moved the table highlight the
    // *first* time that jump was opened.
    const number = openPopupJumpNumber();
    // A popup we can't identify leaves the selection alone rather than
    // clearing it: a row click sets the selection before the popup
    // opens, and shouldn't lose it to a transient unlabelled state.
    if (number !== null) setSelectedJump(number);
  }

  // Leaflet builds popup content fresh on each open, so watch the pane
  // rather than any individual popup. Our own edits re-enter this
  // callback; decoratePopups() is idempotent via the dataset flag.
  function ensurePopupObserver() {
    const pane = document.querySelector('.leaflet-popup-pane');
    if (!pane || pane === observedPopupPane) return;
    if (popupObserver) popupObserver.disconnect();
    popupObserver = new MutationObserver(onPopupsChanged);
    popupObserver.observe(pane, { childList: true, subtree: true });
    observedPopupPane = pane;
    console.log(TAG, 'watching map popups');
    onPopupsChanged();
  }

  // ---------------------------------------------------------------
  // Table row → map popup
  // ---------------------------------------------------------------

  const popupIsOpen = () => !!document.querySelector('.leaflet-popup-content');

  // Two boxes, as fractions of the map. A jump inside ACCEPT_BOX is left
  // alone; one outside it is panned just far enough to sit inside the
  // smaller TARGET_BOX.
  //
  // They have to be different boxes. Panning moves the minimum distance,
  // so if the box you test against is also the box you pan into, every
  // jump that needed moving lands exactly *on* the line that defines
  // "badly placed" — hard against the edge, looking unframed. Widening
  // one box just relocates that edge.
  //
  // Both are pushed below center because the popup bubble is drawn
  // upwards from the marker and needs ~155px of clear space above it.
  // ACCEPT_BOX's top bounds the worst case that's allowed to stay put:
  // 0.5 leaves ~45px of bubble above, 0.45 left only ~25px, which still
  // read as jammed against the top.
  const ACCEPT_BOX = { left: 0.25, right: 0.75, top: 0.5, bottom: 0.75 };
  const TARGET_BOX = { left: 0.35, right: 0.65, top: 0.55, bottom: 0.7 };

  let cachedMap = null;

  // The Leaflet Map object isn't exposed anywhere on the DOM, but
  // react-leaflet holds it in the context it renders around the
  // container. Search the fiber chain for an object that quacks like a
  // Map rather than hardcoding the path, so a react-leaflet
  // restructuring doesn't silently break this. Everything that uses it
  // degrades to "no extra panning" if it isn't found.
  function getLeafletMap() {
    const container = document.querySelector('.leaflet-container');
    if (!container) return null;
    if (cachedMap && cachedMap._container === container) return cachedMap;
    cachedMap = null;

    const fiberKey = Object.keys(container).find((k) => k.startsWith('__reactFiber$'));
    if (!fiberKey) return null;
    const isMap = (o) => o && typeof o === 'object' &&
      typeof o.panInside === 'function' && typeof o.containerPointToLatLng === 'function';
    const seen = new Set();
    const search = (obj, depth) => {
      if (!obj || typeof obj !== 'object' || depth > 3 || seen.has(obj)) return null;
      seen.add(obj);
      for (const key of Object.keys(obj)) {
        let value;
        try { value = obj[key]; } catch { continue; }
        if (isMap(value)) return value;
        const hit = search(value, depth + 1);
        if (hit) return hit;
      }
      return null;
    };
    let fiber = container[fiberKey];
    for (let i = 0; i < 30 && fiber; i++, fiber = fiber.return) {
      if (isMap(fiber.stateNode)) { cachedMap = fiber.stateNode; break; }
      const hit = search(fiber.memoizedProps, 0) || search(fiber.memoizedState, 0);
      if (hit) { cachedMap = hit; break; }
    }
    if (cachedMap) console.log(TAG, 'found Leaflet map, will frame jumps on open');
    return cachedMap;
  }

  // Read the marker's true position off the Leaflet layer rather than
  // from the DOM: the icon's on-screen rect is mid-flight during a pan
  // animation, and would convert to the wrong latlng.
  function markerLatLng(map, marker) {
    for (const id of Object.keys(map._layers || {})) {
      const layer = map._layers[id];
      if (layer && layer._icon === marker && typeof layer.getLatLng === 'function') {
        return layer.getLatLng();
      }
    }
    return null;
  }

  // If the jump isn't acceptably placed, pan it just inside TARGET_BOX.
  //
  // The pan is deliberately not animated: it settles before we activate
  // the marker, so Leaflet's own focus-pan and popup autoPan see a view
  // that already suits them and don't fight our position.
  function frameMarker(marker) {
    const map = getLeafletMap();
    if (!map) return;
    const latlng = markerLatLng(map, marker);
    if (!latlng) return;
    const size = map.getSize();
    const point = map.latLngToContainerPoint(latlng);
    if (point.x >= size.x * ACCEPT_BOX.left && point.x <= size.x * ACCEPT_BOX.right &&
        point.y >= size.y * ACCEPT_BOX.top && point.y <= size.y * ACCEPT_BOX.bottom) {
      return;
    }
    // Nearest point inside TARGET_BOX — minimum movement, so as much of
    // the surrounding trail as possible stays where the user left it.
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    const targetX = clamp(point.x, size.x * TARGET_BOX.left, size.x * TARGET_BOX.right);
    const targetY = clamp(point.y, size.y * TARGET_BOX.top, size.y * TARGET_BOX.bottom);
    // panBy moves the view, so the jump moves the opposite way and lands
    // on the target. It takes a plain [x, y], so this needs no reference
    // to the page's Leaflet global.
    map.panBy([point.x - targetX, point.y - targetY], { animate: false });
  }

  // Bumped per row click. Opening is async (activate, then wait for the
  // popup), so two quick clicks overlap; the older one must not act on
  // what it finds once a newer one has taken over.
  let openRequestId = 0;

  // Waits for the popup of *this* jump specifically. Waiting for "any
  // popup" would let one request see another's popup and call it a
  // success — and then skip, or misreport, its own outcome.
  function waitForJumpPopup(number, timeoutMs, requestId) {
    return new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs;
      const poll = () => {
        if (requestId !== openRequestId) return resolve(false);
        if (openPopupJumpNumber() === number) return resolve(true);
        if (Date.now() > deadline) return resolve(false);
        setTimeout(poll, 50);
      };
      poll();
    });
  }

  // Keyboard activation rather than marker.click(). Leaflet silently
  // drops a synthetic click on a marker in some map states — reliably
  // after the user has zoomed and then panned the map — and stays that
  // way until they click a marker for real, which is exactly the "map
  // highlight is stuck" symptom. The markers are `tabindex="0"
  // role="button"`, and Leaflet's keyboard path opens the popup in
  // every state we could reproduce, including the broken one.
  // Focusing also makes Leaflet pan the marker into view, which is what
  // we want for a jump that's currently off the edge of the map.
  function activateMarker(marker) {
    marker.focus({ preventScroll: true });
    for (const type of ['keydown', 'keypress', 'keyup']) {
      marker.dispatchEvent(new KeyboardEvent(type, {
        bubbles: true, cancelable: true,
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
      }));
    }
  }

  async function openJumpOnMap(jump, markers) {
    const requestId = ++openRequestId;
    const marker = markers[jump.number - 1];
    if (!marker) {
      console.log(TAG, 'no map marker for jump', jump.number,
        `(${markers.length} markers on map)`);
      return;
    }
    // Framing positions the jump within the *map*, which doesn't help if
    // the map itself is half scrolled off the browser window — the
    // bubble is then inside the map but above the top of the window.
    // The map is short (400px) next to any window, so bring all of it
    // into view, not just some of it.
    const container = marker.closest('.leaflet-container');
    if (container) {
      const box = container.getBoundingClientRect();
      if (box.top < 0 || box.bottom > window.innerHeight) {
        container.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
    // Then frame within the map, before activating: by the time
    // Leaflet's focus-pan and popup autoPan run, the jump is already
    // well placed, so they have nothing left to do.
    frameMarker(marker);

    // Leaflet binds marker activation to *toggle*, so re-activating a
    // marker whose popup is already showing would close it. Row clicks
    // should only ever open, so skip when this jump is already up.
    if (openPopupJumpNumber() === jump.number) {
      console.log(TAG, 'map popup for jump', jump.number, 'already open');
      return;
    }

    // Normally set by our click listener; keyboard activation doesn't
    // produce a DOM click, so record it here.
    lastClickedMarkerIndex = jump.number - 1;
    activateMarker(marker);
    let openedVia = 'keyboard';
    let opened = await waitForJumpPopup(jump.number, 600, requestId);

    // Belt and braces: if a future Leaflet stops honouring the keyboard
    // path, fall back to the click that used to work. Only when nothing
    // is showing — clicking a marker whose popup is up would toggle it
    // shut, and an open-but-unidentified popup may well be this jump's.
    if (!opened && requestId === openRequestId && !popupIsOpen()) {
      marker.click();
      opened = await waitForJumpPopup(jump.number, 600, requestId);
      openedVia = 'click fallback';
    }

    // A newer row click owns the map now; say nothing and change nothing.
    if (requestId !== openRequestId) return;
    if (!opened) {
      console.log(TAG, 'could not confirm map popup for jump', jump.number);
      return;
    }
    console.log(TAG, 'opened map popup for jump', jump.number, `(${openedVia})`);
  }

  // Delegated so it survives the table re-rendering (which it does on
  // every column sort) and tab switches.
  function onDocumentClick(event) {
    const target = event.target;
    if (!(target instanceof Element)) return;

    // Cheap tests first: this runs for every click anywhere on the page,
    // so don't go looking up all the markers unless one was hit.
    if (target.matches(MARKER_SELECTOR)) {
      lastClickedMarkerIndex = getMarkers().indexOf(target);
      ensurePopupObserver();
      return;
    }

    const row = target.closest(`${TABLE_SELECTOR} tbody tr`);
    if (!row) return;
    const jump = getTableJumps().find((j) => j.row === row);
    if (!jump) return;
    ensurePopupObserver();
    ensureTableObserver();
    // Set the highlight here rather than waiting for the popup, so a row
    // click still selects when the map's jump markers are switched off.
    setSelectedJump(jump.number);
    openJumpOnMap(jump, getMarkers());
  }

  // ---------------------------------------------------------------
  // Hide/show the charts between the map and the jumps table
  // ---------------------------------------------------------------

  const chartsHidden = () => document.documentElement.hasAttribute(CHARTS_HIDDEN_ATTR);

  function findCustomizeChartsButton() {
    const charts = document.querySelector(CHARTS_SELECTOR);
    if (!charts) return null;
    // Match the button by its label rather than by position in the
    // toolbar. Taking "the first button in the first cell" looks
    // equivalent but isn't: the toolbar's cells render at slightly
    // different times, and if we run in the window where only the
    // Time/Distance cell exists, we'd anchor onto the "Time" button and
    // adopt its segmented-control styling.
    return [...charts.querySelectorAll('button')]
      .find((b) => CUSTOMIZE_LABEL.test(b.textContent.trim())) || null;
  }

  function updateHideChartsLabel(button) {
    button.textContent = chartsHidden() ? 'Show Charts' : 'Hide Charts';
  }

  function toggleCharts(button) {
    if (chartsHidden()) document.documentElement.removeAttribute(CHARTS_HIDDEN_ATTR);
    else document.documentElement.setAttribute(CHARTS_HIDDEN_ATTR, '');
    updateHideChartsLabel(button);
    console.log(TAG, chartsHidden() ? 'charts hidden' : 'charts shown');
  }

  function insertHideChartsButton() {
    const customize = findCustomizeChartsButton();
    if (!customize) return;

    const existing = document.getElementById(HIDE_CHARTS_BUTTON_ID);
    if (existing && existing.isConnected) {
      updateHideChartsLabel(existing);
      // Self-heal if we ever landed somewhere else — see the comment in
      // findCustomizeChartsButton().
      if (customize.nextElementSibling !== existing) {
        customize.insertAdjacentElement('afterend', existing);
        existing.className = customize.className;
        console.log(TAG, 'moved Hide Charts button next to Customize Charts');
      }
      return;
    }

    const button = document.createElement('button');
    button.id = HIDE_CHARTS_BUTTON_ID;
    button.type = 'button';
    // Class names here are CSS modules with rotating build-hash
    // suffixes, so copy them off Customize Charts rather than
    // hardcoding — that keeps the two looking identical across
    // Garmin restyles.
    button.className = customize.className;
    updateHideChartsLabel(button);
    button.addEventListener('click', () => toggleCharts(button));
    customize.insertAdjacentElement('afterend', button);
    console.log(TAG, 'added Hide Charts button');
  }

  // ---------------------------------------------------------------
  // Gradient coloring and the min-value filter
  // ---------------------------------------------------------------

  // Garmin holds the ride's jumps in React state and puts none of it in
  // the DOM, so read the array off the fiber chain. Values are SI:
  // distance in meters, hangTime in seconds, speed in m/s. Array order
  // is jump order, matching both the table's numbering and marker DOM
  // order. Non-MTB rides have no array (or an empty one), which is how
  // we know to leave the page alone.
  function getJumpsDetails() {
    const anchor = document.querySelector('.leaflet-container') ||
      document.querySelector(CHARTS_SELECTOR);
    if (!anchor) return null;
    const fiberKey = Object.keys(anchor).find((k) => k.startsWith('__reactFiber$'));
    if (!fiberKey) return null;
    let fiber = anchor[fiberKey];
    for (let i = 0; i < 40 && fiber; i++, fiber = fiber.return) {
      for (const bag of [fiber.memoizedProps, fiber.memoizedState]) {
        if (!bag || typeof bag !== 'object') continue;
        if (Array.isArray(bag.jumpsDetails)) return bag.jumpsDetails;
        // On the activity page's own props it sits one level down.
        const page = bag.pageProps;
        if (page && typeof page === 'object' && Array.isArray(page.jumpsDetails)) {
          return page.jumpsDetails;
        }
      }
    }
    return null;
  }

  // Green → yellow → orange → red, in Garmin's own colors: these are
  // four of the five stops sampled off their speed legend canvas (the
  // Slower→Faster bar under the map), so ours reads as a sibling of
  // theirs.
  //
  // Their two blues are deliberately dropped. The full ramp runs
  // blue → green → orange → red, which isn't monotonic in anything the
  // eye tracks — blue and green read as unrelated categories rather than
  // as "less" and "more", so a marker's color doesn't say where on the
  // scale it sits without consulting the legend. Warm-only reads as one
  // axis of intensity, and luma falls steadily across it (160 → 82).
  //
  // The yellow is load-bearing, not decoration: interpolating green
  // straight to orange passes through #999D3A, a dull olive. That's
  // invisible on the 150px legend bar but very visible on the map, where
  // most jumps are short and would land in exactly that band — olive
  // discs on a pale green basemap. Yellow removes it without adding a
  // hue that reads as a separate category.
  //
  // Garmin draws a plateau around each stop; we interpolate smoothly
  // between them instead.
  const GRADIENT_STOPS = [
    [64, 195, 93],
    [231, 201, 74],
    [242, 119, 22],
    [224, 44, 44],
  ];

  const rgb = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

  function colorAt(fraction) {
    const t = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
    const scaled = t * (GRADIENT_STOPS.length - 1);
    const i = Math.min(GRADIENT_STOPS.length - 2, Math.floor(scaled));
    const f = scaled - i;
    return rgb(GRADIENT_STOPS[i].map((v, k) =>
      Math.round(v + (GRADIENT_STOPS[i + 1][k] - v) * f)));
  }

  const CSS_GRADIENT = `linear-gradient(to right, ${GRADIENT_STOPS
    .map((c, i) => `${rgb(c)} ${Math.round((i / (GRADIENT_STOPS.length - 1)) * 100)}%`)
    .join(', ')})`;

  // Distance is the one metric whose display unit varies by account, and
  // nothing reachable on the page exposes the preference (userProps
  // .userPreferences comes through empty), so learn it by dividing a
  // rendered table cell by its raw value and snapping the ratio to the
  // nearest unit we know. Cached in localStorage so later page loads get
  // the right label before the MTB Dynamics tab has ever been opened.
  const DISTANCE_UNITS = [
    { unit: 'm', factor: 1 },
    { unit: 'ft', factor: 3.280839895 },
    { unit: 'yd', factor: 1.093613298 },
  ];

  function readStoredDistanceUnit() {
    try {
      const raw = localStorage.getItem(DISTANCE_UNIT_STORAGE_KEY);
      const parsed = raw && JSON.parse(raw);
      if (parsed && parsed.unit && Number.isFinite(parsed.factor)) return parsed;
    } catch { /* corrupt or unavailable; learn it again */ }
    return null;
  }

  let distanceUnit = readStoredDistanceUnit();

  // Splits a rendered distance cell into number, decimal places and unit.
  //
  // Both decimal conventions have to work, and telling them apart matters
  // more than it looks: a jump distance is a single digit, so a comma in
  // one is far more likely a decimal separator ("1,94 m" in a European
  // locale) than a thousands separator. Stripping commas outright — the
  // first version of this — turned "1,94" into 194 and produced a ratio
  // of 100, i.e. a legend labeled a hundred times too large.
  //
  // So: the last separator is the decimal point when 1–2 digits follow
  // it; any other separator is a group separator and gets dropped.
  function parseShownDistance(text) {
    const match = /^([\d.,]+)\s*(\S+)$/.exec(String(text).trim());
    if (!match) return null;
    const digits = match[1];
    const lastSep = Math.max(digits.lastIndexOf('.'), digits.lastIndexOf(','));
    const trailing = lastSep < 0 ? -1 : digits.length - lastSep - 1;
    let normalized;
    let decimals;
    if (trailing >= 1 && trailing <= 2) {
      decimals = trailing;
      normalized = `${digits.slice(0, lastSep).replace(/[.,]/g, '')}.${digits.slice(lastSep + 1)}`;
    } else {
      decimals = 0;
      normalized = digits.replace(/[.,]/g, '');
    }
    const value = parseFloat(normalized);
    return Number.isFinite(value) ? { value, decimals, unit: match[2] } : null;
  }

  let warnedDistanceUnit = false;

  function learnDistanceUnit(jumps) {
    if (distanceUnit) return;
    // Prefer the largest jump: the rendered value is rounded, so the
    // biggest one gives the most accurate ratio.
    let best = null;
    for (const row of getTableJumps()) {
      const raw = jumps[row.number - 1];
      if (!raw || !(raw.distance > 0)) continue;
      const shown = parseShownDistance(row.distance);
      if (!shown || !(shown.value > 0)) continue;
      if (!best || raw.distance > best.raw) {
        best = {
          raw: raw.distance,
          text: row.distance,
          ratio: shown.value / raw.distance,
          unit: shown.unit,
          decimals: shown.decimals,
        };
      }
    }
    if (!best) return;

    // Garmin renders these in meters or feet, so the ratio has to land on
    // a conversion we recognize. If it doesn't, we've misread the cell —
    // keep showing raw meters rather than labeling the scale from a bad
    // parse. (Previously an unmatched ratio was used as-is, which turned
    // a misread into confidently wrong numbers.)
    const known = DISTANCE_UNITS.find((u) => Math.abs(best.ratio / u.factor - 1) < 0.02);
    if (!known) {
      if (!warnedDistanceUnit) {
        warnedDistanceUnit = true;
        console.log(TAG, `could not read a distance unit from "${best.text}"` +
          ` (ratio ${best.ratio.toFixed(3)}); labeling the scale in meters`);
      }
      return;
    }

    // The exact conversion, not the measured ratio: the rendered value is
    // rounded, so the ratio is only approximate and would show up as a
    // slightly wrong maximum on the legend.
    distanceUnit = { unit: best.unit, factor: known.factor, decimals: best.decimals };
    try {
      localStorage.setItem(DISTANCE_UNIT_STORAGE_KEY, JSON.stringify(distanceUnit));
    } catch { /* private mode; we'll just relearn next time */ }
    console.log(TAG, 'learned distance unit:', distanceUnit.unit);
  }

  function formatDistance(meters) {
    const u = distanceUnit || { unit: 'm', factor: 1, decimals: 2 };
    return `${(meters * u.factor).toFixed(u.decimals)} ${u.unit}`;
  }

  // The three dimensions the legend rotates between. Speed is
  // deliberately left out: the map already carries Garmin's own
  // Slower→Faster gradient for it.
  const METRICS = [
    { key: 'score', label: 'Score', format: (v) => String(Math.round(v)) },
    { key: 'distance', label: 'Distance', format: formatDistance },
    { key: 'hangTime', label: 'Hang time', format: (v) => `${v.toFixed(2)} s` },
  ];

  // Distance is the most directly meaningful of the three — score is
  // Garmin's own composite, and hang time is largely implied by
  // distance. (This used to also be about gradient coverage, back when
  // the scale was anchored at 0; now that it spans the ride's range,
  // every dimension uses the full ramp — see metricRange().)
  //
  // The choice is deliberately *not* persisted. It was, briefly, and the
  // failure mode is bad out of proportion to the convenience: one stray
  // click silently changes what every ride opens on from then on, with
  // nothing on screen explaining why, and the fix is buried in
  // localStorage. Rotating is cheap; always starting from the same place
  // is worth more.
  const DEFAULT_METRIC_KEY = 'distance';

  let metricIndex = METRICS.findIndex((m) => m.key === DEFAULT_METRIC_KEY);
  // Slider position as a 0–1 fraction along the current metric's range
  // rather than an absolute value, which is what lets switching metric
  // keep the thumb where it is and simply re-derive the threshold. Reset
  // per activity, so opening a new ride always shows all of its jumps.
  let filterFraction = 0;
  // Number of slider steps. Fine enough that dragging feels continuous,
  // coarse enough that the thumb lands on reproducible positions.
  const SLIDER_STEPS = 500;

  // Legend bar geometry. The thumb is deliberately taller than the
  // gradient track it rides on, so it overhangs both edges by
  // THUMB_OVERHANG; the end labels underneath have to clear that or the
  // thumb runs over them at the ends of its travel. Kept as constants
  // rather than literals in the CSS so the clearance can't drift out of
  // step with the two heights it depends on.
  const TRACK_HEIGHT = 9;
  const THUMB_HEIGHT = 17;
  const THUMB_WIDTH = 9;
  const THUMB_OVERHANG = (THUMB_HEIGHT - TRACK_HEIGHT) / 2;
  const ENDS_GAP = THUMB_OVERHANG + 4;

  const metricValue = (jump) => jump[METRICS[metricIndex].key];

  // The scale runs across the ride's own range, min → max, so both ends
  // are measured off the ride.
  //
  // Anchoring the low end at 0 was tried first and gives up too much
  // contrast: a metric only uses the part of the gradient its values
  // actually reach, and none of these reach down to zero — scores on the
  // reference ride run 41–126, so a third of the ramp went unused and
  // most markers came out within a shade of each other. Spanning the
  // ride's range costs absolute cross-ride comparability (the smallest
  // jump of any ride is green, the largest red) and buys the ability to
  // tell this ride's jumps apart, which is the point of coloring them.
  //
  // `span` is 0 when every jump has the same value; callers treat that
  // as "no range to spread across" rather than dividing by it.
  function metricRange(jumps) {
    let min = Infinity;
    let max = -Infinity;
    for (const jump of jumps) {
      const v = metricValue(jump);
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min > max) return { min: 0, max: 0, span: 0 };
    return { min, max, span: max - min };
  }

  // A verbatim copy of Garmin's jump.svg, used when the live one can't be
  // had — the fetch fails (CSP, offline, a renamed asset), or the file no
  // longer contains a disc fill we can substitute. Without it, either of
  // those silently costs the coloring, the legend and the filter their
  // whole point; with it they degrade to "the icon might be a version
  // behind", which nobody will notice.
  //
  // It is only ever the fallback. Garmin's live file stays the preferred
  // source so a restyle on their side carries into our colored copies
  // rather than leaving us drawing a stale icon.
  const FALLBACK_ICON = `
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="13" cy="13" r="13" fill="#6C6C6C"/>
    <path fill-rule="evenodd" clip-rule="evenodd" d="M17.793 12.0956C16.3862 12.2085 15.2526 13.2948 15.08 14.6956C14.8087 11.3948 12.5591 8.81736 9.81218 8.81736C6.88435 8.76084 4.52174 11.6774 4.52174 15.2834C4.52425 15.6615 4.55068 16.0391 4.60087 16.4139C5.03044 13.3391 7.18957 10.9991 9.81218 10.9991C12.4348 10.9991 14.5939 13.3391 15.0235 16.4139C15.0235 16.2217 15.0235 16.0295 15.08 15.8261C15.2906 14.4584 16.4136 13.4149 17.793 13.3052C19.313 13.4432 20.5017 14.6752 20.5852 16.1991C20.5969 16.0033 20.5969 15.807 20.5852 15.6113C20.7441 13.8698 19.4849 12.3196 17.7478 12.1182" fill="white"/>
    <path fill-rule="evenodd" clip-rule="evenodd" d="M26 13C26 5.8203 20.1797 0 13 0C5.8203 0 0 5.8203 0 13C0 20.1797 5.8203 26 13 26C20.1797 26 26 20.1797 26 13ZM1.13043 13C1.13043 6.44462 6.44462 1.13043 13 1.13043C19.5554 1.13043 24.8696 6.44462 24.8696 13C24.8696 19.5554 19.5554 24.8696 13 24.8696C6.44462 24.8696 1.13043 19.5554 1.13043 13Z" fill="#101010"/>
    </svg>
  `.trim();

  // `null` while the fetch is in flight; from then on always a usable
  // template, so there is no "coloring is off" state to handle.
  let iconTemplate = null;
  const iconUrlCache = new Map();

  fetch(ICON_URL)
    .then((response) => response.text())
    .then((text) => {
      if (text.includes(ICON_BASE_FILL)) {
        iconTemplate = text;
        return;
      }
      iconTemplate = FALLBACK_ICON;
      console.log(TAG, `live jump icon has no ${ICON_BASE_FILL} to recolor; using the bundled copy`);
    })
    .catch((error) => {
      iconTemplate = FALLBACK_ICON;
      console.log(TAG, 'could not fetch the jump icon; using the bundled copy:', error.message);
    });

  function coloredIconUrl(color) {
    let url = iconUrlCache.get(color);
    if (!url) {
      url = 'data:image/svg+xml;charset=utf-8,' +
        encodeURIComponent(iconTemplate.replace(ICON_BASE_FILL, color));
      iconUrlCache.set(color, url);
    }
    return url;
  }

  // Marker n in DOM order is jump n+1 — the same positional identity the
  // rest of this script relies on (see the doc for how that was
  // verified). Stamp the number on first, so the marker is still
  // findable once its src is a data: URI.
  let warnedMarkerCount = false;

  function applyMarkerColors(jumps) {
    if (!iconTemplate) return;
    const markers = getMarkers();
    if (!markers.length) return;
    if (markers.length !== jumps.length && !warnedMarkerCount) {
      warnedMarkerCount = true;
      console.log(TAG, `marker count ${markers.length} != jump count ${jumps.length};` +
        ' coloring the ones we can pair up');
    }
    const { min, span } = metricRange(jumps);
    markers.forEach((marker, i) => {
      const jump = jumps[i];
      if (!jump) return;
      marker.setAttribute(MARKER_NUMBER_ATTR, String(i + 1));
      const color = span > 0 ? colorAt((metricValue(jump) - min) / span) : colorAt(0);
      const url = coloredIconUrl(color);
      // Idempotent, so the 1s tick doesn't reassign src (and make Leaflet
      // reload the image) every second — but keyed on the src actually in
      // place, not on what we last wrote. Leaflet reuses the same <img>
      // and reassigns its src when it rebuilds a marker, which leaves our
      // bookkeeping attribute behind; keying off that attribute alone
      // would short-circuit forever and strand the marker on Garmin's
      // gray icon while the legend still advertises a color scale.
      if (marker.getAttribute('src') === url) return;
      marker.dataset.mtbJumpColor = color;
      marker.src = url;
    });
  }

  // Stacking: make the biggest jump the one you can see and click.
  //
  // **Garmin's own CSS decides marker stacking, and it flattens it.**
  // `global.css` (inline block) contains:
  //
  //     .leaflet-zoom-animated { z-index: 9999 !important; }
  //
  // and every Leaflet marker icon carries that class. So every marker
  // computes to z-index 9999 — Leaflet's own latitude-derived value is
  // overridden too — and once every z-index ties, paint order falls back
  // to DOM order, which is jump order. That's why a big jump ends up
  // buried under whatever jump came later in the ride.
  //
  // It also means writing `style.zIndex`, or going through Leaflet's
  // `setZIndexOffset`, has no visible effect whatsoever: the values are
  // correct and inert. Both were tried, and both measured as "working"
  // while the map plainly disagreed.
  //
  // So we beat that rule with our own `!important` at higher specificity
  // (`.leaflet-marker-pane img[data-mtb-jump]` is (0,2,1) against its
  // (0,1,0)), reading the depth from a per-marker custom property. Leaflet
  // rewrites `style.zIndex` on every reposition but never touches custom
  // properties, so this survives pans and zooms with nothing to re-apply.
  //
  // Reordering the DOM would also work, and was tried — but marker DOM
  // order *is* the jump numbering that colors, filtering, popup labels and
  // row clicks all key off, so shuffling it mislabeled 63 of 65 markers.
  // Leave the DOM alone.
  //
  // Above 9999 so the jump markers keep sitting over the start/finish and
  // player markers, which keep Garmin's flat 9999 — that is where they sit
  // today, and this change is about ordering jumps among themselves.
  const MARKER_Z_BASE = 10000;
  const MARKER_Z_VAR = '--mtb-jump-z';

  function applyMarkerStacking(jumps) {
    const markers = getMarkers();
    if (!markers.length) return;

    // Ascending, so the largest value ends up highest. Re-derived from the
    // selected metric every time, so switching dimension restacks.
    const ranked = markers
      .map((marker, i) => ({ marker, jump: jumps[i] }))
      // Non-finite values are dropped rather than sorted: they'd make the
      // comparator return NaN, and an inconsistent comparator doesn't
      // just misplace the bad entry — it lets the sort emit an arbitrary
      // permutation of all 65, each with an individually plausible depth.
      .filter((entry) => entry.jump && Number.isFinite(metricValue(entry.jump)))
      .sort((a, b) => metricValue(a.jump) - metricValue(b.jump));

    ranked.forEach((entry, rank) => {
      const z = String(MARKER_Z_BASE + rank);
      if (entry.marker.style.getPropertyValue(MARKER_Z_VAR) !== z) {
        entry.marker.style.setProperty(MARKER_Z_VAR, z);
      }
    });
  }

  function toggleAttr(element, name, on) {
    if (on === element.hasAttribute(name)) return;
    if (on) element.setAttribute(name, '');
    else element.removeAttribute(name);
  }

  // Drops every filter mark, on both sides. Used when the UI that could
  // undo them is going away.
  function clearFilter() {
    for (const marker of getMarkers()) marker.removeAttribute(FILTERED_ATTR);
    const table = document.querySelector(TABLE_SELECTOR);
    if (!table) return;
    for (const row of table.querySelectorAll('tbody tr')) row.removeAttribute(FILTERED_ATTR);
  }

  // Where the slider currently sits, in the metric's own units. The
  // threshold walks the ride's range, so at rest it sits on the smallest
  // jump (hiding nothing) and fully right on the largest (leaving just
  // it).
  //
  // The clamp is not cosmetic. `min + 1 * (max - min)` can land a hair
  // *above* max in floating point — about 1% of real min/max pairs — and
  // then the largest jump fails `value >= threshold` too, so dragging the
  // slider fully right empties the map and the table instead of leaving
  // the biggest jump. Both callers go through here so they can't drift.
  function filterState(jumps) {
    const { min, max, span } = metricRange(jumps);
    return { min, max, span, threshold: Math.min(min + filterFraction * span, max) };
  }

  // Hides every jump below the slider's threshold, on the map and in the
  // table together. Hiding is an attribute plus a CSS rule rather than an
  // inline style: React rebuilds the table on every sort and Leaflet
  // rewrites marker transforms constantly, and neither touches our
  // attributes.
  function applyFilter(jumps) {
    const { threshold } = filterState(jumps);
    const hidden = new Set();
    jumps.forEach((jump, i) => {
      if (metricValue(jump) < threshold) hidden.add(i + 1);
    });

    getMarkers().forEach((marker, i) => {
      toggleAttr(marker, FILTERED_ATTR, hidden.has(i + 1));
    });

    const table = document.querySelector(TABLE_SELECTOR);
    if (table) {
      for (const row of table.querySelectorAll('tbody tr')) {
        const cell = row.cells[CELL.number];
        const number = cell && parseInt(cell.textContent.trim(), 10);
        // Keyed off the jump number in cell 1, never the row's position:
        // the table is sortable, so row order is not jump order.
        toggleAttr(row, FILTERED_ATTR, Number.isFinite(number) && hidden.has(number));
      }
    }

    // A popup left open over a jump we just hid would float on the map
    // with nothing under it.
    const open = openPopupJumpNumber();
    if (open !== null && hidden.has(open)) {
      const map = getLeafletMap();
      if (map && typeof map.closePopup === 'function') map.closePopup();
    }
  }

  // ---------------------------------------------------------------
  // The legend, which is also the filter slider
  // ---------------------------------------------------------------

  function buildLegend() {
    const wrapper = document.createElement('div');
    wrapper.id = LEGEND_ID;
    // Same spacing class the toolbar's own two cells use.
    wrapper.className = 'marBottomSM';
    // The group is positioned inside the cell by a measured margin — see
    // alignGroup(). The cell itself just claims the space between the
    // toolbar's two existing cells.
    wrapper.innerHTML = `
      <span data-part="group">
        <span data-part="label">Jump <button type="button" id="${METRIC_BUTTON_ID}"
          title="Show a different jump dimension"></button></span>
        <span data-part="scale">
          <span data-part="track">
            <span data-part="dim"></span>
            <input type="range" min="0" max="${SLIDER_STEPS}" step="1" value="0"
              aria-label="Hide jumps below this value">
          </span>
          <span data-part="ends"><span data-part="min"></span><span data-part="max"></span></span>
        </span>
        <span data-part="readout"></span>
      </span>
    `;

    wrapper.querySelector(`#${METRIC_BUTTON_ID}`).addEventListener('click', () => {
      metricIndex = (metricIndex + 1) % METRICS.length;
      console.log(TAG, 'showing jump', METRICS[metricIndex].label.toLowerCase());
      // filterFraction is untouched, so the thumb stays put and the
      // threshold re-derives against the new metric's range.
      refreshJumpVisuals();
    });

    wrapper.querySelector('input[type="range"]').addEventListener('input', (event) => {
      filterFraction = Number(event.target.value) / SLIDER_STEPS;
      refreshJumpVisuals();
    });

    return wrapper;
  }

  // Inserted between the toolbar's two existing cells. The row is a
  // space-between flexbox, so a third child lands in the middle, between
  // the Customize/Hide Charts buttons and the Time/Distance toggle.
  function ensureLegend(jumps) {
    const charts = document.querySelector(CHARTS_SELECTOR);
    const toolbar = charts && charts.firstElementChild;
    const customize = findCustomizeChartsButton();
    // Anchor on Customize Charts for the same reason insertHideChartsButton
    // does: the toolbar's cells render at slightly different times, and
    // its first cell isn't reliably the buttons cell.
    const buttonsCell = customize && customize.parentElement;
    if (!toolbar || !buttonsCell || buttonsCell.parentElement !== toolbar) return;

    let legend = document.getElementById(LEGEND_ID);
    if (!legend || !legend.isConnected) {
      legend = buildLegend();
      buttonsCell.insertAdjacentElement('afterend', legend);
      console.log(TAG, 'added the jump gradient legend');
    } else if (legend.previousElementSibling !== buttonsCell) {
      // Self-heal if the toolbar was rebuilt around us.
      buttonsCell.insertAdjacentElement('afterend', legend);
    }
    updateLegend(legend, jumps);
  }

  function removeLegend() {
    const legend = document.getElementById(LEGEND_ID);
    if (legend) legend.remove();
  }

  // Called from the 1s tick as well as from the controls, so every write
  // is guarded: rewriting identical text each second would churn the DOM
  // for nothing.
  function setText(element, text) {
    if (element.textContent !== text) element.textContent = text;
  }

  // Lines our gradient bar's left edge up with the left edge of Garmin's
  // speed gradient directly above it.
  //
  // This has to be measured, and it's the reason the widget isn't simply
  // centered. Garmin's legend is centered within the page content width;
  // ours is a flex child sitting between the Customize/Hide Charts cell
  // and the Time/Distance cell, so it would center between *those*, which
  // is different math and lands somewhere else at most window widths.
  // (At exactly 854px of content the two coincide, which is misleading.)
  //
  // Centering it also let the widget slide sideways whenever the readout
  // changed width — going from "65 jumps" to "≥ 3.36 m (7 of 65 jumps)"
  // moved the whole control. Anchoring the left edge fixes that too, and
  // is why the label has a fixed width in CSS: the dimension names differ
  // in length, and the bar must not move when they rotate.
  const FALLBACK_INDENT = 60;

  function alignGroup(legend) {
    const group = legend.querySelector('[data-part="group"]');
    const canvas = document.querySelector('[class*="MapLegend_legendContainer"] canvas');
    const track = legend.querySelector('[data-part="track"]');
    let indent = FALLBACK_INDENT;
    if (canvas) {
      // Neither term depends on the margin we're about to set: the cell
      // is a flex child pinned after the buttons, and the track's offset
      // within the group is just the fixed-width label plus the gap.
      const cellLeft = legend.getBoundingClientRect().left;
      const trackOffset = track.getBoundingClientRect().left -
        group.getBoundingClientRect().left;
      indent = canvas.getBoundingClientRect().left - cellLeft - trackOffset;
    }
    indent = Math.max(0, Math.round(indent));
    if (legend.dataset.indent === String(indent)) return;
    legend.dataset.indent = String(indent);
    group.style.marginLeft = `${indent}px`;
  }

  function updateLegend(legend, jumps) {
    const metric = METRICS[metricIndex];
    const { min, max, threshold } = filterState(jumps);
    const shown = jumps.filter((jump) => metricValue(jump) >= threshold).length;
    const part = (name) => legend.querySelector(`[data-part="${name}"]`);

    setText(legend.querySelector(`#${METRIC_BUTTON_ID}`), metric.label);
    // Both ends are the ride's own, so both are labeled from it.
    setText(part('min'), metric.format(min));
    setText(part('max'), metric.format(max));
    setText(part('readout'), filterFraction > 0
      ? `≥ ${metric.format(threshold)} (${shown} of ${jumps.length} jumps)`
      : `${jumps.length} jumps`);

    // The dimmed band covers exactly the colors that are filtered out,
    // which is the whole point of the gradient doubling as the track.
    const width = `${filterFraction * 100}%`;
    const dim = part('dim');
    if (dim.style.width !== width) dim.style.width = width;

    const input = legend.querySelector('input[type="range"]');
    const step = String(Math.round(filterFraction * SLIDER_STEPS));
    if (input.value !== step) input.value = step;

    alignGroup(legend);
  }

  // The one entry point: re-derives the legend, the marker colors and the
  // filter from current state. Safe to call as often as we like.
  function refreshJumpVisuals() {
    const jumps = getJumpsDetails();
    // A single jump has nothing to be ranked against or filtered out of,
    // and a one-jump scale would be a bar with the same number at both
    // ends. Leave those rides (and jumpless ones) entirely alone —
    // no legend, no coloring, no stacking.
    if (!jumps || jumps.length <= 1) {
      // Un-hide first: leaving anything filtered here would strand it,
      // since the slider that could bring it back is about to be removed.
      clearFilter();
      removeLegend();
      return;
    }
    learnDistanceUnit(jumps);
    ensureLegend(jumps);
    applyMarkerColors(jumps);
    applyMarkerStacking(jumps);
    applyFilter(jumps);
  }

  // ---------------------------------------------------------------
  // Setup
  // ---------------------------------------------------------------

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    // Garmin already tints the best-jump row rgba(84, 169, 254, 0.2)
    // (blue) via Tabs_active. Our selection is amber so the two read
    // as different things, and is declared last at higher specificity
    // so it wins when they land on the same row.
    style.textContent = `
      ${TABLE_SELECTOR} tbody tr { cursor: pointer; }
      ${TABLE_SELECTOR} tbody tr:hover { background-color: rgba(128, 128, 128, 0.12); }
      ${TABLE_SELECTOR} tbody tr[data-mtb-jumps-selected],
      ${TABLE_SELECTOR} tbody tr[data-mtb-jumps-selected]:hover {
        background-color: rgba(245, 166, 35, 0.32);
      }
      ${TABLE_SELECTOR} tbody tr[data-mtb-jumps-selected] > td:first-child {
        box-shadow: inset 3px 0 0 rgb(214, 132, 0);
      }
      html[${CHARTS_HIDDEN_ATTR}] ${CHARTS_SELECTOR} > *:not(:first-child) { display: none; }
      #${HIDE_CHARTS_BUTTON_ID} { margin-left: 8px; }

      /* Stacking order for the jump markers. This has to be !important
         and more specific than Garmin's own
         '.leaflet-zoom-animated { z-index: 9999 !important; }', which
         otherwise flattens every marker to the same z-index and leaves
         paint order to fall back to DOM order. The value comes from a
         custom property we set per marker, because Leaflet rewrites
         style.zIndex on every reposition but never touches those. */
      .leaflet-marker-pane img[${MARKER_NUMBER_ATTR}] {
        z-index: var(${MARKER_Z_VAR}, ${MARKER_Z_BASE}) !important;
      }

      /* Filtered out by the slider, on both sides at once. */
      .leaflet-marker-pane img[${FILTERED_ATTR}] { display: none; }
      ${TABLE_SELECTOR} tbody tr[${FILTERED_ATTR}] { display: none; }

      /* flex: 1 claims the space between the toolbar's two existing
         cells, giving the group a stable left edge to be placed from.
         The row's own space-between then has no free space left to
         distribute, so the other two cells stay at the extremes. */
      #${LEGEND_ID} {
        flex: 1;
        display: flex;
        font-size: 13px;
        line-height: 1.2;
      }
      #${LEGEND_ID} [data-part="group"] {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      /* Fixed width, right-aligned: the three dimension names differ in
         length, and the gradient bar must not shift when they rotate.
         Sized for the longest, "Jump Hang time". */
      #${LEGEND_ID} [data-part="label"] {
        width: 98px;
        text-align: right;
        white-space: nowrap;
      }
      /* A text-weight control: a full secondary button here would
         out-shout Customize Charts sitting right next to it. */
      #${METRIC_BUTTON_ID} {
        background: none;
        border: 0;
        padding: 0;
        font: inherit;
        color: inherit;
        font-weight: 600;
        cursor: pointer;
        text-decoration: underline dotted;
        text-underline-offset: 2px;
      }
      #${METRIC_BUTTON_ID}:hover { text-decoration: underline solid; }
      #${LEGEND_ID} [data-part="track"] {
        position: relative;
        display: block;
        width: 150px;
        height: ${TRACK_HEIGHT}px;
        border-radius: 2px;
        background-image: ${CSS_GRADIENT};
      }
      /* Veils the filtered-out end of the gradient. pointer-events off so
         it doesn't eat drags aimed at the slider underneath. */
      #${LEGEND_ID} [data-part="dim"] {
        position: absolute;
        top: 0;
        bottom: 0;
        left: 0;
        width: 0;
        border-radius: 2px 0 0 2px;
        background: rgba(255, 255, 255, 0.72);
        pointer-events: none;
      }
      /* The range input is invisible except for its thumb: the gradient
         bar behind it is the track. */
      #${LEGEND_ID} input[type="range"] {
        position: absolute;
        left: 0;
        top: 50%;
        transform: translateY(-50%);
        width: 100%;
        height: ${THUMB_HEIGHT}px;
        margin: 0;
        background: none;
        -webkit-appearance: none;
        appearance: none;
        cursor: pointer;
      }
      #${LEGEND_ID} input[type="range"]::-webkit-slider-runnable-track {
        height: ${THUMB_HEIGHT}px;
        background: none;
      }
      #${LEGEND_ID} input[type="range"]::-moz-range-track {
        height: ${THUMB_HEIGHT}px;
        background: none;
      }
      #${LEGEND_ID} input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: ${THUMB_WIDTH}px;
        height: ${THUMB_HEIGHT}px;
        border-radius: 2px;
        border: 1px solid rgb(16, 16, 16);
        background: #fff;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
      }
      #${LEGEND_ID} input[type="range"]::-moz-range-thumb {
        width: ${THUMB_WIDTH}px;
        height: ${THUMB_HEIGHT}px;
        border-radius: 2px;
        border: 1px solid rgb(16, 16, 16);
        background: #fff;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
      }
      #${LEGEND_ID} [data-part="ends"] {
        display: flex;
        justify-content: space-between;
        /* Clears the thumb's overhang below the track. */
        margin-top: ${ENDS_GAP}px;
        font-size: 11px;
        opacity: 0.7;
      }
      #${LEGEND_ID} [data-part="readout"] {
        white-space: nowrap;
        font-variant-numeric: tabular-nums;
      }
    `;
    document.head.appendChild(style);
  }

  // Everything below re-runs freely; each piece checks whether its work
  // is already done.
  function sync() {
    if (!isActivityPage()) return;
    injectStyle();
    ensurePopupObserver();
    ensureTableObserver();
    insertHideChartsButton();
    // Re-applies the marker colors too: Leaflet can rebuild the markers
    // underneath us, which resets their src back to Garmin's gray icon.
    refreshJumpVisuals();
    // Retry labelling: a popup can be open at a moment when we can't
    // identify the jump (no table yet), and opening the MTB Dynamics tab
    // afterwards mutates nothing inside the popup pane, so the observer
    // alone would never revisit it.
    if (popupIsOpen()) onPopupsChanged();
  }

  document.addEventListener('click', onDocumentClick, true);

  // The map and the MTB Dynamics tab both appear well after load, and
  // the map can be rebuilt underneath us, so re-check periodically
  // rather than observing the whole (chart-heavy, churning) body.
  setInterval(sync, 1000);
  sync();

  // SPA navigation: pushState/replaceState don't fire popstate.
  const URL_CHANGE_EVENT = 'mtb-jumps:urlchange';
  for (const method of ['pushState', 'replaceState']) {
    const original = history[method];
    history[method] = function (...args) {
      const result = original.apply(this, args);
      window.dispatchEvent(new Event(URL_CHANGE_EVENT));
      return result;
    };
  }
  const onUrlChange = () => {
    observedPopupPane = null;
    observedTableBody = null;
    lastClickedMarkerIndex = null;
    selectedJumpNumber = null;
    // The chosen metric persists, but the filter doesn't: arriving at a
    // new ride with some of its jumps already hidden would be a surprise.
    filterFraction = 0;
    warnedMarkerCount = false;
    // The next ride may have no jumps at all, and the toolbar is reused
    // across SPA navigation, so drop the legend and let sync() re-add it.
    removeLegend();
    sync();
  };
  window.addEventListener('popstate', onUrlChange);
  window.addEventListener(URL_CHANGE_EVENT, onUrlChange);
})();
