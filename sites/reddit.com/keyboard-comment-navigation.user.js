// ==UserScript==
// @name         Reddit: Keyboard comment navigation
// @namespace    https://github.com/jshute96/userscripts
// @version      1.0.5
// @description  Adds keyboard shortcuts for moving through a comment thread by comment, sibling, parent or root, replacing reddit's j/k with navigation that follows the tree.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://www.reddit.com/*
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

  // Reddit's top banner is sticky. It already sets scroll-margin-top on
  // depth-0 comments via inline style, but nested replies, the sort
  // dropdown, and the tree-stats element don't get it — so scrolling to
  // them with block:'start' tucks their first lines behind the banner.
  // Apply the same offset to every element we ever scroll to.
  function injectScrollMargin() {
    if (document.getElementById('reddit-nav-scroll-margin')) return;
    const style = document.createElement('style');
    style.id = 'reddit-nav-scroll-margin';
    style.textContent = `
      shreddit-comment,
      shreddit-comments-sort-dropdown,
      shreddit-comment-tree-stats,
      shreddit-comment-tree {
        scroll-margin-top: calc(var(--shreddit-header-height, 56px) + 8px);
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }
  injectScrollMargin();

  function isCommentsPage() {
    return /\/comments\//.test(location.pathname);
  }

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function allComments() {
    return [...document.querySelectorAll('shreddit-comment')];
  }

  function thingId(c) {
    return c.getAttribute('thingid') || '?';
  }

  function commentBody(c) {
    // Reddit assigns each comment body div an id `${thingid}-comment-rtjson-content`.
    // Use that for viewport intersection — the shreddit-comment box itself
    // wraps the entire subtree (body + nested children + reply box) and
    // stays intersecting long after the text has scrolled past.
    const id = `${thingId(c)}-comment-rtjson-content`;
    return document.getElementById(id) || c;
  }

  function headerOffset() {
    // Read reddit's own --shreddit-header-height; fall back to 56px.
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue('--shreddit-header-height').trim();
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : 56;
  }

  // Minimum body height that must be visible below the sticky banner for
  // a comment to count as "current". A bare `rect.bottom > headerOffset`
  // check is fooled by a sliver of the previous comment still bleeding
  // behind the banner, which makes `j` re-pick it and stall.
  const MIN_VISIBLE_PX = 30;

  function findCurrentComment() {
    const vh = window.innerHeight;
    const top = headerOffset();
    for (const c of allComments()) {
      const body = commentBody(c);
      const rect = body.getBoundingClientRect();
      if (rect.bottom - top >= MIN_VISIBLE_PX && rect.top < vh) return c;
    }
    return null;
  }

  function smoothScrollTo(el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function parentComment(c) {
    // Nested shreddit-comments live in their parent's light DOM (slotted
    // into shadow DOM for rendering), so the light-DOM parent chain
    // reflects the comment tree.
    return c.parentElement?.closest('shreddit-comment') || null;
  }

  function commentTree() {
    return document.querySelector('shreddit-comment-tree');
  }

  function directChildComments(parentEl) {
    return [...parentEl.querySelectorAll(':scope > shreddit-comment')];
  }

  function rootComments() {
    const tree = commentTree();
    return tree ? directChildComments(tree) : [];
  }

  function siblingsOf(c) {
    const parent = parentComment(c) || commentTree();
    return parent ? directChildComments(parent) : [];
  }

  function rootOf(c) {
    let r = c;
    while (parentComment(r)) r = parentComment(r);
    return r;
  }

  function jumpNextPrev(direction) {
    const all = allComments();
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
      console.log(TAG, `no ${direction} comment from ${current ? thingId(current) : '?'}`);
      return;
    }
    console.log(TAG, `${direction} -> ${thingId(target)}`);
    smoothScrollTo(target);
  }

  function jumpSibling(direction) {
    const current = findCurrentComment();
    if (!current) { console.log(TAG, `${direction}-sibling: no comment on screen`); return; }
    const sibs = siblingsOf(current);
    const idx = sibs.indexOf(current);
    const target = direction === 'next' ? sibs[idx + 1] : sibs[idx - 1];
    if (!target) {
      console.log(TAG, `no ${direction}-sibling for ${thingId(current)}`);
      return;
    }
    console.log(TAG, `${direction}-sibling ${thingId(current)} -> ${thingId(target)}`);
    smoothScrollTo(target);
  }

  function jumpParent() {
    const current = findCurrentComment();
    if (!current) { console.log(TAG, 'p: no comment on screen'); return; }
    const parent = parentComment(current);
    if (!parent) {
      console.log(TAG, `p: ${thingId(current)} is already a root`);
      return;
    }
    console.log(TAG, `parent ${thingId(current)} -> ${thingId(parent)}`);
    smoothScrollTo(parent);
  }

  function jumpParentNext() {
    const current = findCurrentComment();
    if (!current) { console.log(TAG, 'n: no comment on screen'); return; }
    // Walk past the current subtree: if there's a parent, go to the
    // parent's next sibling; on a root, fall back to the next root.
    const parent = parentComment(current);
    const reference = parent || current;
    const sibs = siblingsOf(reference);
    const idx = sibs.indexOf(reference);
    const target = sibs[idx + 1];
    if (!target) {
      console.log(TAG, `n: no sibling after ${thingId(reference)}`);
      return;
    }
    console.log(TAG, `parent-next ${thingId(current)} -> ${thingId(target)}`);
    smoothScrollTo(target);
  }

  function jumpRoot() {
    const current = findCurrentComment();
    if (!current) { console.log(TAG, 'r: no comment on screen'); return; }
    if (!parentComment(current)) {
      console.log(TAG, `r: ${thingId(current)} already at root`);
      return;
    }
    const root = rootOf(current);
    console.log(TAG, `root ${thingId(current)} -> ${thingId(root)}`);
    smoothScrollTo(root);
  }

  function jumpNextRoot() {
    const roots = rootComments();
    if (!roots.length) { console.log(TAG, 'm: no roots'); return; }
    const current = findCurrentComment();
    if (!current) {
      console.log(TAG, `m (no current) -> first root ${thingId(roots[0])}`);
      smoothScrollTo(roots[0]);
      return;
    }
    const root = rootOf(current);
    const idx = roots.indexOf(root);
    const target = roots[idx + 1];
    if (!target) {
      console.log(TAG, `m: no next root after ${thingId(root)}`);
      return;
    }
    console.log(TAG, `next-root ${thingId(current)} -> ${thingId(target)}`);
    smoothScrollTo(target);
  }

  function jumpCommentsTop() {
    const target = document.querySelector('shreddit-comments-sort-dropdown')
      || document.querySelector('shreddit-comment-tree-stats')
      || commentTree();
    if (!target) { console.log(TAG, 'c: no comments header found'); return; }
    console.log(TAG, `c -> ${target.tagName.toLowerCase()}`);
    smoothScrollTo(target);
  }

  const KEYS = {
    'j': () => jumpNextPrev('next'),
    'k': () => jumpNextPrev('prev'),
    'h': () => jumpSibling('next'),
    'l': () => jumpSibling('prev'),
    'p': jumpParent,
    'n': jumpParentNext,
    'r': jumpRoot,
    'm': jumpNextRoot,
    'c': jumpCommentsTop,
  };

  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingTarget(e.target)) return;
    if (!isCommentsPage()) return;
    const handler = KEYS[e.key];
    if (!handler) return;
    // Capture-phase preventDefault + stopImmediatePropagation so reddit's
    // built-in j/k handler (and any other site listeners) never see the
    // event.
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    handler();
  }

  document.addEventListener('keydown', onKeyDown, true);
  console.log(TAG, 'keys: j=down, k=up, h=next-sibling, l=prev-sibling, p=parent, n=parent-next, r=root, m=next-root, c=comments-top');
})();
