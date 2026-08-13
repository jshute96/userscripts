// ==UserScript==
// @name         Strava: Segment search location filter and unpaged view
// @namespace    https://github.com/jshute96/userscripts
// @version      0.2.4
// @description  Adds a Location filter box in segment search, and makes search results unpaged.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://www.strava.com/*
// @grant        none
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[strava-loc]';

  // Our own query param. Strava's server ignores unknown params, so we
  // can round-trip the filter through a normal form submit / page link.
  const PARAM = 'loc';

  const SEARCH_PATH = '/segments/search';
  const FIELD_ID = 'jshute-segment-location-filter';
  const HEADER_FIELD_ID = 'jshute-global-location-filter';
  const STATUS_ID = 'jshute-segment-location-status';
  // Marks rows we pulled in from later result pages (vs. rows the
  // server rendered for the page we're actually on).
  const FETCHED_ATTR = 'data-jshute-from-page';

  const SCAN_BATCH = 10;        // result pages fetched per scan burst
  const FETCH_DELAY_MS = 300;   // politeness gap between page fetches
  const DEBOUNCE_MS = 200;

  console.log(TAG, 'init on', location.pathname);

  // ---------------------------------------------------------------
  // Matching semantics
  //
  // The filter text is split on commas into terms; a row matches when
  // *every* term appears as a substring of its Location cell. Both
  // sides are lowercased, accent-stripped, and whitespace-normalized,
  // so "el corte  de madera , CA" behaves like you'd expect.
  // ---------------------------------------------------------------

  function normalize(s) {
    return (s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')  // strip combining accents
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function parseTerms(query) {
    return (query || '').split(',').map(normalize).filter(Boolean);
  }

  function locationMatches(locationText, terms) {
    const hay = normalize(locationText);
    return terms.every((t) => hay.includes(t));
  }

  // ---------------------------------------------------------------
  // Shared helpers
  // ---------------------------------------------------------------

  function paramFromUrl(url = location.href) {
    return new URL(url, location.origin).searchParams.get(PARAM) || '';
  }

  function debounce(fn, ms) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  }

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  // ===============================================================
  // Part 1 — the /segments/search results page
  // ===============================================================

  const searchPage = (function () {
    let scanning = false;
    let stopRequested = false;
    let scannedThrough = null;    // highest result page we've pulled in
    let exhausted = false;        // a fetched page came back with no rows

    function table() {
      return document.querySelector('table.search-results');
    }

    function filterInput() {
      return document.getElementById(FIELD_ID);
    }

    function filterValue() {
      const el = filterInput();
      return el ? el.value : '';
    }

    // Find the Location column by its header text rather than a fixed
    // index — the Running results table has a different column set.
    function locationColumnIndex(t) {
      const ths = Array.from(t.querySelectorAll('thead th'));
      const i = ths.findIndex((th) => normalize(th.textContent) === 'location');
      return i >= 0 ? i : 3;
    }

    function currentPageNumber() {
      const n = parseInt(new URL(location.href).searchParams.get('page') || '1', 10);
      return Number.isFinite(n) && n > 0 ? n : 1;
    }

    // Highest page number offered by the paginator ("… 334"), so we
    // don't keep fetching past the end of the result set.
    function lastPageNumber() {
      let max = 0;
      for (const a of document.querySelectorAll('nav ul.pagination a[href]')) {
        const p = parseInt(new URL(a.href, location.origin).searchParams.get('page') || '', 10);
        if (Number.isFinite(p)) max = Math.max(max, p);
      }
      return max || null;
    }

    function pageUrl(n) {
      const u = new URL(location.href);
      u.searchParams.set('page', String(n));
      u.searchParams.delete(PARAM);   // our param never goes to the server
      return u.toString();
    }

    // -------------------------------------------------------------
    // Filtering
    // -------------------------------------------------------------

    function applyFilter() {
      const t = table();
      if (!t) return 0;
      const terms = parseTerms(filterValue());
      const col = locationColumnIndex(t);
      const rows = Array.from(t.querySelectorAll('tbody tr'));

      let shown = 0;
      let loaded = 0;
      for (const row of rows) {
        loaded++;
        const cell = row.cells[col];
        // Everything we've loaded stays on screen; the filter, when
        // set, is the only thing that hides rows.
        const show = !terms.length
          || (!!cell && locationMatches(cell.textContent, terms));
        row.style.display = show ? '' : 'none';
        if (show) shown++;
      }

      updateStatus(terms, shown, loaded);
      return shown;
    }

    const applyFilterDebounced = debounce(applyFilter, DEBOUNCE_MS);

    // -------------------------------------------------------------
    // Our control bar, which replaces Strava's paginator
    //
    // Strava's paginator reloads the page a page at a time, which
    // conflicts with the rows we've already pulled in (page 2 would
    // re-show results we're already displaying), so we hide it and
    // drive everything from one growing list instead.
    // -------------------------------------------------------------

    function stravaPager() {
      const list = document.querySelector('nav ul.pagination');
      return list ? list.closest('nav') : null;
    }

    function hideStravaPager() {
      const nav = stravaPager();
      // Kept in the DOM (just hidden) because its links are how we
      // know how many result pages exist.
      if (nav && nav.style.display !== 'none') {
        nav.style.display = 'none';
        console.log(TAG, 'hid Strava paginator in favour of our own controls');
      }
    }

    function ensureStatus() {
      let el = document.getElementById(STATUS_ID);
      if (el) return el;
      const t = table();
      if (!t) return null;
      el = document.createElement('div');
      el.id = STATUS_ID;
      Object.assign(el.style, {
        margin: '16px 0 24px',
        font: '14px/20px inherit',
        color: '#666',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        flexWrap: 'wrap',
      });
      // Below the results, where the paginator used to be.
      const nav = stravaPager();
      if (nav) nav.parentElement.insertBefore(el, nav);
      else t.parentElement.insertBefore(el, t.nextSibling);
      return el;
    }

    function makeLinkButton(text, onClick) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      Object.assign(b.style, {
        background: 'none',
        border: '0',
        padding: '0',
        color: '#fc5200',
        cursor: 'pointer',
        font: 'inherit',
        textDecoration: 'underline',
      });
      b.addEventListener('click', onClick);
      return b;
    }

    function updateStatus(terms, shown, loaded) {
      const el = ensureStatus();
      if (!el) return;
      el.textContent = '';

      const first = currentPageNumber();
      const through = scannedThrough || first;
      const last = lastPageNumber();
      const pagesText = through > first
        ? `pages ${first}–${through}`
        : `page ${first}`;
      const ofText = last ? ` of ${last}` : '';

      const msg = document.createElement('span');
      if (terms.length) {
        msg.textContent = scanning
          ? `Location filter: ${shown} match${shown === 1 ? '' : 'es'} so far — loading ${pagesText}${ofText}…`
          : `Location filter: ${shown} match${shown === 1 ? '' : 'es'} in ${loaded} results (${pagesText}${ofText})`;
      } else {
        msg.textContent = scanning
          ? `Loading ${pagesText}${ofText}…`
          : `${loaded} result${loaded === 1 ? '' : 's'} loaded (${pagesText}${ofText})`;
      }
      el.appendChild(msg);

      if (scanning) {
        el.appendChild(makeLinkButton('Stop', () => {
          stopRequested = true;
          console.log(TAG, 'load stop requested');
        }));
        return;
      }
      if (exhausted || (last && through >= last)) {
        const done = document.createElement('span');
        done.textContent = 'End of results.';
        el.appendChild(done);
        return;
      }
      // With a filter on, one page at a time is a slow way to find
      // matches, so load a batch; unfiltered this is a plain
      // "show me more results" control.
      const batch = terms.length ? SCAN_BATCH : 1;
      const label = terms.length
        ? `Search ${SCAN_BATCH} more pages`
        : 'Load more results';
      el.appendChild(makeLinkButton(label, () => scan(batch)));
    }

    // -------------------------------------------------------------
    // Scanning later result pages
    // -------------------------------------------------------------

    // Returns null if the request itself failed, otherwise
    // { rows, isSearchPage }. Past the last page Strava serves a real
    // search page with no results table, which is how we know we're
    // done; a response *without* the search form is something else
    // entirely (an expired session redirecting to login, an error
    // page), and must not be reported as "end of results".
    async function fetchPageRows(n) {
      const url = pageUrl(n);
      let html;
      try {
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) {
          console.log(TAG, 'fetch failed for page', n, res.status);
          return null;
        }
        html = await res.text();
      } catch (e) {
        console.log(TAG, 'fetch error for page', n, e);
        return null;
      }
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return {
        rows: Array.from(doc.querySelectorAll('table.search-results tbody tr')),
        isSearchPage: !!doc.querySelector('form.search') && !!doc.getElementById('keywords'),
      };
    }

    function appendRows(rows, pageNumber) {
      const tbody = table() && table().querySelector('tbody');
      if (!tbody) return;
      for (const row of rows) {
        const clone = document.importNode(row, true);
        clone.setAttribute(FETCHED_ATTR, String(pageNumber));
        // Stars on imported rows are inert (Strava binds its handlers
        // at page load), so don't pretend they're clickable.
        for (const star of clone.querySelectorAll('.starred-segment')) {
          star.style.cursor = 'default';
          star.title = 'From a later result page — open the segment to star it';
        }
        tbody.appendChild(clone);
      }
    }

    async function scan(pages) {
      if (scanning || exhausted) return;
      if (!table()) {
        console.log(TAG, 'no results table; nothing to load more of');
        return;
      }
      scanning = true;
      stopRequested = false;
      const last = lastPageNumber();
      let next = (scannedThrough || currentPageNumber()) + 1;
      console.log(TAG, `loading up to ${pages} more page(s) starting at ${next}`);
      applyFilter();

      for (let i = 0; i < pages && !stopRequested; i++, next++) {
        if (last && next > last) { exhausted = true; break; }
        const page = await fetchPageRows(next);
        if (page === null) break;               // network/HTTP failure
        if (!page.isSearchPage) {
          // Not a search page at all — most likely the session expired.
          // Stop, but don't claim we've seen every result.
          console.log(TAG, `page ${next} was not a search page; stopping (are you still logged in?)`);
          break;
        }
        if (!page.rows.length) { exhausted = true; break; }
        appendRows(page.rows, next);
        scannedThrough = next;
        applyFilter();
        await delay(FETCH_DELAY_MS);
      }

      scanning = false;
      const shown = applyFilter();
      console.log(TAG, `load done through page ${scannedThrough || currentPageNumber()}, ${shown} rows shown`);
    }

    // -------------------------------------------------------------
    // The Location input, added under Strava's keywords box
    // -------------------------------------------------------------

    function searchForm() {
      return document.querySelector('form.search') ||
        (document.getElementById('keywords') || {}).form || null;
    }

    // A stable serialisation of everything the search form asks the
    // server for: keywords, sport (hidden `filter_type`), climb
    // category (`min-cat`/`max-cat`), running terrain. Our own `loc`
    // and Rails' `utf8` marker aren't part of the search.
    function serializeSearchForm() {
      const form = searchForm();
      if (!form) return null;
      const parts = [];
      for (const [k, v] of new FormData(form)) {
        if (k === PARAM || k === 'utf8') continue;
        parts.push(`${k}=${normalize(v)}`);
      }
      return parts.sort().join('&');
    }

    // Compared against the form as the server rendered it, i.e. the
    // search these results actually answer. Editing the keyword box,
    // flipping Cycling/Running, or dragging the climb-category slider
    // all leave the page in place, so without this check Enter in the
    // Location box would filter rows from the *previous* search.
    let searchAsLoaded = null;

    function searchChanged() {
      if (searchAsLoaded === null) return false;
      const now = serializeSearchForm();
      return now !== null && now !== searchAsLoaded;
    }

    // Submit Strava's own search form, so the server re-runs the
    // search from scratch (page 1). Our Location input is `name="loc"`
    // and lives inside that form, so it rides along in the new URL.
    function submitSearchForm() {
      const form = searchForm();
      if (!form) {
        console.log(TAG, 'search form not found; cannot re-run search');
        return;
      }
      // requestSubmit() runs the form's own submit handling, unlike
      // form.submit(); fall back for older engines.
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.submit();
    }

    function insertField() {
      if (document.getElementById(FIELD_ID)) return true;
      const keywords = document.getElementById('keywords');
      if (!keywords || !keywords.parentElement) return false;

      // Strava's own label reads "Segment Name or Location", which now
      // overlaps with our box — narrow it to what it actually is.
      const ownLabel = keywords.parentElement.querySelector('label');
      if (ownLabel && /or location/i.test(ownLabel.textContent)) {
        ownLabel.textContent = 'Segment Name';
      }

      const label = document.createElement('label');
      label.setAttribute('for', FIELD_ID);
      label.textContent = 'Location';
      label.style.marginTop = '8px';

      const input = document.createElement('input');
      input.id = FIELD_ID;
      input.name = PARAM;
      input.type = 'text';
      input.className = keywords.className;
      input.title = 'Comma-separated terms; a result is shown when its ' +
        'Location contains all of them (case-insensitive substring match).';
      input.value = paramFromUrl();
      input.autocomplete = 'off';

      keywords.parentElement.appendChild(label);
      keywords.parentElement.appendChild(input);

      input.addEventListener('input', applyFilterDebounced);
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        // If any part of the search has been edited since this page
        // loaded, Enter has to mean "run the search again" — the rows
        // we'd otherwise filter answer the old search.
        if (searchChanged()) {
          console.log(TAG, 'search criteria changed; submitting a new search');
          submitSearchForm();
          return;
        }
        applyFilter();
        scan(SCAN_BATCH);
      });
      console.log(TAG, 'location field added to search form');
      return true;
    }

    function init() {
      if (!insertField()) {
        console.log(TAG, 'keywords input not found; location field not added');
        return;
      }
      // Snapshot after inserting our field (which serialisation skips)
      // so this reflects the search the server just answered.
      searchAsLoaded = serializeSearchForm();

      if (!table()) {
        // A search with no hits: keep the Location box (it round-trips
        // into the next search) but there's nothing to filter or load.
        console.log(TAG, 'no results table on this search page');
        return;
      }
      hideStravaPager();
      if (!stravaPager()) {
        // will_paginate omits the paginator entirely for a single page
        // of results, so there is nothing more to load.
        exhausted = true;
        console.log(TAG, 'no paginator; treating this as the only page of results');
      }
      const shown = applyFilter();
      // Arriving with a filter already set (from the header search, a
      // bookmark, or a form submit) means we're looking for matches,
      // so start pulling in following pages straight away.
      if (paramFromUrl()) {
        console.log(TAG, `filter "${paramFromUrl()}" applied, ${shown} matches on this page`);
        scan(SCAN_BATCH);
      }
    }

    return { init };
  })();

  // ===============================================================
  // Part 2 — the global header search widget (all pages)
  // ===============================================================

  const headerWidget = (function () {
    function modeButton() {
      return document.querySelector('#global-search-filter button[data-value]');
    }

    // Strava marks the current mode in two places — the dropdown
    // button's data-value and the keyword field's data-search-filter.
    // Either saying "segments" is enough; requiring the button alone
    // would hide our box if that one ever lags behind.
    function segmentsMode() {
      const btn = modeButton();
      const field = document.getElementById('global-search-field');
      return (!!btn && btn.getAttribute('data-value') === 'segments') ||
        (!!field && field.getAttribute('data-search-filter') === 'segments');
    }

    function locField() {
      return document.getElementById(HEADER_FIELD_ID);
    }

    function locValue() {
      const el = locField();
      return el && !el.hidden ? el.value.trim() : '';
    }

    // Mirrors the URL Strava's own header search builds for Segments
    // mode ("?utf8=✓&keywords=…&gsf=1"), so sport/category filters keep
    // whatever defaults the results page would normally apply.
    function buildUrl(keywords, loc) {
      const u = new URL(SEARCH_PATH, location.origin);
      u.searchParams.set('utf8', '✓');
      u.searchParams.set('keywords', keywords || '');
      u.searchParams.set('gsf', '1');
      if (loc) u.searchParams.set(PARAM, loc);
      return u.toString();
    }

    // The header's jQuery UI autocomplete marks the highlighted entry
    // with `ui-state-focus`. Its first entry is
    // `#global-search-menu-header` ("Search segments: …"), which means
    // "run the search" — that one is ours to take over. Every other
    // entry is a link to one specific segment, and Enter there should
    // jump to it exactly as Strava intends.
    function suggestionHighlighted() {
      const menu = document.querySelector('#global-search-autocomplete-container ul.ui-autocomplete');
      if (!menu || getComputedStyle(menu).display === 'none') return false;
      const focused = menu.querySelector('.ui-state-focus');
      return !!focused && !focused.closest('#global-search-menu-header');
    }

    function submitWithLocation() {
      const kw = document.getElementById('global-search-field');
      const url = buildUrl(kw ? kw.value.trim() : '', locValue());
      console.log(TAG, 'header search with location ->', url);
      location.assign(url);
    }

    let lastMode = null;
    function syncVisibility() {
      const el = locField();
      if (!el) return;
      const on = segmentsMode();
      el.hidden = !on;
      el.style.display = on ? '' : 'none';
      if (on !== lastMode) {
        lastMode = on;
        const btn = modeButton();
        console.log(TAG, `header search mode is "${btn ? btn.getAttribute('data-value') : 'unknown'}";`,
          on ? 'location box shown' : 'location box hidden');
      }
    }

    function insertField() {
      if (document.getElementById(HEADER_FIELD_ID)) { syncVisibility(); return true; }
      const kw = document.getElementById('global-search-field');
      if (!kw || !kw.parentElement) return false;

      const input = document.createElement('input');
      input.id = HEADER_FIELD_ID;
      input.type = 'text';
      // 'form-control' gives us Strava's own input styling; drop the
      // autocomplete class, which belongs to their jQuery widget.
      input.className = 'form-control';
      input.placeholder = 'Location';
      input.setAttribute('aria-label', 'Location');
      input.title = 'Filter segment results by location — comma-separated ' +
        'terms, all of which must appear in the result’s Location.';
      input.autocomplete = 'off';
      Object.assign(input.style, {
        maxWidth: '180px',
        borderLeft: '1px solid #dfdfe8',
      });

      kw.parentElement.insertBefore(input, kw.nextSibling);
      observeMode();
      syncVisibility();
      console.log(TAG, 'location field added to header search widget');
      return true;
    }

    // Follow the mode dropdown, which rewrites data-value on its
    // button. Re-attached whenever we (re-)insert our field, since a
    // header re-render replaces the button our observer was watching.
    let modeObserver = null;
    function observeMode() {
      const btn = modeButton();
      const field = document.getElementById('global-search-field');
      if (!btn && !field) return;
      if (modeObserver) modeObserver.disconnect();
      modeObserver = new MutationObserver(syncVisibility);
      if (btn) modeObserver.observe(btn, { attributes: true, attributeFilter: ['data-value'] });
      if (field) modeObserver.observe(field, { attributes: true, attributeFilter: ['data-search-filter'] });
    }

    function init() {
      if (!insertField()) {
        console.log(TAG, 'header search field not present yet; watching for it');
      }

      // Intercept in the capture phase, ahead of Strava's own handlers,
      // but only when we actually have something to add.
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const id = e.target && e.target.id;
        if (id !== HEADER_FIELD_ID && id !== 'global-search-field') return;
        if (!segmentsMode() || !locValue()) return;
        // Enter on a highlighted suggestion jumps straight to that one
        // segment — a location filter has nothing to say about it.
        if (suggestionHighlighted()) {
          console.log(TAG, 'suggestion highlighted; leaving Enter to Strava');
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        submitWithLocation();
      }, true);

      document.addEventListener('click', (e) => {
        const btnEl = e.target && e.target.closest && e.target.closest('#global-search-button');
        if (!btnEl) return;
        if (!segmentsMode() || !locValue()) return;
        e.preventDefault();
        e.stopPropagation();
        submitWithLocation();
      }, true);

      const form = document.getElementById('global-search-bar');
      if (form) {
        form.addEventListener('submit', (e) => {
          if (!segmentsMode() || !locValue()) return;
          e.preventDefault();
          e.stopPropagation();
          submitWithLocation();
        }, true);
      }

      // Some Strava pages render or re-render the header after we run;
      // (re-)insert whenever ours is missing, and keep the mode
      // observer pointed at the current elements.
      const observer = new MutationObserver(() => {
        if (!document.getElementById(HEADER_FIELD_ID)) insertField();
        else if (modeObserver === null) observeMode();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return { init };
  })();

  headerWidget.init();
  if (location.pathname === SEARCH_PATH) searchPage.init();
})();
