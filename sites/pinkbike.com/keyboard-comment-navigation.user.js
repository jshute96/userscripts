// ==UserScript==
// @name         Pinkbike: Keyboard comment navigation
// @namespace    https://github.com/jshute96/userscripts
// @version      1.1.0
// @description  Keyboard shortcuts for navigating comments on Pinkbike articles.
// @author       Jeff Shute <jshute@gmail.com>
// @match        https://www.pinkbike.com/news/*
// @grant        none
// @run-at       document-idle
// @noframes
// @updateURL    https://github.com/jshute96/userscripts/raw/refs/heads/main/sites/pinkbike.com/keyboard-comment-navigation.user.js
// @downloadURL  https://github.com/jshute96/userscripts/raw/refs/heads/main/sites/pinkbike.com/keyboard-comment-navigation.user.js
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

  function commentRows() {
    // Filter out comments inside a display:none ancestor (collapsed
    // threads, hidden tabs). Their zero-area rects can make j look
    // stuck — see add-comment-navigation-script skill.
    return [...document.querySelectorAll('.cmcont')]
      .filter(el => el.offsetParent !== null);
  }

  function isReply(el) {
    return el.classList.contains('commentreply2');
  }

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  // Remember the last comment we scrolled to so chained smooth-scrolls
  // advance instead of re-targeting the same comment. Invalidated by
  // wheel/touchmove (user-driven scroll) and any non-nav keypress.
  let lastJumpTarget = null;

  function invalidateJumpTarget() {
    lastJumpTarget = null;
  }
  window.addEventListener('wheel',     invalidateJumpTarget, { passive: true });
  window.addEventListener('touchmove', invalidateJumpTarget, { passive: true });

  function findCurrentRow() {
    const rows = commentRows();
    if (lastJumpTarget && rows.includes(lastJumpTarget)) return lastJumpTarget;
    // First .cmcont whose .comtext body is at least partly in view.
    // We use the inner .comtext rather than the .cmcont container because
    // a .cmcont includes the avatar column and reply-box footer, which can
    // remain barely-intersected with the viewport long after we've
    // visually scrolled into the next comment.
    const vh = window.innerHeight;
    for (const el of rows) {
      const body = el.querySelector('.comtext') || el;
      const rect = body.getBoundingClientRect();
      if (rect.bottom > 0 && rect.top < vh) return el;
    }
    return null;
  }

  function smoothScrollTo(el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    lastJumpTarget = el;
  }

  function jumpNextPrev(direction) {
    const rows = commentRows();
    if (!rows.length) {
      console.log(TAG, 'no comments on page');
      return;
    }
    const current = findCurrentRow();
    const idx = current ? rows.indexOf(current) : -1;
    const target = direction === 'next'
      ? (idx >= 0 ? rows[idx + 1] : rows[0])
      : (idx > 0 ? rows[idx - 1] : null);
    if (!target) {
      console.log(TAG, `no ${direction} comment from id=${current?.id || '?'}`);
      return;
    }
    console.log(TAG, `${direction} -> ${target.id}`);
    smoothScrollTo(target);
  }

  function jumpParent() {
    const current = findCurrentRow();
    if (!current) {
      console.log(TAG, 'p pressed but no comment on screen');
      return;
    }
    if (!isReply(current)) {
      console.log(TAG, `p ignored: ${current.id} is already a root`);
      return;
    }
    const thread = current.closest('.ppcont');
    const root = thread?.querySelector('.cmcont:not(.commentreply2)');
    if (!root) {
      console.log(TAG, `p failed: no root found for ${current.id}`);
      return;
    }
    console.log(TAG, `parent ${current.id} -> ${root.id}`);
    smoothScrollTo(root);
  }

  function jumpNextRoot() {
    const current = findCurrentRow();
    if (!current) {
      // No current comment — go to the first one.
      const first = document.querySelector('.ppcont .cmcont:not(.commentreply2)');
      if (first) {
        console.log(TAG, `n (no current) -> first root ${first.id}`);
        smoothScrollTo(first);
      }
      return;
    }
    const thread = current.closest('.ppcont');
    let next = thread?.nextElementSibling;
    while (next && !next.classList.contains('ppcont')) next = next.nextElementSibling;
    const root = next?.querySelector('.cmcont:not(.commentreply2)');
    if (!root) {
      console.log(TAG, `n: no next thread after ${current.id}`);
      return;
    }
    console.log(TAG, `next-root ${current.id} -> ${root.id}`);
    smoothScrollTo(root);
  }

  function jumpToCommentsTop() {
    // Prefer the actual comments-UI wrapper. Pinkbike's #commenttop span
    // sits earlier in the page than the comments container — related
    // articles and ad/deals widgets get injected between the two, so
    // anchoring to commenttop leaves that filler at the top of the
    // viewport instead of the "N Comments" header.
    const target = document.querySelector('.news-comments-container')
      || document.querySelector('.news-comments')
      || document.getElementById('commenttop');
    if (!target) {
      console.log(TAG, 'c: no comments container found');
      return;
    }
    console.log(TAG, `c -> ${target.className || '#' + target.id}`);
    // Don't store comments-top in lastJumpTarget — it isn't a .cmcont
    // and we want subsequent j/k to resume from the viewport.
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
