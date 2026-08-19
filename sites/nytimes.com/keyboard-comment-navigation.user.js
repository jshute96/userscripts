// ==UserScript==
// @name         NYTimes: Keyboard comment navigation
// @namespace    https://github.com/jshute96/userscripts
// @version      1.1.1
// @description  Adds keyboard shortcuts for moving through the comments panel on an article — next and previous comment, parent, next thread, and open or jump to the panel.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://www.nytimes.com/*
// @exclude      https://www.nytimes.com/athletic/*
// @require      https://raw.githubusercontent.com/jshute96/userscripts/main/lib/keyboard-shortcuts.js
// @require      https://raw.githubusercontent.com/jshute96/userscripts/main/lib/keyboard-comment-nav.js
// @grant        none
// @run-at       document-idle
// @noframes
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

  const panel = () => document.querySelector(PANEL_SEL);

  // The panel is a fixed side drawer. When collapsed it's still in the
  // DOM but has zero size, which is our "is it open?" test.
  function panelOpen() {
    const p = panel();
    if (!p) return false;
    const r = p.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // The panel scrolls in its own container (overflow-y: scroll on a
  // descendant div). The class is a hashed CSS-module name, so find it
  // by computed style instead.
  function findScroller(node, depth) {
    if (!node || depth > 8) return null;
    const oy = getComputedStyle(node).overflowY;
    if (oy === 'auto' || oy === 'scroll') return node;
    for (const child of node.children) {
      const found = findScroller(child, depth + 1);
      if (found) return found;
    }
    return null;
  }

  // The panel has a position:sticky header (close button, search box,
  // tab strip — about 73px) overlaying the top of the scroll viewport.
  // Aligning to the panel top would leave the target's first line
  // hidden behind it. The element is another CSS-module hash, so
  // measure whatever is sticky at the top of the panel.
  //
  // This walks every node in the panel, and the library asks for the
  // offset more than once per keypress (current-comment test, then the
  // scroll), which is slow on a long thread. Cache it for a beat —
  // long enough to cover one keypress, short enough that resizing or
  // a collapsing header is picked up immediately.
  const HEADER_CACHE_MS = 100;
  let cached = { at: -Infinity, value: 0 };

  function headerOffset() {
    const now = performance.now();
    if (now - cached.at < HEADER_CACHE_MS) return cached.value;
    const p = panel();
    let value = 0;
    if (p) {
      const pr = p.getBoundingClientRect();
      let bottom = pr.top;
      for (const el of p.querySelectorAll('*')) {
        if (getComputedStyle(el).position !== 'sticky') continue;
        const r = el.getBoundingClientRect();
        if (r.top <= pr.top + 5 && r.bottom > pr.top && r.width > 10
            && r.bottom > bottom) {
          bottom = r.bottom;
        }
      }
      value = bottom - pr.top;
    }
    cached = { at: now, value };
    return value;
  }

  CommentNav.create({
    tag: TAG,

    // @match is the whole site so the script survives SPA navigation
    // onto an article; everything but `c` waits for the panel.
    enabled: panelOpen,

    comments: () => {
      const p = panel();
      return p ? [...p.querySelectorAll(BOTH_SEL)] : [];
    },

    // Each container holds a <p id="comment-content-N"> with the text.
    // Using it rather than the container keeps a comment from staying
    // "current" once only its header/avatar/footer is still on screen.
    body: el => el.querySelector('p[id^="comment-content-"]') || el,

    id: el => el.id,

    // A reply lives inside its parent's reply-list-threading div,
    // which sits inside the parent's container — so the nearest
    // enclosing comment of *either* kind is the immediate parent.
    //
    // Looking for the nearest TOP_SEL instead (which is what this did
    // before) finds the thread root rather than the parent. At two
    // levels those are the same element, so it worked; NYT threads go
    // at least three deep, and there `p` from a third-level reply
    // jumped all the way out to the root, skipping its actual parent.
    parentOf: el => (el.matches(REPLY_SEL)
      ? el.parentElement?.closest(BOTH_SEL) || null
      : null),

    // Comments scroll inside the drawer, not the window, so both the
    // scroll and the current-comment test work against this element.
    container: () => {
      const p = panel();
      return p ? findScroller(p, 0) : null;
    },
    strategy: 'container',
    headerOffset,

    // The <header> holds the "N comments on…" line, above the search
    // box and tabs at the top of the scroll area.
    commentsTop: () => {
      // Must be null while the panel is closed: the panel element is
      // still in the DOM (just zero-sized), and returning an anchor
      // from it would make `c` scroll to a hidden drawer instead of
      // opening it.
      if (!panelOpen()) return null;
      const p = panel();
      return p.querySelector('header')
        || p.querySelector('[data-testid="header-primary-text"]')
        || p.querySelector(TOP_SEL);
    },

    // An article has several copies of the "Read N comments" button
    // (in-story masthead, sticky header, footer); any of them toggles
    // the same panel, and the header one is always present when the
    // article has comments.
    open: {
      canOpen: () => !!openButton(),
      click: () => openButton().click(),
    },
  });

  function openButton() {
    return document.querySelector('#comment-button-header')
      || document.querySelector('[data-testid^="comment-button"][aria-haspopup="dialog"]');
  }
})();
