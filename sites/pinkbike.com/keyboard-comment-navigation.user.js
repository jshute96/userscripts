// ==UserScript==
// @name         Pinkbike: Keyboard comment navigation
// @namespace    https://github.com/jshute96/userscripts
// @version      1.2.0
// @description  Adds keyboard shortcuts for moving through the comments on an article — next and previous comment, parent, next thread, and jump to the comments section.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://www.pinkbike.com/news/*
// @require      https://raw.githubusercontent.com/jshute96/userscripts/main/lib/keyboard-shortcuts.js
// @require      https://raw.githubusercontent.com/jshute96/userscripts/main/lib/keyboard-comment-nav.js
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[pb nav]';

  if (window.__pbNavLoaded) {
    console.log(TAG, 'already loaded; skipping duplicate run');
    return;
  }
  window.__pbNavLoaded = true;

  console.log(TAG, 'initializing');

  CommentNav.create({
    tag: TAG,

    // Every comment and reply, in display order. `.cmcont` is the
    // per-comment container; replies carry `.commentreply2` as well.
    comments: () => [...document.querySelectorAll('.cmcont')],

    // Viewport intersection is tested against the comment text, not
    // the `.cmcont` container: the container includes the avatar
    // column and reply-box footer, which stay barely-intersected long
    // after we've visually scrolled into the next comment.
    body: el => el.querySelector('.comtext') || el,

    id: el => el.id || '?',

    // Threads are one level deep. A reply's parent is the single
    // non-reply `.cmcont` inside the same `.ppcont` thread wrapper.
    // That one accessor is all the library needs to derive `h`/`l`
    // (step between roots, or between replies within a thread),
    // `r` (same as `p` at this depth), and `m` (next thread).
    parentOf: el => {
      if (!el.classList.contains('commentreply2')) return null;
      return el.closest('.ppcont')?.querySelector('.cmcont:not(.commentreply2)')
        || null;
    },

    // Pinkbike lazy-loads images and injects ad/deals slots while you
    // read, so content finishing above the target during the scroll
    // animation pushes it further down the document and we land short.
    // Worst case is `c` from the top of a long article.
    strategy: 'settle',

    // Prefer the comments-UI wrapper over the `#commenttop` anchor:
    // that anchor sits earlier in the page, with related articles and
    // ad widgets injected in between, so it leaves the filler at the
    // top of the viewport instead of the "N Comments" header.
    commentsTop: () => document.querySelector('.news-comments-container')
      || document.querySelector('.news-comments')
      || document.getElementById('commenttop'),
  });
})();
