// ==UserScript==
// @name         Peloton Player: Hide cinematic-vignette video overlay
// @namespace    https://github.com/jshute96/userscripts
// @version      2.0.0
// @description  Remove Peloton's cf_video_overlay_with_timeline.png — a 1920×1080 vignette PNG that gets painted onto the player at natural size. On any player taller than 1080 pixels, it leaves a visible horizontal seam where the PNG ends.
// @author       Jeff Shute <jshute@gmail.com>
// @match        https://members.onepeloton.com/*
// @grant        none
// @run-at       document-idle
// @noframes
// @updateURL    https://github.com/jshute96/userscripts/raw/refs/heads/main/sites/members.onepeloton.com/hide-video-overlay.user.js
// @downloadURL  https://github.com/jshute96/userscripts/raw/refs/heads/main/sites/members.onepeloton.com/hide-video-overlay.user.js
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
    const URL_CHANGE_EVENT = 'peloton-hide-video-overlay:urlchange';
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
