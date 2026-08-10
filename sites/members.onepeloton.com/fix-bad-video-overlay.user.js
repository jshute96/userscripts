// ==UserScript==
// @name         Peloton Player: Fix bad video overlay
// @namespace    https://github.com/jshute96/userscripts
// @version      2.0.1
// @description  Fix a bug in Peloton's video player where, on large high-res monitors, a fixed-size "cinematic vignette" overlay is painted on top of the video, creating an ugly horizontal seam across it.
// @author       Jeff Shute <jshute@gmail.com>
// @match        https://members.onepeloton.com/*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[peloton overlay]';
  const URL_PART = 'cf_video_overlay_with_timeline';
  const MARKER = 'data-jshute-overlay-hidden';

  console.log(TAG, 'init', location.pathname);

  // The overlay is a single styled-components <div> with a background-image
  // pointing at /_next/static/media/cf_video_overlay_with_timeline.<hash>.png.
  // Peloton's styled-components class names are hashed and rotate every
  // deploy, so we identify the element by its background-image URL (the
  // source filename is stable; only the content-hash suffix changes).

  function clearOverlay() {
    for (const el of document.querySelectorAll('div')) {
      if (el.hasAttribute(MARKER)) continue;
      const bg = getComputedStyle(el).backgroundImage;
      if (!bg.includes(URL_PART)) continue;
      el.style.setProperty('background-image', 'none', 'important');
      el.setAttribute(MARKER, '');
      console.log(TAG, 'hid overlay on', el);
    }
  }

  // The player div is rendered after route navigation finishes, so a single
  // sweep at document-idle usually misses it. Poll briefly until found,
  // then stop. URL-change re-arms the poll.
  let pollId = null;
  let polls = 0;
  function startPolling() {
    if (pollId) return;
    polls = 0;
    pollId = setInterval(() => {
      clearOverlay();
      polls++;
      const found = document.querySelector(`[${MARKER}]`);
      if (found || polls > 40) {
        clearInterval(pollId);
        pollId = null;
        if (!found && location.pathname.startsWith('/classes/player/')) {
          console.log(TAG, 'gave up after 10s without finding the overlay element');
        }
      }
    }, 250);
  }

  // SPA: hook history mutations and re-arm on URL changes.
  const URL_CHANGE_EVENT = 'peloton-fix-bad-video-overlay:urlchange';
  for (const m of ['pushState', 'replaceState']) {
    const orig = history[m];
    history[m] = function (...a) {
      const r = orig.apply(this, a);
      window.dispatchEvent(new Event(URL_CHANGE_EVENT));
      return r;
    };
  }
  function onUrlChange() {
    // The styled-components div is re-mounted on player navigation;
    // drop our marker so the new instance gets re-scanned.
    for (const el of document.querySelectorAll(`[${MARKER}]`)) {
      el.removeAttribute(MARKER);
    }
    startPolling();
  }
  window.addEventListener('popstate', onUrlChange);
  window.addEventListener(URL_CHANGE_EVENT, onUrlChange);

  startPolling();
})();
