# Washington Post: Keyboard comment navigation

## Summary

This adds keyboard shortcuts for navigating comment threads on the Washington Post.

`c` opens the comments drawer, `j` / `k` go to next / previous. Other keys are listed below.<br>
`?` opens help showing all the keys.

Scripts adding the [same key bindings for several other sites are available here](https://github.com/jshute96/userscripts/blob/main/README.md#keyboard-comment-navigation).

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `c` | Open the comments drawer |
| `j` / `k` | Go to next / previous comment |
| `h` / `l` | Go to next / previous comment at this level, skipping the current subtree |
| `p` | Go to parent comment |
| `r` | Go to root comment of this thread |
| `n` | Go to next comment at parent level |
| `m` | Go to next comment at root level |
| `?` | Show all shortcuts on this page, from this and any other userscript |

## Visible changes

- The keyboard shortcuts above.
- When `c` opens the drawer, the article's scroll position is
  preserved so the page doesn't jump.
- Jumps land the comment just below the drawer's sticky filter bar
  rather than underneath it.

## Implementation

### How comments are rendered

**This changed in September 2026.** WaPo used to embed Coral (Vox
Media's commenting system) inside an open shadow root hosted by
`#coral-shadow-root`; the script had to cross that boundary for every
lookup. WaPo now renders its own comments in the ordinary light DOM,
styled with their in-house design system (every class is
`wpds-c-<hash>`), and nothing in the drawer is in a shadow root any
more. The rewrite that followed is why the whole "Selectors we depend
on" section below looks nothing like the Coral one it replaced — if
comments break again, check first whether the engine changed again
rather than assuming a selector was renamed.

The drawer is a portal-rendered modal:

```
<div role="dialog" id="conversations-drawer" data-position="right" data-state="open">
```

It is created when the drawer opens and removed when it closes, so its
presence is the "drawer is open" gate — no separate listener is needed
for the open / close transitions. (The script also treats
`data-state="closed"` as closed, in case a future build leaves the
element mounted.)

### Selectors we depend on

Outside the drawer (used to open it from a `c` press):

- **Comments-open button:** `[data-qa="comments-btn"]`. Unchanged
  across the rewrite. The surrounding "Comments NNN" pill renders in
  two places (above-the-fold inline summary and a sticky CTA), but
  both share this `data-qa`, so the first hit is fine.

Inside `#conversations-drawer`:

- **Comment containers:** `article[data-comment-id]`. One per
  comment, top-level and reply alike, carrying the comment's uuid.
  Much cleaner than the Coral markup — no prefix filtering is needed,
  because nothing else in the drawer is an `<article>` with that
  attribute. Each also carries
  `aria-label="Comment by <name>"` for top-level and
  `aria-label="Reply by <name>"` for replies, which is the easiest way
  to eyeball the list when debugging (the script itself doesn't depend
  on the labels).
- **Comment body text:** one or more `<p class="nodeToHtml">`. This is
  the one unhashed class name in the drawer, which is what makes it
  worth anchoring on. The script uses the paragraphs' **shared
  parent**, not the first paragraph, so a multi-paragraph comment
  measures as one block. The body wrapper — rather than the whole
  `<article>` — is the element tested for viewport intersection and
  the element jumps are aligned to: the article also includes an
  avatar / username header and a vote / reply footer, so a
  partly-scrolled comment can still intersect the article long after
  its text has scrolled past.
- **Reply nesting:** `[data-name="thread-wrapper"]`, with
  `[data-name="thread-line-column"]` (the vertical rule) and
  `[data-name="thread-content-column"]` inside it, and
  `section[aria-label="Replies to comment"]` holding the reply cards.
  These `data-name` attributes are the most stable anchors in the
  drawer — see "Finding a reply's parent" below.
- **Top-of-comments anchor:** the drawer's `<header>`, which carries
  the "2.9k comments" count. Falls back to
  `section[aria-label="Comment list"]`. This header is `position:
  static` and scrolls away with the content (verified: its offset
  relative to the drawer runs 140px at the top to -2360px at
  scrollTop 2500), which is what makes it usable as a scroll target —
  a sticky header would sit at a constant offset and `c` would nudge
  the drawer by a few pixels while logging a successful jump.
- **Sticky filter bar:** the Featured / Top / My Comments / All strip,
  which pins to the top of the drawer once scrolled past. Anchored via
  `[aria-label="Comment filters"]` (a `role="group"` around the tab
  buttons), then walking up to whichever ancestor actually carries
  `position: sticky` — that wrapper's own class is a rotating
  `wpds-c-<hash>` and must not be hardcoded. The drawer has a second
  sticky element — the close button — which is deliberately not
  matched: it floats in the corner rather than spanning the width, so
  reserving its 33px would push every jump that far too low.
  Measured height varies
  with what else has pinned (56px for the tab row alone, 103px
  observed once the sort control pins with it), so it is read fresh on
  every keypress rather than cached.

  The walk is only told to find *something* sticky, so it is bounded
  at 200px. A future build that pinned a wrapper enclosing the list
  itself would otherwise report hundreds of pixels, and the library
  adds the offset to both the jump target and its
  is-this-comment-current gate — every jump would overshoot and `j`
  would look like it was skipping comments. Over the cap the script
  logs once and reserves nothing, which degrades to "jumps land
  slightly under the bar" instead.

### How we modify the page

We do not modify the DOM. The navigation itself lives in
[`lib/keyboard-comment-nav.js`](../../lib/keyboard-comment-nav.js) —
current-comment detection, the remembered jump target that keeps
chained presses advancing during a smooth scroll, the hidden-comment
filter, the scroll strategies, and all nine key bindings are shared
with the other comment-navigation scripts and documented there. Key
dispatch, the typing guard, and the `?` help overlay come from
[`lib/keyboard-shortcuts.js`](../../lib/keyboard-shortcuts.js).

What's left in this script is the site config:

* `enabled()` — the presence of `#conversations-drawer`. Everything
  but `c` waits for it.
* `comments()` — `article[data-comment-id]` inside the drawer.
* `body()` — the parent of the first `p.nodeToHtml`, falling back to
  the whole card. The fallback is right for the odd comment with no
  text of its own, but it is also what a site-wide rename of the class
  would look like, and a card measures as "current" long after its
  text has scrolled past — so `j` would quietly land a comment short
  rather than failing outright. The two are told apart by checking
  whether *any* card in the drawer has the paragraph, and the script
  says so once if none does.
* `parentOf()` — the last card before the enclosing thread wrapper;
  see below.
* `container()` — `#conversations-drawer` itself, plus
  `strategy: 'raf'`; see below.
* `headerOffset()` — the sticky ancestor of
  `[aria-label="Comment filters"]`.
* `commentsTop()` — the drawer `<header>`, falling back to
  `section[aria-label="Comment list"]`.
* `open` — `[data-qa="comments-btn"]`. Clicking focuses the button,
  and the browser's scroll-the-focused-element-into-view yanks the
  article; the page scroll is pinned for a few frames to absorb that
  and the layout shift from mounting the drawer's portal.

### Finding a reply's parent

Replies are nested, but **not inside the parent's card**. The parent
card and the thread wrapper are siblings:

```
<article data-comment-id=parent>          <- parent card
<div>                                     <- reply affordances
  <div data-reply="true">Write your reply here</div>
  <div data-name="thread-wrapper">
    <div data-name="thread-line-column">  <- the vertical rule
    <div data-name="thread-content-column">
      <section aria-label="Replies to comment">
        <article data-comment-id=reply>   <- reply card
```

So walking up from a reply looking for an ancestor card finds nothing,
no matter how far it goes.

Instead, the thread wrapper is what identifies the parent: the last
card *before* the wrapper, in document order, is the comment being
replied to. Every card inside the wrapper is a descendant of it. That
holds at any nesting depth, and needs no indentation measurement or
username matching. A card with no enclosing thread wrapper is
top-level.

Only one level of nesting has been observed in the wild — every reply
found so far is a direct child of a top-level comment — but nothing in
the markup enforces that, so the pass is written to handle any depth.

That's derived in one left-to-right pass, keeping a stack of the
thread wrappers currently open (innermost last), each paired with the
card that owns it. A card leaves any wrapper it isn't inside, and the
first card seen inside a new wrapper records its predecessor as the
owner. Doing it as a per-comment backward scan instead would be O(n)
inside the library's O(n) sibling scan; `CommentNav.parentMapper`
caches the map for the duration of a keypress.

The wrapper is deliberately matched on `data-name`, not on the sibling
`div`'s class or on `section[aria-label="Replies to comment"]`: the
class is a rotating hash, and the `section` sits *below* the
thread-content column, so anchoring there would still work for
`closest` but gives up the outer boundary the stack needs.

If WaPo renames the wrapper, `parentOf` returns null for everything
and the failure is at least visible: `p` reports it has nowhere to go
from a comment that is plainly a reply.

### Scrolling inside the drawer

`#conversations-drawer` is a fixed-position overflow container, and
**both `scrollIntoView` and `scrollTo` silently no-op on it in
Chrome** — still true of the new markup, re-verified after the
rewrite. Direct assignment to `scrollTop` is the only thing that moves
it, which is what the library's `raf` strategy does: hand-rolled
cosine easing writing `scrollTop` each frame.

One consequence when testing by remote-controlling the browser: `raf`
scrolling depends on `requestAnimationFrame`, which Chrome pauses in
background tabs. Drive the page with the tab foregrounded
(`Page.bringToFront` over CDP) or the nav logs will show comments
advancing while the drawer sits perfectly still — which looks exactly
like a broken scroll container.

Unlike the Coral version, the container needs no ancestor walk: it's a
plain `getElementById`. That does drop a check the walk used to make
for free — that the element actually scrolls. If WaPo moves the
overflow onto an inner element, `scrollTop` writes land on a
non-scrolling element and do nothing, and because the container is
still non-null the library's own "scroll container not found; using
window scroll" fallback never fires. The symptom would be jumps
logging success while the drawer sits still, i.e. identical to the
background-tab pause above. So the script checks scrollability and
logs once when it fails. It still returns the drawer either way: the
library's null-container path scrolls the *window*, which would drag
the article around behind the drawer rather than doing nothing.

### What we assume stays stable

- The drawer is `#conversations-drawer` and exists only while open.
- Each rendered comment is an `article[data-comment-id]` inside it.
- Comment text is `<p class="nodeToHtml">`.
- Replies live inside `[data-name="thread-wrapper"]`, which follows
  the card being replied to in document order.
- `[aria-label="Comment filters"]` marks the tab strip, and some
  ancestor of it between there and the drawer is the sticky bar.
- The drawer has a `<header>`, or
  `section[aria-label="Comment list"]` survives.
- `[data-qa="comments-btn"]` opens the drawer.

If the comments stop responding to `j` / `k`, run this in the page
console while the drawer is open:

```js
(() => {
  const d = document.getElementById('conversations-drawer');
  if (!d) return 'drawer not open';
  return {
    comments: d.querySelectorAll('article[data-comment-id]').length,
    bodies: d.querySelectorAll('p.nodeToHtml').length,
    threadWrappers: d.querySelectorAll('[data-name="thread-wrapper"]').length,
    filters: !!d.querySelector('[aria-label="Comment filters"]'),
    header: !!d.querySelector('header'),
    list: !!d.querySelector('section[aria-label="Comment list"]'),
    scrolls: d.scrollHeight > d.clientHeight + 1,
    headerIsStatic: getComputedStyle(d.querySelector('header')).position === 'static',
    commentsBtn: !!document.querySelector('[data-qa="comments-btn"]'),
  };
})()
```

The first null / zero in that record is the broken assumption. If
`comments` is zero but the drawer is plainly full of comments, assume
the engine was replaced again rather than hunting for a renamed class.

### SPA behavior

WaPo article pages are SPA-routed but this script doesn't care: it
registers one document-level keydown listener at init and the handler
self-gates on the drawer's presence, so it does the right thing on
every article without re-running on URL changes. `@match` is the site
root so the script loads regardless of which page the user starts on.
