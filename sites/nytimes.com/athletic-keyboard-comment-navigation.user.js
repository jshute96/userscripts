// ==UserScript==
// @name         The Athletic: Keyboard comment navigation
// @namespace    https://github.com/jshute96/userscripts
// @version      1.0.4
// @description  Keyboard shortcuts for navigating comments on The Athletic articles.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://www.nytimes.com/athletic/*
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

  // The Athletic uses CSS-modules with hashed class suffixes that rotate on
  // every deploy. Match by prefix using attribute-substring selectors.
  const SEL = {
    comment:       '[class*="Comment_Base"]',
    reply:         '[class*="Comment_Reply"]',
    bodyContainer: '[class*="Comment_BodyContainer"]',
    // The "COMMENTS <count>" banner row, ordered most-specific first.
    // #comments-section sits above the banner with a sponsored puzzle
    // tile in between, which is not where the user wants `c` to land.
    sectionTop:  ['[class*="Comments_CommentBanner"]', '#comments-section'],
    // Pill button in the article toolbar that opens / scrolls to
    // comments. The Athletic doesn't render the comments markup until
    // it scrolls near the viewport, so when the section anchors above
    // aren't found we click this to make the site load and scroll
    // there itself.
    openButton:  'button[aria-label="Open Comments"]',
  };

  function comments() {
    return [...document.querySelectorAll(SEL.comment)];
  }

  function isReply(el) {
    return el.matches(SEL.reply);
  }

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function stickyTopOffset() {
    // NYT sets scroll-padding-top on <html> to clear the fixed top nav.
    // We use it as a threshold so a comment that's mostly hidden behind
    // the sticky header isn't treated as "current."
    const v = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop);
    return Number.isFinite(v) ? v : 0;
  }

  function bodyIntersectsViewport(el, padTop, vh) {
    const body = el.querySelector(SEL.bodyContainer) || el;
    const rect = body.getBoundingClientRect();
    return rect.bottom > padTop && rect.top < vh;
  }

  // Remember the last comment we scrolled to, so chained keypresses during
  // a smooth scroll advance instead of re-targeting the same comment. The
  // viewport listeners below clear this whenever the user scrolls manually.
  let lastJumpTarget = null;

  function findCurrentComment() {
    const all = comments();
    // Trust the last jump target until the user does something to
    // invalidate it (wheel, touchmove, non-nav keypress). This lets
    // back-to-back j/n presses chain forward even when the smooth
    // scroll hasn't caught up yet or the target is far off-screen.
    if (lastJumpTarget && all.includes(lastJumpTarget)) return lastJumpTarget;
    const vh = window.innerHeight;
    const padTop = stickyTopOffset();
    for (const el of all) {
      if (bodyIntersectsViewport(el, padTop, vh)) return el;
    }
    return null;
  }

  function smoothScrollTo(el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    lastJumpTarget = el;
  }

  function invalidateJumpTarget() {
    lastJumpTarget = null;
  }
  window.addEventListener('wheel',     invalidateJumpTarget, { passive: true });
  window.addEventListener('touchmove', invalidateJumpTarget, { passive: true });

  function labelFor(el, list) {
    const i = list.indexOf(el);
    return i >= 0 ? `#${i + 1}${isReply(el) ? ' (reply)' : ''}` : '?';
  }

  function jumpNextPrev(direction) {
    const all = comments();
    if (!all.length) {
      console.log(TAG, 'no comments on page');
      return;
    }
    const current = findCurrentComment();
    const idx = current ? all.indexOf(current) : -1;
    const target = direction === 'next'
      ? (idx >= 0 ? all[idx + 1] : all[0])
      : (idx > 0 ? all[idx - 1] : null);
    if (!target) {
      console.log(TAG, `no ${direction} comment from ${current ? labelFor(current, all) : 'top'}`);
      return;
    }
    console.log(TAG, `${direction} -> ${labelFor(target, all)}`);
    smoothScrollTo(target);
  }

  function jumpParent() {
    const all = comments();
    const current = findCurrentComment();
    if (!current) {
      console.log(TAG, 'p pressed but no comment on screen');
      return;
    }
    if (!isReply(current)) {
      console.log(TAG, `p ignored: ${labelFor(current, all)} is already a root`);
      return;
    }
    // Threads are flat: roots and replies are siblings in document order.
    // Walk backwards through the flat comment list to find the most recent
    // non-reply, which is this reply's thread root.
    const idx = all.indexOf(current);
    for (let i = idx - 1; i >= 0; i--) {
      if (!isReply(all[i])) {
        console.log(TAG, `parent ${labelFor(current, all)} -> ${labelFor(all[i], all)}`);
        smoothScrollTo(all[i]);
        return;
      }
    }
    console.log(TAG, `p failed: no root found before ${labelFor(current, all)}`);
  }

  function jumpNextRoot() {
    const all = comments();
    const current = findCurrentComment();
    if (!current) {
      const first = all.find(el => !isReply(el));
      if (first) {
        console.log(TAG, `n (no current) -> first root ${labelFor(first, all)}`);
        smoothScrollTo(first);
      } else {
        console.log(TAG, 'n: no comments on page');
      }
      return;
    }
    const idx = all.indexOf(current);
    for (let i = idx + 1; i < all.length; i++) {
      if (!isReply(all[i])) {
        console.log(TAG, `next-root ${labelFor(current, all)} -> ${labelFor(all[i], all)}`);
        smoothScrollTo(all[i]);
        return;
      }
    }
    console.log(TAG, `n: no next thread after ${labelFor(current, all)}`);
  }

  function jumpToCommentsTop() {
    for (const sel of SEL.sectionTop) {
      const target = document.querySelector(sel);
      if (target) {
        console.log(TAG, `c -> ${sel}`);
        smoothScrollTo(target);
        return;
      }
    }
    const openBtn = document.querySelector(SEL.openButton);
    if (openBtn) {
      console.log(TAG, `c -> click ${SEL.openButton} (comments not loaded yet)`);
      openBtn.click();
      return;
    }
    console.log(TAG, `c: no comments anchor or open button found`);
  }

  const NAV_KEYS = new Set(['j', 'k', 'p', 'n', 'c']);

  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingTarget(e.target)) return;
    if (!NAV_KEYS.has(e.key)) {
      // Manual scroll keys (PageUp/Down, arrows, space, Home/End)
      // mean the user is moving the viewport themselves; the jump
      // target is no longer authoritative.
      invalidateJumpTarget();
      return;
    }

    switch (e.key) {
      case 'j': e.preventDefault(); jumpNextPrev('next'); return;
      case 'k': e.preventDefault(); jumpNextPrev('prev'); return;
      case 'p': e.preventDefault(); jumpParent(); return;
      case 'n': e.preventDefault(); jumpNextRoot(); return;
      case 'c': e.preventDefault(); jumpToCommentsTop(); return;
    }
  }

  document.addEventListener('keydown', onKeyDown);
  console.log(TAG, 'keys: j=next, k=prev, p=parent, n=next-root, c=comments-top');
})();
