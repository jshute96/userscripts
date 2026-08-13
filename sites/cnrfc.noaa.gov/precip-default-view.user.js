// ==UserScript==
// @name         NOAA CNRFC: Default precipitation map view (Bay Area, 24-hour)
// @namespace    https://github.com/jshute96/userscripts
// @version      1.0.2
// @description  Opens NOAA's map zoomed to the SF Bay Area with 24-hour precipitation selected by default (avoiding several navigation clicks to get there).
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://www.cnrfc.noaa.gov/ol.php?type=precip*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[cnrfc precip]';

  if (window.__cnrfcPrecipDefaultsLoaded) {
    console.log(TAG, 'already loaded; skipping duplicate run');
    return;
  }
  window.__cnrfcPrecipDefaultsLoaded = true;

  // Centered at the south-bay shoreline just west of the San Jose label, which
  // is roughly where the user wants their default view focused.
  const CENTER_LON = -122.0;
  const CENTER_LAT = 37.4;
  // Page default is zoom 6; user wants the equivalent of three mouse-wheel zoom-ins.
  const TARGET_ZOOM = 9;

  console.log(TAG, 'initializing');

  function waitFor(predicate, label, cb, attempts = 100) {
    let n = 0;
    const tick = () => {
      if (predicate()) { cb(); return; }
      if (++n >= attempts) {
        console.log(TAG, 'gave up waiting for', label, 'after', attempts, 'attempts');
        return;
      }
      setTimeout(tick, 100);
    };
    tick();
  }

  function applyZoom() {
    const map = window.map;
    const ol = window.ol;
    if (!map || !ol || !map.getView) {
      console.log(TAG, 'map or ol not ready');
      return;
    }
    try {
      const view = map.getView();
      const center = ol.proj.transform([CENTER_LON, CENTER_LAT], 'EPSG:4326', 'EPSG:3857');
      view.setCenter(center);
      view.setZoom(TARGET_ZOOM);
      console.log(TAG, 'zoomed to', CENTER_LAT, CENTER_LON, 'at zoom', TARGET_ZOOM);
    } catch (e) {
      console.log(TAG, 'failed to set view:', e);
    }
  }

  function applyTwentyFourHour() {
    const cb = document.getElementById('twentyfourhourP');
    if (!cb) {
      console.log(TAG, 'twentyfourhourP checkbox not found');
      return;
    }
    if (cb.checked) {
      console.log(TAG, '24-hour layer already on; leaving it');
      return;
    }
    cb.click();
    console.log(TAG, 'enabled 24-hour observed precip layer');
  }

  waitFor(
    () => window.map && window.ol && typeof window.map.getView === 'function' && window.map.getView(),
    'OpenLayers map',
    () => {
      applyZoom();
      waitFor(
        () => document.getElementById('twentyfourhourP'),
        '24-hour checkbox',
        applyTwentyFourHour
      );
    }
  );
})();
