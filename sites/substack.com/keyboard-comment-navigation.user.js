// ==UserScript==
// @name         Substack: Keyboard comment navigation
// @namespace    https://github.com/jshute96/userscripts
// @version      1.0.5
// @description  Adds keyboard shortcuts for moving through the comments on a post — next and previous comment, parent, next thread, and jump to the comments section.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://*.substack.com/*
// @match        https://*/p/*
// @exclude      https://*.instagram.com/*
// @require      https://raw.githubusercontent.com/jshute96/userscripts/main/lib/keyboard-shortcuts.js
// @require      https://raw.githubusercontent.com/jshute96/userscripts/main/lib/keyboard-comment-nav.js
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[substack nav]';

  if (window.__substackNavLoaded) {
    console.log(TAG, 'already loaded; skipping duplicate run');
    return;
  }
  window.__substackNavLoaded = true;

  console.log(TAG, 'initializing');

  // Substack's comment markup is hand-written rather than CSS-modules, so
  // these are plain semantic class names with no build-hash suffixes. The
  // surrounding page chrome is CSS-modules (`pencraft pc-*` plus hashed
  // classes) and is avoided here for that reason.
  const SEL = {
    // The per-comment container. It *wraps its own reply subtree*, so
    // `.comment` elements are genuinely nested in the DOM.
    comment:       '.comment',
    // The comment's own header, prose and action row, as a direct child.
    content:       ':scope > .comment-content',
    // The prose alone, inside that.
    body:          ':scope > .comment-content .comment-body',
    // An empty div carrying `id="comment-<id>"`, first child of `.comment`.
    anchor:        ':scope > .comment-anchor',

    // Only the dedicated comments page has these.
    listContainer: '.comment-list-container',
    // The post page's inline preview list, which starts at the first
    // comment (the composer sits above it, outside).
    postPageList:  '.comment-list.post-page-root-comment-list',
    // The whole comments section on a post page, composer included.
    postSection:   '#substack-comments',
    // "126 more comments..." — the link from a post to its comments page.
    moreComments:  'a.more-comments',

    // The publication bar across the top of every page. `.main-menu` is
    // the in-flow placeholder; the bar that actually paints is an inner
    // `[class*="mainMenuContent"]` that Substack animates in and out.
    navbar:        '[data-testid="navbar"], .main-menu',
    // The inner element that actually paints, and animates in and out.
    navbarPainted: '[class*="mainMenuContent"]',
  };

  // The bar is 84px tall while the page is within ~90px of the top and
  // 72px below that, so a jump that *starts* at the top loses 12px of
  // content above the target while it animates, and lands that far past
  // it. Both `scrollIntoView` and a computed `scrollTo` fix their
  // destination up front, so both overshoot by exactly the collapse.
  //
  // Overshooting is the expensive mistake: the only way back is to
  // scroll up, and scrolling up is precisely what makes Substack slide
  // the bar in again — which is visible, unwanted, and happens right
  // after the jump appears to have finished.
  //
  // So aim *short* by the amount the page is about to shrink, and let
  // the library's `settle` correction close any remaining gap
  // downward, where the bar stays out of the way.
  //
  // The exact amount is the difference between the bar's height now and
  // its height once collapsed. The second number can't be read until
  // the page has actually scrolled, so it's learned — and until it is,
  // a deliberate over-estimate keeps the error on the safe side of
  // zero. Half the bar's height is over-estimate enough for a collapse
  // this shallow; the cost is one extra downward nudge on the first
  // jump of a page load, and none after that.
  // `@match` covers `https://*/p/*` so that Substack publications on
  // custom domains are picked up, which also matches the handful of
  // unrelated sites that use `/p/` paths. `.comment` is far too generic
  // a class to be evidence of anything on its own, so confirm the page
  // is Substack's before binding behavior to it — otherwise we'd
  // swallow `j`/`k` on someone else's site and scroll to whatever their
  // `.comment` happens to be. Same test as `close-popups.user.js`:
  // `pencraft` is Substack's design-system class prefix, on every page
  // they render.
  const SUBSTACK_HOST = 'substack.com';
  const SUBSTACK_MARKUP = '[class*="pencraft"], link[href*="substackcdn.com"]';

  function onSubstackPage() {
    const host = location.hostname;
    return host === SUBSTACK_HOST || host.endsWith('.' + SUBSTACK_HOST)
      || !!document.querySelector(SUBSTACK_MARKUP);
  }

  const COLLAPSED_PROBE_PX = 150;   // safely past the ~90px threshold
  let collapsedBarHeight = null;

  // Called on every `headerOffset`, whichever branch it goes on to
  // take: the chance to see the collapsed height comes while the page
  // is scrolled, which is exactly when the other branches run.
  function noteBarHeight(height) {
    // `height > 0` is the important half of this test. The value is a
    // running minimum that never recovers, so a single zero — the bar
    // missing for a frame, or measured mid-SPA-navigation before it
    // renders — would poison it for the life of the page and make
    // every downward jump undershoot by a full bar height.
    if (height > 0 && window.scrollY > COLLAPSED_PROBE_PX
        && (collapsedBarHeight === null || height < collapsedBarHeight)) {
      collapsedBarHeight = height;
    }
  }

  function collapseAllowance(height) {
    if (collapsedBarHeight === null) return Math.round(height / 2);
    return Math.max(0, height - collapsedBarHeight);
  }

  CommentNav.create({
    tag: TAG,

    comments: () => [...document.querySelectorAll(SEL.comment)],

    // Viewport intersection is tested against the prose, not `.comment`:
    // `.comment` contains the entire reply subtree, so it keeps
    // intersecting the viewport for as long as any descendant does and
    // `j` would stick on the first root comment forever. The fallbacks
    // stay scoped to `:scope >` for the same reason — an unscoped
    // `.comment-body` would reach into a nested reply.
    body: el => el.querySelector(SEL.body)
      || el.querySelector(SEL.content)
      || el,

    // True DOM nesting: a reply's `.comment` sits inside its parent's,
    // under an intermediate `.comment-list > .comment-list-items`. So the
    // parent is just the nearest `.comment` ancestor, at any depth —
    // threads here run well past two levels.
    parentOf: el => el.parentElement?.closest(SEL.comment) || null,

    // `.comment` itself carries no id; the anchor div immediately inside
    // it does (`comment-317866642`). Scoped so a comment with its own
    // replies reports its own id rather than its first reply's.
    id: el => el.querySelector(SEL.anchor)?.id || '?',

    // Everything but `c` is gated on being on a Substack page that has
    // comments in the DOM. On a publication's home page, its archive,
    // or a non-Substack site that happens to use a `/p/` path, this is
    // false and the keys pass through to the site untouched.
    enabled: () => onSubstackPage() && !!document.querySelector(SEL.comment),

    // Where `c` lands.
    //
    // On the comments page: the first comment itself, not the list
    // container that holds it. They sit at the same offset, but
    // returning the comment lets the library remember it as the current
    // one, so the `j` straight after `c` reliably advances to the
    // second comment instead of re-deriving "current" from a viewport
    // the header may have shifted under.
    //
    // On a post page: `c` means "take me to the comments", and the real
    // comments live on a separate page, so we return nothing here and
    // let `open` below follow the "N more comments..." link instead.
    // When that link is absent — a post with few enough comments that
    // Substack shows them all inline — there's nowhere to navigate to,
    // so we scroll to the first inline comment instead.
    commentsTop: () => {
      if (!onSubstackPage()) return null;
      const first = () => [...document.querySelectorAll(SEL.comment)]
        .find(el => el.offsetParent !== null) || null;
      if (document.querySelector(SEL.listContainer)) {
        return first() || document.querySelector(SEL.listContainer);
      }
      if (document.querySelector(SEL.moreComments)) return null;
      return first()
        || document.querySelector(SEL.postPageList)
        || document.querySelector(SEL.postSection);
    },

    open: {
      canOpen: () => !!document.querySelector(SEL.moreComments),
      click: () => document.querySelector(SEL.moreComments).click(),
    },

    // The publication bar hides itself when the page scrolls down and
    // slides back in when it scrolls up. Measured on a live comments
    // page, that is completely deterministic:
    //
    //   scroll down 300px -> position:fixed, top:-72  (bar gone)
    //   scroll up   300px -> position:fixed, top:  0  (bar back)
    //
    // So there is no single right offset. Always reserving the bar's
    // height leaves a 72px band of the *previous* comment above the
    // target on every downward jump, because the bar isn't there to
    // fill it. Never reserving it buries the start of the comment
    // behind the bar on every upward jump, because it is. The first
    // two versions of this script shipped one mistake each.
    //
    // What's right depends on which way this particular jump goes,
    // which is why the library hands us the target.
    //
    // The height is read from `.main-menu`, the in-flow placeholder:
    // it tracks the painted bar exactly (72px, or 84px at the very top
    // of the page where the bar is taller) and, being static, can't be
    // perturbed by the animation.
    headerOffset: el => {
      const bar = document.querySelector(SEL.navbar);
      const height = bar ? bar.getBoundingClientRect().height : 0;
      noteBarHeight(height);
      // How much of the viewport the bar covers at this instant.
      const painted = document.querySelector(SEL.navbarPainted);
      const shown = painted
        ? Math.min(height,
            Math.max(0, painted.getBoundingClientRect().bottom))
        : height;
      // The current-comment test asks what's covered right now.
      if (!el) return shown;
      // A couple of pixels of slack on both edges of the band. Both
      // numbers are fractional — the bar measures 71.7356px — so an
      // exact comparison put a target resting at 72.0 *outside* the
      // band by a quarter of a pixel, and `c` pressed twice from below
      // moved the page 72px on the second press.
      const EPS = 2;
      const top = el.getBoundingClientRect().top;
      if (top < -EPS) return height;           // heading up: the bar comes back
      if (top > height + EPS) return collapseAllowance(height);
      // Already parked within a bar's height of the top — where a
      // previous jump left it, give or take. Snap to whichever end of
      // that band the bar is currently at: 0 if it's away, its full
      // height if it's in. Both ends are fixed points, so a repeated
      // press computes a zero delta and holds, and the small move to
      // reach one is in the direction that keeps the bar where it is.
      //
      // Answering by direction instead makes the key non-idempotent: a
      // second `c` after an upward one sees the target sitting at 72,
      // calls that "heading down", and nudges it 72px further.
      // Answering with the raw live occlusion *creeps*, because that
      // value is mid-animation — it read 8, so we scrolled up 8px,
      // which brought the bar 7px further in, which asked for another
      // 8px, and `c` walked the page 0 -> 8 -> 15. Rounding to an end
      // of the band is what makes it settle instead.
      return shown > height / 2 ? height : 0;
    },

    // Avatars, embedded images and quoted-post cards load lazily above
    // the target while the scroll is animating, which pushes it further
    // down the document and lands us short.
    strategy: 'settle',
  });
})();
