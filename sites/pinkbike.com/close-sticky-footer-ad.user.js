// ==UserScript==
// @name         Pinkbike: Auto-close the floating footer ads
// @namespace    https://github.com/jshute96/userscripts
// @version      1.2.1
// @description  Closes the sticky ad banners pinned to the bottom of the page that cover article text.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://www.pinkbike.com/*
// @grant        none
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[pinkbike ad]';

  // Each entry is one ad unit we know how to dismiss. `container` locates
  // the overlay; `close` locates the click target inside it.
  const TARGETS = [
    {
      // Pinkbike's own sticky footer (Google Ad Manager slot sticky-footer-pb).
      // Shown and hidden with jQuery fadeIn/fadeOut on scroll.
      name: 'sticky footer',
      container: '#nfs_footer',
      close: '#sticky-footer-pb-close',
    },
    {
      // Underdog Media ("udm") adhesion unit, injected by a third-party tag.
      // The close handler sits on the div, not the <svg> inside it.
      name: 'udm adhesion',
      container: '.udm-inpage-footer-container',
      close: '.udm-close-button',
    },
  ];

  const STATUS_DELAY_MS = 15000;

  // The ad fades in over ~600ms (jQuery "slow"), and a click landing mid-fade
  // is undone by the rest of the animation. So: wait out the fade before
  // judging whether the click worked, and don't re-click faster than that.
  const VERIFY_DELAY_MS = 1200;
  const CLICK_COOLDOWN_MS = 1000;

  // Stop clicking a container that keeps ignoring us, rather than retrying
  // for the life of the page.
  const MAX_ATTEMPTS = 10;

  console.log(TAG, 'initializing');

  // These overlays are position:fixed, so offsetParent is always null and
  // can't be used. They also hide themselves via visibility/opacity rather
  // than display, so check all three plus the measured box.
  function isVisible(el) {
    if (!el) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  const state = TARGETS.map((t) => ({
    target: t,
    seen: false,
    attempts: 0,
    closes: 0,
    lastClickAt: 0,
    gaveUp: false,
  }));

  function verify(entry) {
    const t = entry.target;
    if (isVisible(document.querySelector(t.container))) {
      console.warn(TAG, 'click did not stick on ' + t.name +
        ' (attempt ' + entry.attempts + ' of ' + MAX_ATTEMPTS + ')');
      if (entry.attempts >= MAX_ATTEMPTS) {
        entry.gaveUp = true;
        console.warn(TAG, 'giving up on ' + t.name + ' — its close button may have changed');
      }
      return;
    }
    entry.closes += 1;
    // MAX_ATTEMPTS is about consecutive failures. A close that sticks means
    // the button still works, so a long read that re-shows the ad many times
    // must not exhaust the budget and report a break that isn't one.
    entry.attempts = 0;
    console.log(TAG, t.name + ' ad closed' + (entry.closes > 1 ? ' (again, x' + entry.closes + ')' : ''));
  }

  function tryClose(entry) {
    if (entry.gaveUp || entry.attempts >= MAX_ATTEMPTS) return;
    const t = entry.target;
    const container = document.querySelector(t.container);
    if (!container || !isVisible(container)) return;
    if (!entry.seen) {
      entry.seen = true;
      console.log(TAG, t.name + ' ad detected (' + t.container + ')');
    }
    // Don't burn attempts on the flurry of style writes a fade produces.
    const now = performance.now();
    if (now - entry.lastClickAt < CLICK_COOLDOWN_MS) return;
    const btn = container.querySelector(t.close);
    if (!btn) {
      console.warn(TAG, t.name + ' is visible but close button not found (' + t.close + ')');
      return;
    }
    entry.attempts += 1;
    entry.lastClickAt = now;
    console.log(TAG, 'clicking close on ' + t.name);
    btn.click();
    setTimeout(() => verify(entry), VERIFY_DELAY_MS);
  }

  let observer = null;
  let pending = null;

  function sweep() {
    pending = null;
    state.forEach(tryClose);
    // Keep watching even after a successful close: the site re-shows these
    // units on scroll, and a fade can undo a click we thought had landed.
    if (state.every((e) => e.gaveUp || e.attempts >= MAX_ATTEMPTS) && observer) {
      console.log(TAG, 'nothing left to try — disconnecting observer');
      observer.disconnect();
      observer = null;
    }
  }

  // The page mutates constantly while ads load and fade, so coalesce bursts.
  function scheduleSweep() {
    if (pending !== null) return;
    pending = setTimeout(sweep, 100);
  }

  observer = new MutationObserver(scheduleSweep);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class'],
  });

  sweep();

  // Distinguish "the ad never appeared" (normal) from "we found it and
  // couldn't close it" (a break) without needing DevTools open from load.
  setTimeout(function () {
    const summary = state
      .map((e) => {
        const open = isVisible(document.querySelector(e.target.container));
        if (!e.seen) return e.target.name + ': not seen';
        if (e.gaveUp) return e.target.name + ': SEEN, GAVE UP';
        return e.target.name + ': closed x' + e.closes + (open ? ' but OPEN NOW' : '');
      })
      .join(', ');
    console.log(TAG, 'status after ' + STATUS_DELAY_MS / 1000 + 's — ' + summary);
  }, STATUS_DELAY_MS);
})();
