// ==UserScript==
// @name         NYT: Keyboard comment navigation
// @namespace    https://github.com/jshute96/userscripts
// @version      1.0.1
// @description  Keyboard shortcuts for navigating the comments panel on nytimes.com articles.
// @author       Jeff Shute <jshute@gmail.com>
// @match        https://www.nytimes.com/*
// @exclude      https://www.nytimes.com/athletic/*
// @grant        none
// @run-at       document-idle
// @noframes
// @updateURL    https://github.com/jshute96/userscripts/raw/refs/heads/main/sites/nytimes.com/keyboard-comment-navigation.user.js
// @downloadURL  https://github.com/jshute96/userscripts/raw/refs/heads/main/sites/nytimes.com/keyboard-comment-navigation.user.js
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[nyt cnav]';

  if (window.__nytCNavLoaded) {
    console.log(TAG, 'already loaded; skipping duplicate run');
    return;
  }
  window.__nytCNavLoaded = true;

  console.log(TAG, 'initializing');

  const PANEL_SEL = '[data-testid="comments-panel"]';
  const TOP_SEL = '[data-testid="comment-container"]';
  const REPLY_SEL = '[data-testid="reply-comment-container"]';
  const BOTH_SEL = `${TOP_SEL}, ${REPLY_SEL}`;

  function panel() {
    return document.querySelector(PANEL_SEL);
  }

  // The comments panel is a fixed side drawer with its own
  // scroll container (overflow-y: scroll on .css-1h21wu5). When
  // collapsed it's still in the DOM but has zero width.
  function panelOpen() {
    const p = panel();
    if (!p) return false;
    const r = p.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function commentRows() {
    const p = panel();
    if (!p) return [];
    return [...p.querySelectorAll(BOTH_SEL)];
  }

  function isReply(el) {
    return el.matches(REPLY_SEL);
  }

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  // The body element we use for the viewport test. Each comment
  // container has a <p id="comment-content-N"> with the actual
  // text; using it (rather than the outer container) avoids the
  // header/avatar/footer keeping a comment "current" long after
  // its body has scrolled out of view.
  function commentBody(el) {
    return el.querySelector('p[id^="comment-content-"]') || el;
  }

  // The panel has its own scroll container (overflow-y: scroll
  // on a descendant div). We can't anchor to the class because
  // it's a hashed CSS-module name; locate it by computed style.
  function findScroller(node, depth) {
    if (!node || depth > 8) return null;
    const cs = getComputedStyle(node);
    if (cs.overflowY === 'auto' || cs.overflowY === 'scroll') return node;
    for (const c of node.children) {
      const r = findScroller(c, depth + 1);
      if (r) return r;
    }
    return null;
  }

  function scroller() {
    const p = panel();
    return p ? findScroller(p, 0) : null;
  }

  // The panel has a position:sticky header (close button +
  // search + tabs, ~73px) that overlays the top of the scroll
  // viewport. `scrollIntoView({block:'start'})` aligns to the
  // panel top, leaving the first ~73px of the target hidden
  // behind the header — visible as the comment's first line
  // getting cut off. Compute the header height dynamically (the
  // exact element/class is hashed) and offset every scroll and
  // current-row test by it.
  //
  // `headerOffset()` is called multiple times per keypress
  // (findCurrentRow + smoothScrollTo) and walks every node in the
  // panel, which is slow on long threads. Memoize for the
  // duration of one keypress and clear at the top of onKeyDown.
  let headerOffsetCache = null;
  function headerOffset() {
    if (headerOffsetCache !== null) return headerOffsetCache;
    const p = panel();
    if (!p) return (headerOffsetCache = 0);
    const pr = p.getBoundingClientRect();
    let bottom = pr.top;
    for (const el of p.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'sticky') continue;
      const r = el.getBoundingClientRect();
      if (r.top <= pr.top + 5 && r.bottom > pr.top && r.width > 10) {
        if (r.bottom > bottom) bottom = r.bottom;
      }
    }
    return (headerOffsetCache = bottom - pr.top);
  }

  // Minimum body pixels that must remain visible *below the
  // sticky header* for a comment to be considered "current".
  // Plain intersect is too lax: when a reply is scrolled into
  // view, its parent's body is still slightly visible above
  // (the parent container wraps the reply list), so any
  // visible-pixel test latches onto the parent and `p` thinks
  // the reply is already a root.
  const CURRENT_MIN_VISIBLE = 30;

  function findCurrentRow() {
    const p = panel();
    if (!p) return null;
    // Test against the panel's rect (it's a fixed-position
    // right-side drawer), not the window, and shift down by
    // the sticky header so a comment hidden under the header
    // doesn't count as visible.
    const pr = p.getBoundingClientRect();
    const top = pr.top + headerOffset();
    for (const el of commentRows()) {
      const body = commentBody(el);
      const rect = body.getBoundingClientRect();
      if (rect.bottom > top + CURRENT_MIN_VISIBLE && rect.top < pr.bottom) return el;
    }
    return null;
  }

  function smoothScrollTo(el) {
    const sc = scroller();
    const p = panel();
    if (!sc || !p) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    // Manual scroll so we can offset by the sticky header
    // height. scrollIntoView has no offset option, and
    // scroll-margin-top would need to be set per-element.
    const elRect = el.getBoundingClientRect();
    const scRect = sc.getBoundingClientRect();
    const target = sc.scrollTop + (elRect.top - scRect.top) - headerOffset();
    sc.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
  }

  function jumpNextPrev(direction) {
    const rows = commentRows();
    if (!rows.length) {
      console.log(TAG, 'no comments in panel');
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
    // A reply lives inside its parent's <div data-testid="reply-list-threading">,
    // which itself sits inside the parent comment-container.
    const root = current.closest(TOP_SEL);
    if (!root) {
      console.log(TAG, `p failed: no root found for ${current.id}`);
      return;
    }
    console.log(TAG, `parent ${current.id} -> ${root.id}`);
    smoothScrollTo(root);
  }

  function topLevelRows() {
    const p = panel();
    if (!p) return [];
    return [...p.querySelectorAll(TOP_SEL)];
  }

  function jumpNextRoot() {
    const current = findCurrentRow();
    if (!current) {
      const first = topLevelRows()[0];
      if (first) {
        console.log(TAG, `n (no current) -> first root ${first.id}`);
        smoothScrollTo(first);
      }
      return;
    }
    const currentRoot = isReply(current) ? current.closest(TOP_SEL) : current;
    const roots = topLevelRows();
    const idx = roots.indexOf(currentRoot);
    const next = idx >= 0 ? roots[idx + 1] : null;
    if (!next) {
      console.log(TAG, `n: no next root after ${current.id}`);
      return;
    }
    console.log(TAG, `next-root ${current.id} -> ${next.id}`);
    smoothScrollTo(next);
  }

  function openPanel() {
    // The article has several copies of the "Read N comments"
    // button (in-story masthead, sticky header, footer). Any
    // of them toggles the same panel; the header one is
    // always present on an article with comments.
    const btn = document.querySelector('#comment-button-header')
      || document.querySelector('[data-testid^="comment-button"][aria-haspopup="dialog"]');
    if (!btn) {
      console.log(TAG, 'c: comments panel button not found');
      return false;
    }
    console.log(TAG, `c -> open panel (${btn.id || btn.dataset.testid})`);
    btn.click();
    return true;
  }

  // Returns true iff `c` actually did something (and therefore we
  // should consume the keypress). On non-article pages with no
  // panel and no open button, returns false so the user's `c`
  // passes through.
  function jumpToCommentsTop() {
    if (!panelOpen()) {
      return openPanel();
    }
    const p = panel();
    // The panel header (<header ...>220 comments on...) sits above
    // the search box and tabs at the top of the scroll area.
    const header = p.querySelector('header')
      || p.querySelector('[data-testid="header-primary-text"]')
      || topLevelRows()[0];
    if (!header) {
      console.log(TAG, 'c: no header or comments found');
      return false;
    }
    console.log(TAG, `c -> ${header.tagName.toLowerCase()}`);
    smoothScrollTo(header);
    return true;
  }

  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingTarget(e.target)) return;
    headerOffsetCache = null;

    // `c` works whether or not the panel is open: it opens the
    // panel if closed, scrolls to its top if already open.
    // The other keys only act when the panel is open.
    if (e.key === 'c') {
      if (jumpToCommentsTop()) e.preventDefault();
      return;
    }
    if (!panelOpen()) return;

    switch (e.key) {
      case 'j': e.preventDefault(); jumpNextPrev('next'); return;
      case 'k': e.preventDefault(); jumpNextPrev('prev'); return;
      case 'p': e.preventDefault(); jumpParent(); return;
      case 'n': e.preventDefault(); jumpNextRoot(); return;
    }
  }

  document.addEventListener('keydown', onKeyDown);
  console.log(TAG, 'keys: j=next, k=prev, p=parent, n=next-root, c=comments-top');
})();
