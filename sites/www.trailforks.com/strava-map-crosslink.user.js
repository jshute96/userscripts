// ==UserScript==
// @name         Trailforks ↔ Strava: Cross-link maps
// @namespace    https://github.com/jshute96/userscripts
// @version      0.1.0
// @description  Adds a button on each site's maps that opens the other site's map at the same location and zoom level.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://www.trailforks.com/*
// @match        https://www.strava.com/*
// @grant        none
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[map-xlink]';
  const BUTTON_ID = 'jshute-map-crosslink';
  const STYLE_MARK = 'data-jshute-map-crosslink-style';
  const DEBOUNCE_MS = 200;
  // Both maps are Mapbox-style: zoom N means the same scale on either
  // site, so a view carries across as the same three numbers.
  const STRAVA_MAP_URL = 'https://www.strava.com/maps/global-heatmap/personal-heatmap';
  const TRAILFORKS_MAP_URL = 'https://www.trailforks.com/trails/map/';

  // Strava's own "S" chevron mark.
  const STRAVA_ICON =
    '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">' +
    '<path fill="#fc4c02" d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066' +
    'm-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/></svg>';
  // The triangle-and-tree mark from Trailforks' own logo SVG.
  const TRAILFORKS_ICON =
    '<svg viewBox="-207 241 94 80" width="18" height="18" aria-hidden="true">' +
    '<polygon fill="#ffcd05" points="-204 319 -160.2 243 -116.3 319"/>' +
    '<path fill="#333" d="m-160.5 291.5l6.8 4.2v17h8.1v-20.4l-9.7-7v-21.5h-9.4v21.5l-9.7 7v20.4h8.1v-17l6.4-4.6"/>' +
    '</svg>';

  const onTrailforks = location.hostname.endsWith('trailforks.com');

  function log(...args) {
    console.log(TAG, ...args);
  }

  // ---------------------------------------------------------------
  // Reading the current view: {lat, lon, zoom} or null.

  function trailforksView() {
    const map = window.map;
    if (!map || typeof map.getCenter !== 'function') return null;
    // wrap() keeps lng in [-180, 180] after panning across the antimeridian.
    const c = map.getCenter().wrap();
    return { lat: c.lat, lon: c.lng, zoom: map.getZoom() };
  }

  // Strava's maps are their own engine on a canvas (no Mapbox object to
  // ask), but the React component around the canvas keeps the engine in
  // its context. Walk up the fiber tree from the canvas to find it.
  function stravaCamera() {
    for (const canvas of document.querySelectorAll('canvas')) {
      const key = Object.keys(canvas).find((k) => k.startsWith('__reactFiber$'));
      let fiber = canvas[key];
      for (let i = 0; fiber && i < 12; i++, fiber = fiber.return) {
        const ctx = fiber.stateNode && fiber.stateNode.context;
        const engine = ctx && ctx.terrainEngine;
        if (engine && typeof engine.getCamera === 'function') return engine.getCamera();
      }
    }
    return null;
  }

  function stravaView() {
    const cam = stravaCamera();
    if (cam) {
      const target = cam.getTarget();
      const lat = target.lookAtPoint.latitude;
      const lon = target.lookAtPoint.longitude;
      // The camera reports scale as meters per CSS pixel. Invert the web
      // Mercator ground resolution (512px tiles, like Strava's URL hash).
      const metersPerPixel = cam.getScaleMetersPerPixel();
      const equatorPixels = 2 * Math.PI * 6378137 * Math.cos(lat * Math.PI / 180);
      const zoom = Math.log2(equatorPixels / (512 * metersPerPixel));
      return { lat, lon, zoom };
    }
    // The heatmap page also keeps the view in the URL as #zoom/lat/lon.
    const m = /^#(\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/.exec(location.hash);
    if (m) return { zoom: +m[1], lat: +m[2], lon: +m[3] };
    return null;
  }

  // Reading the view reaches into site internals that may not be ready;
  // a throw here would otherwise escape the observer with no log line.
  function currentView() {
    try {
      return onTrailforks ? trailforksView() : stravaView();
    } catch (err) {
      log('reading map view failed:', err);
      return null;
    }
  }

  function otherSiteUrl(view) {
    const lat = view.lat.toFixed(5);
    const lon = view.lon.toFixed(5);
    const zoom = view.zoom.toFixed(2);
    return onTrailforks
      ? `${STRAVA_MAP_URL}#${zoom}/${lat}/${lon}`
      : `${TRAILFORKS_MAP_URL}?z=${zoom}&lat=${lat}&lon=${lon}`;
  }

  // ---------------------------------------------------------------
  // The button

  function injectStyle() {
    if (document.querySelector('style[' + STYLE_MARK + ']')) return;
    const style = document.createElement('style');
    style.setAttribute(STYLE_MARK, '');
    style.textContent = `
      #${BUTTON_ID} svg { display: block; margin: auto; }
      /* Trailforks' legacy map toolbar: match the icon-only "save map view" item. */
      /* The neighbors are inline-blocks aligned on their text baseline, so
         give ours the same text metrics (a 13px/20.8px line in 6px padding)
         and hang the icon off that line instead of using a flex box. */
      ul.bartop > li#${BUTTON_ID}-item > .parent { display: block; padding: 6px 8px; font-size: 13px; line-height: 20.8px; }
      ul.bartop > li#${BUTTON_ID}-item > .parent > a { display: inline; }
      ul.bartop > li#${BUTTON_ID}-item svg { display: inline-block; vertical-align: middle; }
    `;
    document.head.appendChild(style);
  }

  function makeButton(icon, title) {
    const a = document.createElement('a');
    a.id = BUTTON_ID;
    a.href = '#';
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = title;
    a.setAttribute('aria-label', title);
    a.innerHTML = icon;
    // Keep the href current for hover (right-click / copy link) and for
    // the click itself. Reading the view is cheap on both sites.
    const refresh = () => {
      const view = currentView();
      if (view) {
        a.href = otherSiteUrl(view);
      } else {
        log('current map view not available yet');
      }
    };
    a.addEventListener('pointerenter', refresh);
    a.addEventListener('focus', refresh);
    a.addEventListener('click', (ev) => {
      refresh();
      if (a.getAttribute('href') === '#') {
        ev.preventDefault();
        log('click ignored: no map view to link');
        return;
      }
      log('opening', a.href);
    });
    refresh();
    return a;
  }

  // Trailforks has two map UIs. The older one (trail pages, region maps)
  // has a horizontal <ul class="bartop"> menu bar over the map; the newer
  // full-page map (/map/, /trails/map/) has a row of floating pill
  // buttons (activity, Filters, Views) along the top.
  function insertTrailforks() {
    const legacyAnchor = document.querySelector('ul.bartop > li#mapViewMenu');
    if (legacyAnchor) {
      // Same li > div.parent structure as the neighbors, so the site's
      // own hover highlight and spacing apply.
      const li = document.createElement('li');
      li.id = BUTTON_ID + '-item';
      li.className = 'menuitem';
      const parent = document.createElement('div');
      parent.className = 'parent';
      parent.appendChild(makeButton(STRAVA_ICON, 'Open this map in Strava'));
      li.appendChild(parent);
      legacyAnchor.insertAdjacentElement('afterend', li);
      log('button added to legacy map toolbar');
      return true;
    }
    const floatRow = document.querySelector('#tfMapFloatbar .tf-map-floatbtns-row');
    if (floatRow) {
      const a = makeButton(STRAVA_ICON, 'Open this map in Strava');
      a.className = 'tf-map-floatbtn hovertip';
      floatRow.appendChild(a);
      log('button added to map float bar');
      return true;
    }
    return false;
  }

  // Strava: the full-page map (/maps/...) has a horizontal pill menu;
  // an activity page's map has a small control strip in its top-right.
  // Both are React-rendered, so copy a sibling's class names rather than
  // hardcoding the hashed CSS-module names. The reference's selector is
  // kept on the button so syncClassName() can re-copy later: the strip
  // is server-rendered and then hydrated, and the classes on the
  // reference can change under us after we've already copied them.
  const REF_ATTR = 'data-jshute-class-ref';
  const MAPS_REF = '[data-testid="my-routes-link"]';
  const ACTIVITY_REF = '[data-testid="gpx-download-button"]';

  function syncClassName(a) {
    const ref = document.querySelector(a.getAttribute(REF_ATTR));
    if (ref && ref.className && ref.className !== a.className) {
      if (a.className) log('button class updated from reference');
      a.className = ref.className;
    }
  }

  function insertStrava() {
    const segments = document.querySelector('.react-horizontal-scrolling-menu--item[data-key="segments"]');
    const myRoutes = document.querySelector(MAPS_REF);
    if (segments && myRoutes) {
      const item = document.createElement('div');
      item.className = 'react-horizontal-scrolling-menu--item';
      item.dataset.key = BUTTON_ID;
      const a = makeButton(TRAILFORKS_ICON, 'Open this map in Trailforks');
      a.setAttribute(REF_ATTR, MAPS_REF);
      syncClassName(a);
      item.appendChild(a);
      // After the separator that follows the Segments pill.
      let after = segments.nextElementSibling;
      if (!after || !after.className.includes('separator')) after = segments;
      after.insertAdjacentElement('afterend', item);
      log('button added to map page menu');
      return true;
    }
    const fullscreen = document.querySelector('[data-testid="fullscreen-toggle-button"]');
    const gpx = document.querySelector(ACTIVITY_REF);
    if (fullscreen && gpx) {
      const a = makeButton(TRAILFORKS_ICON, 'Open this map in Trailforks');
      a.setAttribute(REF_ATTR, ACTIVITY_REF);
      syncClassName(a);
      fullscreen.insertAdjacentElement('beforebegin', a);
      log('button added to activity map controls');
      return true;
    }
    return false;
  }

  // Idempotent: the observer calls this on every DOM change, and React
  // re-renders can drop the button, so it's re-added whenever missing.
  function ensureButton() {
    const existing = document.getElementById(BUTTON_ID);
    if (existing) {
      if (existing.hasAttribute(REF_ATTR)) syncClassName(existing);
      return;
    }
    injectStyle();
    if (onTrailforks) insertTrailforks(); else insertStrava();
  }

  log('init on', location.hostname + location.pathname);
  ensureButton();

  let timer = null;
  new MutationObserver(() => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      ensureButton();
    }, DEBOUNCE_MS);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
