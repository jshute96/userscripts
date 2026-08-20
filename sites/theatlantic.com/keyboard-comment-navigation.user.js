// ==UserScript==
// @name         The Atlantic: Keyboard comment navigation
// @namespace    https://github.com/jshute96/userscripts
// @version      1.0.3
// @description  Adds keyboard shortcuts for moving through the discussion drawer on an article — next and previous comment, parent, next thread, and open or jump to the drawer.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://www.theatlantic.com/*
// @require      https://raw.githubusercontent.com/jshute96/userscripts/main/lib/keyboard-shortcuts.js
// @require      https://raw.githubusercontent.com/jshute96/userscripts/main/lib/keyboard-comment-nav.js
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[atlantic nav]';

  if (window.__atlanticCNavLoaded) {
    console.log(TAG, 'already loaded; skipping duplicate run');
    return;
  }
  window.__atlanticCNavLoaded = true;

  console.log(TAG, 'initializing');

  // The discussion drawer is Coral (coralproject.net), the same
  // commenting platform the Washington Post and The Verge use, so the
  // DOM inside it matches those scripts and their `parentOf` pass is
  // reused verbatim. The Atlantic's wrapper around it is its own.

  // The drawer slides in from the right. It stays mounted when closed
  // and is moved off-screen with a transform, so "is it open?" is a
  // horizontal-position test — it keeps its full 600x956 rect either
  // way, and being position:fixed it has a null offsetParent in both
  // states too.
  const DRAWER_SEL = '[data-event-module="comments drawer"]';
  const drawer = () => document.querySelector(DRAWER_SEL);

  function drawerOpen() {
    const d = drawer();
    if (!d) return false;
    const r = d.getBoundingClientRect();
    return r.width > 0 && r.left < window.innerWidth - 50;
  }

  // The comment stream is rendered into an open shadow root on
  // #coral-shadow-container, inside the drawer.
  const shadowRoot = () =>
    document.getElementById('coral-shadow-container')?.shadowRoot || null;

  // Real comment containers are data-testid="comment-<uuid>". Other
  // elements share the "comment-" prefix (comment-reply-button,
  // comment-reaction-button, comment-report-button), so filter to
  // UUID-shaped ids.
  const IS_COMMENT = /^comment-[0-9a-f]{8}-/;

  // The list wrapping a comment's replies. Matched by *prefix*: the
  // full id is coral-comments-replyList-log--<parentUuid>, so this can
  // never be a getElementById lookup.
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

  // The drawer element is itself the scroll container (overflow-y:
  // auto on the same element), and it scrolls normally.
  //
  // Note the drawer carries a React-generated id (`:R5lhim:`) which
  // changes between renders — the data-event-module attribute is the
  // only stable handle on it.
  const container = drawer;

  // Two sticky bars pin to the top of the drawer's scroll area and
  // overlap each other: The Atlantic's own "Discussions" header (54px)
  // and, drawn over it, Coral's "All Comments (N)" tab bar (55px).
  // Both carry build-hashed CSS-module classes, so match on the
  // semantic prefix only.
  //
  // Querying by selector rather than sweeping every node for a
  // computed `position` is deliberate: the shadow root holds a card
  // per comment — several hundred on a busy article, tens of
  // thousands of nodes — and a full sweep per keypress is far too
  // slow. Cached for a beat on top of that, since the library asks
  // more than once per keypress.
  const STICKY_SEL = [
    '[class*="ArticleComments_header"]',   // The Atlantic's drawer header
    '[class*="StreamContainer-tabBarRow"]', // Coral's tab bar, this build
    '[class*="StickyNav-root"]',            // Coral's tab bar, other builds
  ].join(', ');
  const HEADER_CACHE_MS = 100;
  let cached = { at: -Infinity, value: 0 };

  function headerOffset() {
    const now = performance.now();
    if (now - cached.at < HEADER_CACHE_MS) return cached.value;
    const d = drawer();
    const sr = shadowRoot();
    let value = 0;
    if (d) {
      const top = d.getBoundingClientRect().top;
      let bottom = top;
      for (const root of sr ? [d, sr] : [d]) {
        for (const el of root.querySelectorAll(STICKY_SEL)) {
          const pos = getComputedStyle(el).position;
          if (pos !== 'sticky' && pos !== 'fixed') continue;
          const r = el.getBoundingClientRect();
          if (r.width < 20 || r.height > 200) continue;
          if (r.top > top + 20 || r.bottom <= top) continue;
          if (r.bottom > bottom) bottom = r.bottom;
        }
      }
      value = bottom - top;
    }
    cached = { at: now, value };
    return value;
  }

  CommentNav.create({
    tag: TAG,

    // @match is the whole site so the script survives client-side
    // navigation onto an article; everything but `c` waits for the
    // drawer to be open.
    enabled: drawerOpen,

    comments,

    // The comment text wrapper. Coral hashes the rest of the class on
    // every build, so the prefix match is mandatory. Scrolling still
    // targets the whole container (the library scrolls the comment and
    // measures the body), which keeps the username / timestamp rows
    // above the text from ending up behind the sticky bars.
    body: c => c.querySelector('[class*="HTMLContent-root"]') || c,

    id: c => c.getAttribute('data-testid'),

    // Coral nests replies, but *not* inside the parent's card — the
    // parent card and the reply list are siblings under a shared
    // wrapper:
    //
    //   div.AllCommentsTabCommentContainer-<hash>
    //   |- div#comment-<parentUuid>.CommentContainer-<hash>
    //   `- div.coral-comment-replies
    //        `- div#coral-comments-replyList-log--<parentUuid>
    //             `- div
    //                 `- div#comment-<replyUuid>.CommentContainer-<hash>
    //
    // So walking up from a reply looking for an ancestor card finds
    // nothing, however far it goes. What identifies the parent is the
    // reply list: the last card *before* the list, in document order,
    // is the comment being replied to. That holds at any depth —
    // Atlantic threads reach at least seven levels, so resolving to
    // the thread root instead would make `p` overshoot badly.
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

    container,
    strategy: 'container',
    headerOffset,

    // `c` puts the *first comment* at the top, not the top of the Coral
    // stream. #tabPane-COMMENTS starts well above it — the composer and
    // the tab strip come first — so anchoring there leaves `c` looking
    // like it didn't reach the comments at all. Only when there are
    // none does the stream top become the useful destination.
    commentsTop: () => {
      // Must be null while the drawer is closed: the drawer and the
      // shadow root both survive a close, and returning an anchor from
      // them would make `c` scroll an off-screen drawer instead of
      // opening it.
      if (!drawerOpen()) return null;
      return comments()[0]
        || shadowRoot()?.querySelector('#tabPane-COMMENTS')
        || null;
    },

    open: {
      canOpen: () => !!openButton(),
      click: () => openButton().click(),
    },
  });

  // The article renders the same "Discuss (N comments)" button in
  // three places — the byline row, the floating side rail, and the
  // "View Discussion" bar under the article — all sharing this
  // data-event-element. Any of them opens the drawer.
  //
  // Buttons inside the drawer are excluded. A width test alone isn't a
  // visibility test on this site: the drawer keeps its full 600x956
  // rect while closed (it's moved off-screen by a transform), so
  // anything within it measures as rendered whether or not it's on
  // screen.
  //
  // Unlike The Verge, there's no per-article filter to apply here —
  // these are buttons, not links, and carry no article identity. That
  // costs nothing today: section and topic index pages render article
  // cards with no comments button at all (checked on /ideas/), so
  // there's no page where the first match belongs to a different
  // article. If that changes, the fix is to scope the query to the
  // page's own <article> element.
  function openButton() {
    const d = drawer();
    return [...document.querySelectorAll('[data-event-element="comments button"]')]
      .find(b => !(d && d.contains(b)) && b.getBoundingClientRect().width > 0)
      || null;
  }
})();
