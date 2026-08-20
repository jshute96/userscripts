// ==UserScript==
// @name         The Verge: Keyboard comment navigation
// @namespace    https://github.com/jshute96/userscripts
// @version      1.0.6
// @description  Adds keyboard shortcuts for moving through an article's comments drawer — next and previous comment, parent, next thread. Also closes the pill that obscures comments.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://www.theverge.com/*
// @require      https://raw.githubusercontent.com/jshute96/userscripts/main/lib/keyboard-shortcuts.js
// @require      https://raw.githubusercontent.com/jshute96/userscripts/main/lib/keyboard-comment-nav.js
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[verge nav]';

  if (window.__vergeCNavLoaded) {
    console.log(TAG, 'already loaded; skipping duplicate run');
    return;
  }
  window.__vergeCNavLoaded = true;

  console.log(TAG, 'initializing');

  // The drawer is Coral (coralproject.net), the same commenting
  // platform the Washington Post uses, so the DOM inside it matches
  // that script closely. The Verge's own wrapper around it is
  // different: the drawer chrome and its scroll container live in the
  // light DOM with stable ids, and only the comment stream itself is
  // inside the shadow root.

  // #coral-drawer is the fixed dialog; it stays in the DOM once
  // created and is hidden with display:none, so a zero-sized rect is
  // our "drawer is closed" test.
  const drawer = () => document.getElementById('coral-drawer');

  function drawerOpen() {
    const d = drawer();
    if (!d) return false;
    const r = d.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  // The comment stream is rendered into an open shadow root on
  // #coral-shadow-container.
  const shadowRoot = () =>
    document.getElementById('coral-shadow-container')?.shadowRoot || null;

  // Real comment containers are data-testid="comment-<uuid>". Other
  // elements share the "comment-" prefix (comment-reply-button,
  // comment-reaction-button, comment-report-button), so filter to
  // UUID-shaped ids.
  const IS_COMMENT = /^comment-[0-9a-f]{8}-/;

  // The list wrapping a comment's replies. Matched by *prefix*: the
  // full id carries the parent comment's uuid
  // (coral-comments-replyList-log--<uuid>), so this can never be a
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

  // The drawer's scroll container is a plain overflow element in the
  // light DOM with a stable id, and both scrollTo and scrollTop move
  // it normally — no need for WaPo's hand-rolled 'raf' scrolling.
  const container = () => document.getElementById('coral-drawer-scroll');

  // The scroll area runs the full height of the drawer. Nothing
  // occupies a header band across the top of it — instead the drawer's
  // controls float over the corner: the notification bell and close
  // button, top-right, about 90px wide.
  //
  // So the offset is normally **zero**, and deliberately so. Offsetting
  // by the height of that corner cluster (the first version measured
  // 50px) leaves the tail of the *previous* comment — its last line and
  // its Rec / Reply / Share row — sitting above the one we jumped to,
  // which makes it ambiguous which comment the jump was pointing at.
  // Landing flush at the top is unambiguous, and the corner cluster
  // never covers a comment's opening line, which is a short
  // left-aligned username row.
  //
  // What does need accounting for is Coral's "Refresh comments / Close"
  // pill, which appears mid-drawer when new comments arrive and does
  // cover text. `dismissRefreshPill` below closes it on sight; this is
  // the backstop for the window before that runs, and for the case
  // where the pill turns up without a close button to click.
  //
  // The pill is inside the shadow root, which `querySelectorAll` on
  // the drawer does not reach into, so it's measured separately and by
  // selector — sweeping the shadow root for computed positions would
  // mean `getComputedStyle` on every node of every comment.
  //
  // For the drawer's own light-DOM overlays, one counts only if it
  // reaches into the left 40% of the drawer — that's what separates
  // something covering the text column from something tucked in the
  // corner.
  //
  // Classes here are build-hashed vanilla-extract names with nothing
  // semantic in them, so this measures rather than naming elements. The
  // library asks for the offset more than once per keypress and this
  // walks the drawer, so cache it for a beat — long enough to cover one
  // keypress, short enough to pick up an overlay appearing.
  const HEADER_CACHE_MS = 100;
  let cached = { at: -Infinity, value: 0 };

  function headerOffset() {
    const now = performance.now();
    if (now - cached.at < HEADER_CACHE_MS) return cached.value;
    const d = drawer();
    const sc = container();
    let value = 0;
    if (d && sc) {
      const scr = sc.getBoundingClientRect();
      const textEdge = scr.left + scr.width * 0.4;
      let bottom = scr.top;
      for (const el of d.querySelectorAll('*')) {
        if (el === sc || getComputedStyle(el).position !== 'fixed') continue;
        const r = el.getBoundingClientRect();
        if (r.height > 200 || r.width < 20) continue;   // not an overlay
        if (r.left > textEdge) continue;                // corner cluster
        if (r.top > scr.top + 100 || r.bottom <= scr.top) continue;
        if (r.bottom > bottom) bottom = r.bottom;
      }
      const pill = refreshPill();
      if (pill) {
        const r = pill.getBoundingClientRect();
        if (r.bottom > bottom && r.top < scr.top + 200) bottom = r.bottom;
      }
      value = bottom - scr.top;
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
    // measures the body), which keeps the username / "In reply to"
    // rows above the text from ending up under the floating controls.
    body: c => c.querySelector('[class*="HTMLContent-root"]') || c,

    id: c => c.getAttribute('data-testid'),

    // Coral nests replies, but *not* inside the parent's card — the
    // parent card and the reply list are siblings under a shared
    // wrapper:
    //
    //   div.AllCommentsTabCommentContainer-<hash>
    //   |- div
    //   |   `- div#comment-<parentUuid>.CommentContainer-<hash>
    //   `- div
    //       `- div#coral-comments-replyList-log--<parentUuid>
    //            `- div
    //                `- div#comment-<replyUuid>.CommentContainer-<hash>
    //
    // So walking up from a reply looking for an ancestor card finds
    // nothing, however far it goes. What identifies the parent is the
    // reply list: the last card *before* the list, in document order,
    // is the comment being replied to. That holds at any depth — and
    // depth here does exceed two, so resolving to the thread root
    // instead would make `p` overshoot.
    //
    // Replies are indented on screen, but **the indent is invisible to
    // the comment containers**: Coral puts the padding on the reply
    // list, so every card's own getBoundingClientRect().left is the
    // same at every depth, and only the body inside it shifts (about
    // 20px per level). Measuring container lefts to work out the tree
    // reads as "this site is flat" — it isn't. Use the reply lists.
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
    // stream. #tabPane-COMMENTS starts well above it — welcome banner,
    // community-guidelines blurb, "post a comment" composer, tab strip,
    // sort dropdown — so anchoring there leaves `c` looking like it
    // didn't reach the comments at all. Only when there are none does
    // the stream top become the useful destination.
    commentsTop: () => {
      // Must be null while the drawer is closed: #coral-drawer and the
      // shadow root both survive a close, and returning an anchor from
      // them would make `c` scroll to a hidden drawer instead of
      // opening it.
      if (!drawerOpen()) return null;
      return comments()[0]
        || shadowRoot()?.querySelector('#tabPane-COMMENTS')
        || null;
    },

    open: {
      canOpen: () => !!openLink(),
      click: () => openLink().click(),
    },
  });

  // ---------------------------------------------------------------
  // Coral's "Refresh comments" pill
  //
  // When new comments arrive while the drawer is open, Coral floats a
  // "⟳ Refresh comments | Close ✕" pill over the top of the stream —
  // not in a header band, directly on top of whatever comment text is
  // there. It sits right where a jump lands, so it obscures the thing
  // you just navigated to. We dismiss it on sight.
  //
  // Note this gives up the prompt to load newly-arrived comments;
  // reopening the drawer (or `c` twice) picks them up.
  //
  // The pill is inside the Coral shadow root, and its classes are
  // CSS-module hashes. Its aria-labels are the stable part — Coral
  // localizes the button as "Refresh comments" / "Refresh reviews" /
  // "Refresh questions" depending on the story mode.
  const REFRESH_SEL = 'button[aria-label^="Refresh" i]';

  // The pill's own container: the nearest ancestor of the refresh
  // button that also holds the Close button. Coral renders the two as
  // near-siblings inside a small flex wrapper, so the search is capped
  // at three hops *and* at a container holding no more than a handful
  // of buttons. Without that second condition the walk-up eventually
  // reaches a stream-level container, where `querySelector` would
  // happily return some unrelated Close control for us to click.
  const MAX_HOPS = 3;
  const MAX_BUTTONS = 4;

  function refreshPill() {
    const refresh = shadowRoot()?.querySelector(REFRESH_SEL);
    if (!refresh) return null;
    let el = refresh.parentElement;
    for (let hops = 0; el && hops < MAX_HOPS; el = el.parentElement, hops++) {
      if (el.querySelectorAll('button').length > MAX_BUTTONS) break;
      if (el.querySelector('button[aria-label="Close"]')) return el;
    }
    return null;
  }

  // Reentrancy guard: the click below makes Coral re-render, which
  // fires the observer again. That terminates on its own today (the
  // button goes away), but a build that re-rendered the pill in place
  // would turn it into a click loop.
  let dismissing = false;

  function dismissRefreshPill() {
    if (dismissing) return;
    const sr = shadowRoot();
    if (!sr) return;
    if (!sr.querySelector(REFRESH_SEL)) return;
    const pill = refreshPill();
    if (!pill) {
      console.log(TAG, 'refresh pill found but no close button; leaving it');
      return;
    }
    dismissing = true;
    try {
      pill.querySelector('button[aria-label="Close"]').click();
      console.log(TAG, 'dismissed the "refresh comments" pill');
    } finally {
      dismissing = false;
    }
  }

  // The shadow root doesn't exist until the drawer is first opened,
  // which can be any time at all — the reader may spend ten minutes on
  // the article first, or land on the homepage and navigate in. So
  // this waits for the host with a MutationObserver rather than a
  // polling timer: an earlier version polled every 500ms and gave up
  // after two minutes, which meant the watcher was usually already
  // dead by the time the drawer was opened.
  //
  // #comments-drawer is present at document-idle and is where Coral
  // mounts, so it's a much narrower thing to watch than the document.
  const DEBOUNCE_MS = 100;
  let debounce = null;

  function scheduleDismiss() {
    clearTimeout(debounce);
    debounce = setTimeout(dismissRefreshPill, DEBOUNCE_MS);
  }

  function watchForRefreshPill() {
    const sr = shadowRoot();
    if (!sr) return false;
    console.log(TAG, 'comment stream mounted; watching for the refresh pill');
    // Debounced: this fires on every mutation anywhere in the stream —
    // comments arriving, reaction counts ticking, the composer being
    // typed in — and each run queries across every comment card.
    new MutationObserver(scheduleDismiss)
      .observe(sr, { childList: true, subtree: true });
    dismissRefreshPill();
    return true;
  }

  // One wrinkle: the host <div> is inserted a beat before its shadow
  // root is attached, and everything after that happens *inside* the
  // shadow tree — which a light-DOM observer cannot see. So the
  // observer firing on the insertion finds no shadow root yet and then
  // never hears anything again. It hands off to a short bounded retry
  // for that gap.
  const RETRY_MS = 250;
  const RETRY_LIMIT = 80;            // 20 seconds
  let retry = null;

  function startRetry() {
    if (retry) return;
    let tries = 0;
    retry = setInterval(() => {
      if (watchForRefreshPill() || ++tries >= RETRY_LIMIT) {
        clearInterval(retry);
        retry = null;
        if (tries >= RETRY_LIMIT) {
          console.log(TAG, 'comment stream host never got a shadow root; '
            + 'not watching for the refresh pill');
        }
      }
    }, RETRY_MS);
  }

  if (!watchForRefreshPill()) {
    const mountPoint = document.getElementById('comments-drawer')
      || document.documentElement;
    const hostObserver = new MutationObserver(() => {
      if (!document.getElementById('coral-shadow-container')) return;
      hostObserver.disconnect();
      if (!watchForRefreshPill()) startRetry();
    });
    hostObserver.observe(mountPoint, { childList: true, subtree: true });
  }

  // Every "Comments" affordance is an anchor to this article's
  // #comments, and clicking one opens the drawer. The page carries
  // several — the sticky header count, the byline row, the button
  // under the article — plus one per headline in the "More in …"
  // rails, which point at *other* articles. Match on the href's path
  // so we never open someone else's thread, and take the first one
  // that's actually rendered.
  function openLink() {
    return [...document.querySelectorAll('a.duet--article--comments-link')]
      .find(a => new URL(a.href, location.href).pathname === location.pathname
        && a.getBoundingClientRect().width > 0) || null;
  }
})();
