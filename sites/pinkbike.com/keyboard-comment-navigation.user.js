// ==UserScript==
// @name         Pinkbike: Keyboard comment navigation
// @namespace    https://github.com/jshute96/userscripts
// @version      1.1.3
// @description  Adds keyboard shortcuts for moving through the comments on an article — next and previous comment, parent, next thread, and jump to the comments section.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://www.pinkbike.com/news/*
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
    abortScrollCorrection();
  }
  window.addEventListener('wheel',     invalidateJumpTarget, { passive: true });
  window.addEventListener('touchmove', invalidateJumpTarget, { passive: true });

  // ---------------------------------------------------------------
  // Drift-correcting smooth scroll
  // ---------------------------------------------------------------
  // `scrollIntoView` computes its destination scroll offset once, when
  // it's called, and animates to that fixed offset. Pinkbike lazy-
  // loads images and injects ad/deals slots throughout the article
  // while you read, so any content that finishes loading *above* the
  // target during the ~1s animation pushes the target further down the
  // document — and we stop short of it. Jumping to the comments from
  // the top of a long article is the worst case: it crosses the whole
  // body of the page, and we've seen it land 100–200px above the
  // comments header, in the related-articles filler.
  //
  // So after the scroll settles, re-measure the target and re-issue
  // the scroll if it moved. A couple of corrections is plenty; the
  // page stops growing quickly once it's near the target.
  const DRIFT_TOLERANCE_PX = 4;
  const MAX_CORRECTIONS = 3;
  const SETTLE_TICKS = 3;      // consecutive equal scrollY samples
  const CORRECTION_TIMEOUT_MS = 4000;
  // Chrome takes a frame or two to start a smooth scroll. Without a
  // grace period the "scrollY hasn't moved" test passes before the
  // animation has begun, and we'd spend corrections re-issuing a
  // scroll that was already on its way.
  const SETTLE_GRACE_MS = 250;

  // The browser can't always put the target at the top: the last
  // comments on a page sit within one viewport height of the document
  // end, so the scroll clamps at the maximum offset and the target
  // stays part-way down. That's the browser doing all it can, not
  // drift — correcting would just re-issue the same clamped scroll
  // three times and then log a failure for a jump that worked fine.
  function scrollIsClamped() {
    const doc = document.documentElement;
    const maxScroll = doc.scrollHeight - window.innerHeight;
    return window.scrollY <= 0 || window.scrollY >= maxScroll - 1;
  }

  let correctionToken = 0;
  function abortScrollCorrection() {
    correctionToken++;
  }

  // Scroll `el` to the top of the viewport, then keep it there while
  // the page settles. Any user-driven scroll cancels the correction.
  function scrollToTopSettled(el) {
    const token = ++correctionToken;
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });

    const started = performance.now();
    const deadline = started + CORRECTION_TIMEOUT_MS;
    let lastY = null;
    let stable = 0;
    let corrections = 0;

    function tick() {
      if (token !== correctionToken) return;  // superseded or aborted
      const y = Math.round(window.scrollY);
      stable = (y === lastY) ? stable + 1 : 0;
      lastY = y;
      if (stable >= SETTLE_TICKS && performance.now() - started > SETTLE_GRACE_MS) {
        const top = Math.round(el.getBoundingClientRect().top);
        if (Math.abs(top) <= DRIFT_TOLERANCE_PX) return;  // landed
        if (scrollIsClamped()) return;                    // as close as it gets
        if (corrections >= MAX_CORRECTIONS) {
          console.log(TAG, `scroll still ${top}px off after`,
            corrections, 'corrections; giving up');
          return;
        }
        corrections++;
        console.log(TAG, `scroll drifted ${top}px, correcting (${corrections})`);
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        stable = 0;
      }
      if (performance.now() < deadline) {
        requestAnimationFrame(tick);
      } else {
        console.log(TAG, 'scroll settle timed out at',
          Math.round(el.getBoundingClientRect().top) + 'px');
      }
    }
    requestAnimationFrame(tick);
  }

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
    scrollToTopSettled(el);
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
    scrollToTopSettled(target);
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
