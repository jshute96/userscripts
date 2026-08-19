// ==UserScript==
// @name         The Athletic: Keyboard comment navigation
// @namespace    https://github.com/jshute96/userscripts
// @version      1.1.0
// @description  Adds keyboard shortcuts for moving through the comments on an article — next and previous comment, parent, next thread, and jump to the comments section.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://www.nytimes.com/athletic/*
// @require      https://raw.githubusercontent.com/jshute96/userscripts/main/lib/keyboard-shortcuts.js
// @require      https://raw.githubusercontent.com/jshute96/userscripts/main/lib/keyboard-comment-nav.js
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[athletic nav]';

  if (window.__athleticNavLoaded) {
    console.log(TAG, 'already loaded; skipping duplicate run');
    return;
  }
  window.__athleticNavLoaded = true;

  console.log(TAG, 'initializing');

  // The Athletic uses CSS-modules with hashed class suffixes that
  // rotate on every deploy. Match by prefix, never the full class.
  const SEL = {
    comment:       '[class*="Comment_Base"]',
    reply:         '[class*="Comment_Reply"]',
    bodyContainer: '[class*="Comment_BodyContainer"]',
    // The "COMMENTS <count>" banner row, most-specific first.
    // #comments-section sits above the banner with a sponsored puzzle
    // tile in between, which is not where `c` should land.
    sectionTop:  ['[class*="Comments_CommentBanner"]', '#comments-section'],
    // The Athletic doesn't render the comments markup until it
    // scrolls near the viewport, so when neither anchor above exists
    // we click this pill and let the site load and scroll there.
    openButton:  'button[aria-label="Open Comments"]',
  };

  const isReply = el => el.matches(SEL.reply);

  CommentNav.create({
    tag: TAG,

    comments: () => [...document.querySelectorAll(SEL.comment)],

    body: el => el.querySelector(SEL.bodyContainer) || el,

    // Threads are one level deep, and flat in the DOM: roots and
    // replies are siblings in document order rather than nested. So a
    // reply's parent is the nearest preceding non-reply — tracked in
    // one pass rather than scanned backwards per comment, which would
    // be O(n) inside the library's O(n) sibling scan.
    parentOf: CommentNav.parentMapper(all => {
      const map = new Map();
      let lastRoot = null;
      for (const el of all) {
        if (isReply(el)) {
          map.set(el, lastRoot);
        } else {
          map.set(el, null);
          lastRoot = el;
        }
      }
      return map;
    }),

    // NYT sets scroll-padding-top on <html> to clear its fixed top
    // nav; reuse it so a comment mostly hidden behind the nav isn't
    // treated as "current".
    headerOffset: () => {
      const v = parseFloat(
        getComputedStyle(document.documentElement).scrollPaddingTop);
      return Number.isFinite(v) ? v : 0;
    },

    commentsTop: () => {
      for (const sel of SEL.sectionTop) {
        const el = document.querySelector(sel);
        if (el) return el;
      }
      return null;
    },

    open: {
      canOpen: () => !!document.querySelector(SEL.openButton),
      click: () => document.querySelector(SEL.openButton).click(),
    },
  });
})();
