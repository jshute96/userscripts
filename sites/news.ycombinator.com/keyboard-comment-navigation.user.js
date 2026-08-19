// ==UserScript==
// @name         Hacker News: Keyboard comment navigation
// @namespace    https://github.com/jshute96/userscripts
// @version      1.2.0
// @description  Adds keyboard shortcuts for moving through the comments on a story — next and previous comment, parent, next thread, and jump to the comments section.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://news.ycombinator.com/item*
// @require      https://raw.githubusercontent.com/jshute96/userscripts/main/lib/keyboard-shortcuts.js
// @require      https://raw.githubusercontent.com/jshute96/userscripts/main/lib/keyboard-comment-nav.js
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[hn nav]';

  if (window.__hnNavLoaded) {
    console.log(TAG, 'already loaded; skipping duplicate run');
    return;
  }
  window.__hnNavLoaded = true;

  console.log(TAG, 'initializing');

  // HN encodes reply depth as an indent spacer in each row's first
  // cell: `<td class="ind" indent="3"><img src="s.gif" width="120">`.
  // The attribute is authoritative; the image width (40px per level)
  // is the fallback for older markup.
  function depthOf(row) {
    const ind = row.querySelector('td.ind');
    if (!ind) return 0;
    const attr = ind.getAttribute('indent');
    if (attr !== null && attr !== '') {
      const n = parseInt(attr, 10);
      if (Number.isFinite(n)) return n;
    }
    const img = ind.querySelector('img');
    const w = img ? parseInt(img.getAttribute('width'), 10) : 0;
    return Number.isFinite(w) ? Math.round(w / 40) : 0;
  }

  // A row's parent is the nearest preceding row at a shallower depth.
  // Resolving that per call would be O(n) inside the library's O(n)
  // sibling scan, so the whole map is derived in one pass;
  // parentMapper caches it for the duration of a keypress.
  const parentOf = CommentNav.parentMapper(all => {
    const map = new Map();
    // Stack of the most recent row seen at each depth.
    const atDepth = [];
    for (const row of all) {
      const d = depthOf(row);
      map.set(row, d > 0 ? (atDepth[d - 1] || null) : null);
      atDepth[d] = row;
      atDepth.length = d + 1;
    }
    return map;
  });

  CommentNav.create({
    tag: TAG,

    comments: () => [...document.querySelectorAll('tr.athing.comtr')],

    // Anchor viewport intersection on the comment text. The row also
    // holds the metadata header and reply link, and would stay
    // "intersecting" long after we've visually scrolled past it.
    body: row => row.querySelector('div.comment') || row,

    id: row => row.id,

    parentOf,

    // HN renders no "N comments" header above the tree, so the first
    // comment row is the top of the comments.
    commentsTop: () => document.querySelector('tr.athing.comtr'),
  });
})();
