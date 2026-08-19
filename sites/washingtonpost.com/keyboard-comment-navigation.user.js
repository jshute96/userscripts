// ==UserScript==
// @name         Washington Post: Keyboard comment navigation
// @namespace    https://github.com/jshute96/userscripts
// @version      1.1.0
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

  // Comments live inside an open shadow DOM hosted by
  // #coral-shadow-root. The host only exists while the drawer is open,
  // so its presence doubles as the "drawer is open" gate.
  const shadowRoot = () =>
    document.getElementById('coral-shadow-root')?.shadowRoot || null;

  // Real comment containers are data-testid="comment-<uuid>". Other
  // elements share the "comment-" prefix (sentiment buttons,
  // comment-reply-button…), so filter to UUID-shaped ids.
  const IS_COMMENT = /^comment-[0-9a-f]{8}-/;

  // The reply list wrapping a comment's replies. Matched by *prefix*:
  // the id carries a per-thread suffix, and it is reused across
  // threads rather than being unique, so this can never be a
  // getElementById lookup.
  //
  // Deliberately not falling back to [class*="ReplyList"]: Coral also
  // uses ReplyListCommentContainer on individual replies, and matching
  // that would resolve a reply's parent to its previous sibling.
  const REPLY_LIST_SEL = '[id^="coral-comments-replyList"]';

  function comments() {
    const sr = shadowRoot();
    if (!sr) return [];
    return [...sr.querySelectorAll('[data-testid^="comment-"]')]
      .filter(c => IS_COMMENT.test(c.getAttribute('data-testid')));
  }

  // Coral renders a sticky tab bar (Featured / Top / All / Newest
  // first) that pins to the top of the drawer once scrolled past,
  // about 56px. Its class is `StickyNav-root-<hash>` — CSS-modules, so
  // the hash rotates and only the prefix is safe to match.
  function headerOffset() {
    const sr = shadowRoot();
    const sticky = sr?.querySelector('[class*="StickyNav-root"]');
    if (!sticky) return 0;
    const pos = getComputedStyle(sticky).position;
    if (pos !== 'sticky' && pos !== 'fixed') return 0;
    return sticky.offsetHeight;
  }

  // Walk composed ancestors (crossing shadow boundaries) until we hit
  // something that actually scrolls.
  function scrollContainer() {
    let cur = comments()[0] || shadowRoot()?.firstElementChild;
    while (cur) {
      const parent = cur.parentNode;
      const host = parent instanceof ShadowRoot ? parent.host : parent;
      if (!host || host.nodeType !== 1) break;
      const oy = getComputedStyle(host).overflowY;
      if ((oy === 'auto' || oy === 'scroll')
          && host.scrollHeight > host.clientHeight + 1) {
        return host;
      }
      cur = host;
    }
    return null;
  }

  CommentNav.create({
    tag: TAG,

    // Everything but `c` waits for the drawer.
    enabled: () => !!shadowRoot(),

    comments,

    // The comment text wrapper. Coral hashes the rest of the class on
    // every build, so the prefix match is mandatory. Scrolling still
    // targets the whole container (the library scrolls the comment and
    // measures the body), which keeps the ~42px avatar/username row
    // above the text from ending up behind the sticky tab bar.
    body: c => c.querySelector('[class*="HTMLContent-root"]') || c,

    id: c => c.getAttribute('data-testid'),

    // Coral nests replies, but *not* inside the parent's card — the
    // parent card and the reply list are siblings under a shared
    // wrapper:
    //
    //   div#<parentUuid>.AllCommentsTabCommentContainer
    //   |- div#comment-<parentUuid>.CommentContainer      <- parent card
    //   `- div#coral-comments-replyList
    //        `- div#comment-<replyUuid>.CommentContainer  <- reply card
    //
    // So walking up from a reply looking for an ancestor card finds
    // nothing, however far it goes. What identifies the parent is the
    // reply list: the last card *before* the list, in document order,
    // is the comment being replied to. That holds at any depth.
    //
    // Derived in one left-to-right pass rather than by scanning
    // backwards per comment, which would be O(n) inside the library's
    // O(n) sibling scan. `stack` holds the reply lists currently open,
    // innermost last, each paired with the card that owns it.
    parentOf: CommentNav.parentMapper(all => {
      const map = new Map();
      const stack = [];
      all.forEach((c, i) => {
        // Leave any lists this card sits outside of.
        while (stack.length && !stack[stack.length - 1].list.contains(c)) {
          stack.pop();
        }
        const list = c.parentElement
          && c.parentElement.closest(REPLY_LIST_SEL);
        if (!list) {                   // top-level comment
          map.set(c, null);
          return;
        }
        // First card seen inside this list, so the card just before it
        // is outside the list and is the one being replied to.
        if (!stack.length || stack[stack.length - 1].list !== list) {
          stack.push({ list, parent: all[i - 1] || null });
        }
        map.set(c, stack[stack.length - 1].parent);
      });
      return map;
    }),

    // The Coral drawer is a fixed-position overflow container with
    // scrollbar-gutter: stable, and both scrollIntoView and scrollTo
    // silently no-op on it in Chrome. Direct scrollTop assignment is
    // the only thing that moves it — that's what the 'raf' strategy
    // does.
    container: scrollContainer,
    strategy: 'raf',
    headerOffset,

    commentsTop: () => {
      const sr = shadowRoot();
      if (!sr) return null;
      // The "N comments" prompt banner, falling back to the comments
      // tab pane if Coral renames it.
      return sr.querySelector('.comment-prompt')
        || sr.querySelector('#tabPane-COMMENTS');
    },

    open: {
      canOpen: () => !!document.querySelector('[data-qa="comments-btn"]'),
      click: () => {
        const btn = document.querySelector('[data-qa="comments-btn"]');
        // Clicking focuses the button, and the browser's
        // scroll-the-focused-element-into-view yanks the article up or
        // down. Pin the page scroll for a few frames to absorb that
        // and any layout shift from mounting the drawer's portal.
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
