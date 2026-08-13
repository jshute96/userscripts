// ==UserScript==
// @name         Garmin Connect: Improve UI in MTB Dynamics jumps view
// @namespace    https://github.com/jshute96/userscripts
// @version      0.1.2
// @description  Improves the UI so jumps in the map link to jumps in the table below. Clicking one in either area highlights that jump in the other view.
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

  // Jump markers on the Leaflet map. They carry no attributes at all
  // beyond the icon URL and a pixel transform, so the icon URL is the
  // only handle we have.
  const MARKER_SELECTOR = '.leaflet-marker-pane img[src*="/mtb/jump"]';
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

  // Watches for the re-sort / re-render, to re-place the highlight.
  // We only observe node and text changes, never attributes, so our own
  // dataset writes don't re-enter this.
  function ensureTableObserver() {
    const body = document.querySelector(`${TABLE_SELECTOR} tbody`);
    if (!body || body === observedTableBody) return;
    if (tableObserver) tableObserver.disconnect();
    tableObserver = new MutationObserver(applySelection);
    tableObserver.observe(body, { childList: true, subtree: true, characterData: true });
    observedTableBody = body;
    applySelection();
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
    sync();
  };
  window.addEventListener('popstate', onUrlChange);
  window.addEventListener(URL_CHANGE_EVENT, onUrlChange);
})();
