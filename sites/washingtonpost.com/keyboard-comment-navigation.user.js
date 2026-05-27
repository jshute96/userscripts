// ==UserScript==
// @name         Washington Post: Keyboard comment navigation
// @namespace    https://github.com/jshute96/userscripts
// @version      1.0.4
// @description  Keyboard shortcuts (j/k/c) for navigating the Coral comments drawer on WaPo articles.
// @author       Jeff Shute <jshute@gmail.com>
// @match        https://www.washingtonpost.com/*
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

  // Comments live inside an open shadow DOM hosted by #coral-shadow-root.
  // The host only exists while the comments drawer is open, so its presence
  // also serves as the "drawer is open" gate.
  function shadowRoot() {
    return document.getElementById('coral-shadow-root')?.shadowRoot || null;
  }

  // Real comment containers are tagged data-testid="comment-<uuid>".
  // Other elements share the "comment-" prefix (sentiment buttons,
  // comment-reply-button, etc.) so we filter to UUID-shaped ids.
  function commentBodies(sr) {
    const out = [];
    for (const c of sr.querySelectorAll('[data-testid^="comment-"]')) {
      if (!/^comment-[0-9a-f]{8}-/.test(c.getAttribute('data-testid'))) continue;
      // Coral keeps collapsed replies in a `ReplyListCommentContainer-
      // hiddenReplies` wrapper with `display: none`; those comments
      // still match the testid query but have no layout. Walking onto
      // them makes `j` look stuck (the scroll target is geometrically
      // invalid, so the scroll position doesn't change and the next
      // press picks them up again). `offsetParent === null` catches
      // any `display: none` ancestor without us having to know which
      // wrapper Coral happens to use this week.
      if (c.offsetParent === null) continue;
      // The actual comment text wrapper. Coral hashes the rest of the
      // class name on every build, so prefix match is mandatory.
      const body = c.querySelector('[class*="HTMLContent-root"]');
      if (body) out.push({ comment: c, body });
    }
    return out;
  }

  function isTypingElement(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  // Keydown events from inside the shadow DOM retarget to the host on the
  // document listener, so e.target alone can't tell us whether the user is
  // typing in the reply box. composedPath() crosses the shadow boundary.
  function pathHasTypingElement(e) {
    const path = e.composedPath ? e.composedPath() : [e.target];
    return path.some(isTypingElement);
  }

  // The Coral drawer (#coralDrawerWrapper) is the scrollable ancestor of
  // every comment. `scrollIntoView({behavior:"smooth"})` and
  // `drawer.scrollTo({behavior:"smooth"})` both silently no-op on this
  // container in Chrome (almost certainly the "scrollbar-gutter:stable on
  // a fixed-positioned overflow:auto container" combination). Direct
  // assignment to `scrollTop` is the only thing that actually moves it,
  // so we hand-roll a cosine-eased animation on top of that.
  function findScrollContainer(el) {
    // Walk composed ancestors (crosses shadow boundaries) until we hit
    // an element that actually scrolls.
    let cur = el;
    while (cur) {
      const parent = cur.parentNode;
      const host = parent instanceof ShadowRoot ? parent.host : parent;
      if (!host) break;
      const cs = getComputedStyle(host);
      const oy = cs.overflowY;
      if ((oy === 'auto' || oy === 'scroll')
        && host.scrollHeight > host.clientHeight + 1) {
        return host;
      }
      cur = host;
    }
    return document.scrollingElement || document.documentElement;
  }

  // Coral renders a sticky tab bar (Featured / Top / All / Newest first)
  // that pins itself to the top of the drawer once scrolled past, occupying
  // ~56px. Without compensating, j-jumps land comments under it and the
  // first line is hidden. We resolve the height dynamically — the class
  // name is `StickyNav-root-<hash>` (CSS-modules), and the hash rotates.
  function stickyHeaderHeight(sr) {
    const sticky = sr.querySelector('[class*="StickyNav-root"]');
    if (!sticky) return 0;
    const cs = getComputedStyle(sticky);
    if (cs.position !== 'sticky' && cs.position !== 'fixed') return 0;
    return sticky.offsetHeight;
  }

  function smoothScrollTo(el, headerOffset = 0) {
    const container = findScrollContainer(el);
    const targetTop = el.getBoundingClientRect().top
      - container.getBoundingClientRect().top
      + container.scrollTop
      - headerOffset;
    const start = container.scrollTop;
    const delta = targetTop - start;
    if (Math.abs(delta) < 1) return;
    const dur = Math.min(350, 120 + Math.abs(delta) * 0.4);
    const t0 = performance.now();
    function step(t) {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 0.5 - 0.5 * Math.cos(Math.PI * p);
      container.scrollTop = start + delta * eased;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function findCurrentIndex(bodies, headerOffset) {
    // First comment whose body is meaningfully below the sticky header.
    // Without the +30 slack, a comment that's just been scrolled past
    // would still count as "current" — its bottom sits a few pixels
    // under the sticky tab bar and the naive `bottom > 0` check picks
    // it up, so j gets stuck on it.
    const topGate = headerOffset + 30;
    const vh = window.innerHeight;
    for (let i = 0; i < bodies.length; i++) {
      const r = bodies[i].body.getBoundingClientRect();
      if (r.bottom > topGate && r.top < vh) return i;
    }
    return -1;
  }

  function jumpNextPrev(direction) {
    const sr = shadowRoot();
    if (!sr) return; // drawer closed
    const bodies = commentBodies(sr);
    if (!bodies.length) {
      console.log(TAG, 'no comments found in drawer');
      return;
    }
    const headerOffset = stickyHeaderHeight(sr);
    const idx = findCurrentIndex(bodies, headerOffset);
    const targetIdx = direction === 'next'
      ? (idx >= 0 ? idx + 1 : 0)
      : (idx > 0 ? idx - 1 : -1);
    const target = bodies[targetIdx];
    if (!target) {
      console.log(TAG, `no ${direction} comment from idx=${idx}`);
      return;
    }
    const id = target.comment.getAttribute('data-testid');
    console.log(TAG, `${direction} -> ${id}`);
    // Scroll the whole comment container into view, not just its body
    // text — there's a ~42px header (avatar / username / time row)
    // above the body that we'd otherwise hide behind the sticky tab
    // bar. Viewport-intersection detection still uses the body to
    // avoid getting stuck on the taller container.
    smoothScrollTo(target.comment, headerOffset);
  }

  // Returns true iff `c` actually performed an action; the caller
  // uses that to decide whether to preventDefault the keypress.
  function jumpToCommentsTop() {
    const sr = shadowRoot();
    if (!sr) return false;
    // Prefer the "N comments" header banner; fall back to the comments
    // tab pane if Coral renames it.
    const target = sr.querySelector('.comment-prompt')
      || sr.querySelector('#tabPane-COMMENTS');
    if (!target) {
      console.log(TAG, 'c: no comments-top anchor found');
      return false;
    }
    console.log(TAG, `c -> ${target.className || '#' + target.id}`);
    smoothScrollTo(target);
    return true;
  }

  function openCommentsDrawer() {
    const btn = document.querySelector('[data-qa="comments-btn"]');
    if (!btn) {
      console.log(TAG, 'c: comments button not found, cannot open drawer');
      return false;
    }
    // Clicking the button focuses it, which triggers the browser's
    // default scroll-into-view for the focused element and yanks the
    // article up/down. Pin the page scroll for a few frames to absorb
    // both the focus-induced jump and any layout shift from mounting
    // the drawer's portal.
    const scroller = document.scrollingElement || document.documentElement;
    const savedTop = scroller.scrollTop;
    const restore = () => { if (scroller.scrollTop !== savedTop) scroller.scrollTop = savedTop; };
    console.log(TAG, 'c: opening comments drawer');
    btn.click();
    // Run a handful of restore ticks across the next ~250ms — the
    // drawer mounts asynchronously and React may scroll several times
    // before settling.
    restore();
    for (const ms of [0, 16, 50, 100, 200]) setTimeout(restore, ms);
    return true;
  }

  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (pathHasTypingElement(e)) return;

    // 'c' is the one key that works both before and after the drawer
    // is open: open it if it's closed, otherwise scroll to the top of
    // the comments list. Only consume the keypress if we actually
    // did something — on a page with no comments button at all,
    // let the keystroke pass through.
    if (e.key === 'c') {
      const handled = shadowRoot() ? jumpToCommentsTop() : openCommentsDrawer();
      if (handled) e.preventDefault();
      return;
    }
    // j / k only make sense once comments are visible.
    if (!shadowRoot()) return;
    switch (e.key) {
      case 'j': e.preventDefault(); jumpNextPrev('next'); return;
      case 'k': e.preventDefault(); jumpNextPrev('prev'); return;
    }
  }

  document.addEventListener('keydown', onKeyDown);
  console.log(TAG, 'keys: c=open-drawer-or-comments-top, j=next, k=prev (j/k only when drawer open)');
})();
