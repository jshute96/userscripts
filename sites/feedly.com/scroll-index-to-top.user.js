// ==UserScript==
// @name         Feedly: Scroll Index page to top
// @namespace    https://github.com/jshute96/userscripts
// @version      2.0.2
// @description  Fixes the Index page landing part-way down: navigating to it (e.g. with G-then-I) now opens scrolled to the top, as expected.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://feedly.com/*
// @grant        none
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[feedly index-top]';

  if (window.__feedlyIndexTopLoaded) {
    console.log(TAG, 'already loaded; skipping duplicate run');
    return;
  }
  window.__feedlyIndexTopLoaded = true;

  console.log(TAG, 'init on', location.pathname);

  // Event name scoped to this script so multiple Feedly scripts that each
  // patch the History API don't collide on a shared event name.
  const URL_CHANGE_EVENT = 'feedly-index-top:urlchange';

  // Feedly serves the Index at /i/feedIndex, but a fresh document load can
  // start at /i/index and be rewritten to /i/feedIndex a moment later.
  const INDEX_PATH_RE = /^\/i\/(feedIndex|index)\/?$/;
  const isIndexPage = () => INDEX_PATH_RE.test(location.pathname);

  // Feedly does NOT scroll the document: with the Index sitting in its
  // wrong scrolled-down state, window.scrollY and
  // document.documentElement.scrollTop are both 0, and the only element
  // with a non-zero scrollTop is div#feedlyFrame. It's an inner overflow
  // container that fills the viewport, so its scrollbar looks like the
  // window's. Read and write must both target it — an earlier version
  // wrote to #feedlyFrame but read window.scrollY, so it silently did
  // nothing while reporting success.
  const scroller = () => document.getElementById('feedlyFrame');

  function currentScroll() {
    const el = scroller();
    if (el) return el.scrollTop;
    // Fall back to the document if Feedly ever drops that wrapper.
    return window.scrollY || document.documentElement.scrollTop || 0;
  }

  function scrollToTop() {
    // 'instant' guards against a future scroll-behavior: smooth.
    const el = scroller();
    if (el) el.scrollTo({ top: 0, behavior: 'instant' });
    else window.scrollTo({ top: 0, behavior: 'instant' });
  }

  // Only act on the *transition* into the Index, not on every route event.
  // Feedly emits several history events per visit, and resetting on each
  // would yank the page back to the top after you'd deliberately scrolled
  // down. Starts false so an initial load directly on the Index still
  // counts as an arrival.
  let wasIndex = false;

  function onUrlChange() {
    const nowIndex = isIndexPage();
    if (nowIndex && !wasIndex) {
      // #feedlyFrame sits outside the subtree Feedly's router swaps, so it
      // arrives here still holding the offset from the feed you were
      // reading (measured: 4000 from a scrolled feed). Resetting it is the
      // whole fix.
      //
      // The log says "scrollTop", not "scrollY", deliberately: window.scrollY
      // is permanently 0 on Feedly, and calling this "scrollY" sent an
      // earlier debugging session chasing the wrong element for rounds.
      console.log(TAG, 'arrived at Index; scrollTop now', currentScroll());
      scrollToTop();
    }
    wasIndex = nowIndex;
  }

  // SPA navigation: pushState/replaceState don't fire popstate, so patch
  // them to emit our own event. See CLAUDE.md "SPA sites" for the idiom.
  for (const m of ['pushState', 'replaceState']) {
    const orig = history[m];
    history[m] = function (...args) {
      const r = orig.apply(this, args);
      window.dispatchEvent(new Event(URL_CHANGE_EVENT));
      return r;
    };
  }
  window.addEventListener('popstate', onUrlChange);
  window.addEventListener(URL_CHANGE_EVENT, onUrlChange);

  onUrlChange(); // initial load
})();
