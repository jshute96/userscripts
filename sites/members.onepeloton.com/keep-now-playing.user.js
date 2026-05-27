// ==UserScript==
// @name         Peloton Player: Keep Now-Playing widget visible
// @namespace    https://github.com/jshute96/userscripts
// @version      1.1.0
// @description  Keep the Now-Playing song widget (top-left of the Peloton class player) visible at all times. Other overlays — the top-right toolbar and the bottom status/seek bar — keep their normal hide-on-idle behaviour.
// @author       Jeff Shute <jshute@gmail.com>
// @match        https://members.onepeloton.com/*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[peloton player]';
  console.log(TAG, 'init', location.pathname);

  // Peloton is a SPA: a user can land on /home and SPA-navigate into
  // /classes/player/<id> with no document reload. @match is broadened
  // to the site root so this script is registered regardless of the
  // initial page. The CSS rule below targets a player-only selector
  // (`[data-test-id="videoSongContainer"]`) so it's a no-op on other
  // pages, and the <style> stays in <head> across SPA navigations.

  // Peloton's player toggles the class `slide-out-when-inactive` on the
  // Now-Playing widget when the mouse has been idle for a few seconds.
  // That class lives in an external stylesheet we couldn't capture, but
  // its name and the visual behaviour imply a translate + opacity
  // transition. We neutralise it with !important overrides on the
  // stable `data-test-id` anchor so the widget stays put even when the
  // class is present. (The class is added/removed by React on every
  // toggle, so a CSS override is more robust than scrubbing the
  // attribute with a MutationObserver.)
  const css = `
    [data-test-id="videoSongContainer"] {
      transform: none !important;
      opacity: 1 !important;
      visibility: visible !important;
    }
  `;
  const style = document.createElement('style');
  style.setAttribute('data-jshute', 'peloton-keep-now-playing');
  style.textContent = css;
  document.head.appendChild(style);
  console.log(TAG, 'injected Now-Playing visibility override');
})();
