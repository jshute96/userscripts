// ==UserScript==
// @name         Washington Post: Keyboard comment navigation
// @namespace    https://github.com/jshute96/userscripts
// @version      1.2.0
// @description  Adds keyboard shortcuts for moving through the comments drawer on an article — next and previous comment, parent, next thread, and open or jump to the drawer.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://www.washingtonpost.com/*
// @require      https://raw.githubusercontent.com/jshute96/userscripts/main/lib/keyboard-shortcuts.js
// @require      https://raw.githubusercontent.com/jshute96/userscripts/main/lib/keyboard-comment-nav.js
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[wapo nav]';

  if (window.__wapoNavLoaded) {
    console.log(TAG, 'already loaded; skipping duplicate run');
    return;
  }
  window.__wapoNavLoaded = true;

  console.log(TAG, 'initializing');

  // Exists only while the drawer is open, so it doubles as the gate.
  function drawer() {
    const d = document.getElementById('conversations-drawer');
    if (!d || d.getAttribute('data-state') === 'closed') return null;
    return d;
  }

  // One <article> per comment, top-level and reply alike.
  function comments() {
    const d = drawer();
    if (!d) return [];
    return [...d.querySelectorAll('article[data-comment-id]')];
  }

  // Replies sit inside a thread wrapper that is a *sibling* of the card
  // being replied to, so a reply has no ancestor card to walk up to.
  const THREAD_SEL = '[data-name="thread-wrapper"]';

  // The comment text, as one block. Falling back to the whole card is
  // right for a comment with no text, but is also what a rename of the
  // class would look like, so say once if no card has it.
  let warnedNoBody = false;
  function bodyOf(c) {
    const p = c.querySelector('p.nodeToHtml');
    if (p) return p.parentElement || c;
    if (!warnedNoBody && !drawer()?.querySelector('p.nodeToHtml')) {
      warnedNoBody = true;
      console.log(TAG, 'no p.nodeToHtml anywhere in the drawer;'
        + ' the comment-text selector has changed');
    }
    return c;
  }

  // Still returns the drawer when it doesn't scroll — a window scroll
  // would be worse — but a silent no-op deserves a log.
  let warnedNoScroll = false;
  function scrollContainer() {
    const d = drawer();
    if (!d) return null;
    if (!warnedNoScroll
        && d.scrollHeight <= d.clientHeight + 1
        && comments().length > 3) {
      warnedNoScroll = true;
      console.log(TAG, 'drawer is no longer the scrolling element;'
        + ' jumps will not move it');
    }
    return d;
  }

  // Height of the sticky filter bar, read fresh each keypress: it
  // varies with what else has pinned. An implausible measurement means
  // the walk found the wrong element, so reserve nothing.
  const MAX_HEADER_PX = 200;
  let warnedTallHeader = false;
  function headerOffset() {
    const d = drawer();
    const group = d?.querySelector('[aria-label="Comment filters"]');
    for (let cur = group; cur && cur !== d; cur = cur.parentElement) {
      const pos = getComputedStyle(cur).position;
      if (pos !== 'sticky' && pos !== 'fixed') continue;
      const h = cur.offsetHeight;
      if (h <= MAX_HEADER_PX) return h;
      if (!warnedTallHeader) {
        warnedTallHeader = true;
        console.log(TAG, `sticky header measured ${h}px, which is too tall`
          + ' to be the filter bar; reserving no offset');
      }
      return 0;
    }
    return 0;
  }

  CommentNav.create({
    tag: TAG,

    // Everything but `c` waits for the drawer.
    enabled: () => !!drawer(),

    comments,

    body: bodyOf,

    id: c => c.getAttribute('data-comment-id'),

    // The parent is the last card before the enclosing thread wrapper.
    // Derived in one left-to-right pass, keeping a stack of the
    // wrappers currently open (innermost last) paired with their owner;
    // a backward scan per comment would be O(n) inside the library's
    // O(n) sibling scan.
    parentOf: CommentNav.parentMapper(all => {
      const map = new Map();
      const stack = [];
      all.forEach((c, i) => {
        // Leave any wrappers this card sits outside of.
        while (stack.length && !stack[stack.length - 1].wrap.contains(c)) {
          stack.pop();
        }
        const wrap = c.parentElement && c.parentElement.closest(THREAD_SEL);
        if (!wrap) {                   // top-level comment
          map.set(c, null);
          return;
        }
        // First card seen inside this wrapper, so the card just before
        // it is outside the wrapper and is the one being replied to.
        if (!stack.length || stack[stack.length - 1].wrap !== wrap) {
          stack.push({ wrap, parent: all[i - 1] || null });
        }
        map.set(c, stack[stack.length - 1].parent);
      });
      return map;
    }),

    // scrollIntoView and scrollTo both no-op on the drawer in Chrome;
    // 'raf' writes scrollTop directly, which is all that moves it.
    container: scrollContainer,
    strategy: 'raf',

    headerOffset,

    // The "N comments" header, which scrolls with the content.
    commentsTop: () => {
      const d = drawer();
      if (!d) return null;
      return d.querySelector('header')
        || d.querySelector('section[aria-label="Comment list"]');
    },

    open: {
      canOpen: () => !!document.querySelector('[data-qa="comments-btn"]'),
      click: () => {
        const btn = document.querySelector('[data-qa="comments-btn"]');
        // Clicking focuses the button, and the browser scrolls it into
        // view, yanking the article. Pin the page scroll for a few
        // frames to absorb that and the drawer's layout shift.
        const scroller = document.scrollingElement || document.documentElement;
        const savedTop = scroller.scrollTop;
        const restore = () => {
          if (scroller.scrollTop !== savedTop) scroller.scrollTop = savedTop;
        };
        btn.click();
        restore();
        for (const ms of [0, 16, 50, 100, 200]) setTimeout(restore, ms);
      },
    },
  });
})();
