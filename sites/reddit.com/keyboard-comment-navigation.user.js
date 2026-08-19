// ==UserScript==
// @name         Reddit: Keyboard comment navigation
// @namespace    https://github.com/jshute96/userscripts
// @version      1.1.0
// @description  Adds keyboard shortcuts for moving through the comments on a post — next and previous comment, parent, next thread — taking over reddit's own j/k.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://www.reddit.com/*
// @require      https://raw.githubusercontent.com/jshute96/userscripts/main/lib/keyboard-shortcuts.js
// @require      https://raw.githubusercontent.com/jshute96/userscripts/main/lib/keyboard-comment-nav.js
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[reddit nav]';

  if (window.__redditNavLoaded) {
    console.log(TAG, 'already loaded; skipping duplicate run');
    return;
  }
  window.__redditNavLoaded = true;

  console.log(TAG, 'initializing');

  function thingId(c) {
    return c.getAttribute('thingid') || '?';
  }

  CommentNav.create({
    tag: TAG,

    // Reddit binds its own j/k. Capture phase plus
    // stopImmediatePropagation on handled keys is what beats it.
    capture: true,

    // @match is the whole site so the script survives SPA navigation
    // into a thread; this gate decides whether to act.
    enabled: () => /\/comments\//.test(location.pathname),

    comments: () => [...document.querySelectorAll('shreddit-comment')],

    // Reddit ids each comment's body div `<thingid>-comment-rtjson-content`.
    // The shreddit-comment element itself wraps the entire subtree
    // (body + nested children + reply box) and stays intersecting the
    // viewport long after the text has scrolled past.
    body: c => document.getElementById(`${thingId(c)}-comment-rtjson-content`) || c,

    id: thingId,

    // Nested shreddit-comments live in their parent's light DOM (they
    // get slotted into the shadow DOM for rendering), so the light-DOM
    // ancestor chain is the comment tree.
    parentOf: c => c.parentElement?.closest('shreddit-comment') || null,

    // Reddit's top banner is sticky. It sets scroll-margin-top on
    // depth-0 comments itself, but not on nested replies or the
    // comments header, so we compute the offset for everything.
    //
    // Reddit declares the height as --shreddit-header-height, but on
    // <shreddit-app> rather than the document root — reading it off
    // :root silently yields "" and falls through to the default. Both
    // are checked so a future move back to :root also works; measured
    // against the live <reddit-header-large> the declared 56px is
    // accurate to a pixel.
    headerOffset: () => {
      for (const el of [document.querySelector('shreddit-app'),
                        document.documentElement]) {
        if (!el) continue;
        const n = parseFloat(getComputedStyle(el)
          .getPropertyValue('--shreddit-header-height').trim());
        if (Number.isFinite(n)) return n + 8;
      }
      return 56 + 8;
    },

    commentsTop: () => document.querySelector('shreddit-comments-sort-dropdown')
      || document.querySelector('shreddit-comment-tree-stats')
      || document.querySelector('shreddit-comment-tree'),
  });
})();
