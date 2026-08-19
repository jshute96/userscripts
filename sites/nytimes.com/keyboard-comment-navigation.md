# NYTimes: Keyboard comment navigation

## Summary

This adds keyboard shortcuts for navigating comment threads on the New York Times.

`c` opens the comments panel, `j` / `k` go to next / previous. Other keys are listed below.<br>
`?` opens help showing all the keys.

Scripts adding the [same key bindings for several other sites are available here](https://github.com/jshute96/userscripts/blob/main/README.md#keyboard-comment-navigation).

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `c` | Open the comments panel |
| `j` / `k` | Go to next / previous comment |
| `h` / `l` | Go to next / previous comment at this level, skipping the current subtree |
| `p` | Go to parent comment |
| `r` | Go to root comment of this thread |
| `n` | Go to next comment at parent level |
| `m` | Go to next comment at root level |
| `?` | Show all shortcuts on this page, from this and any other userscript |

## Visible changes

* The keyboard shortcuts above, scrolling smoothly within the panel's
  own scroll container.
* No visible markup changes — the script only attaches a `keydown`
  listener.

## Implementation

### What NYT's comments panel looks like

NYT articles render the comments as a fixed-position drawer on the
right side of the page, opened by clicking the "Read N comments"
button in the article header/toolbar. The panel is always present
in the DOM but collapsed to zero width until opened.

* Panel root: `<div data-testid="comments-panel">`.
* The panel has an inner scroll container — a `<div>` whose
  computed `overflow-y` is `scroll` (currently
  `class="css-1h21wu5"`, but we locate it by walking children and
  matching on `overflow-y`, not by class).
* Inside the panel the comment list (`data-testid="comment-list"`)
  contains:
  - A sticky header row with the "N comments on …" title, search
    box, and three tabs ("Reader Picks", "From NYT", "All").
  - A flat stream of top-level comments, each
    `<div data-testid="comment-container" role="article">` with an
    `id` of the form `comment-container-<numericId>`.
* Replies nest. Pressing the "Replies N" button on a comment expands
  an inline reply list, and a reply can itself have replies —
  observed at least three levels deep on an opinion piece:
  - The expanded list sits inside the parent
    `comment-container`, inside
    `<div data-testid="reply-list-threading">`.
  - Each reply is
    `<div data-testid="reply-comment-container" role="article">`
    with its own `id="comment-container-<numericId>"`.
  - A "Close replies" button
    (`data-testid="close-replies-button"`) and "N more replies"
    pagination button
    (`data-testid="comment-show-more-button"`) live alongside the
    reply list.
* Each comment (top-level or reply) has its actual text in a
  `<p id="comment-content-N">` element — `N` matches the
  `aria-posinset` on the container (and is `0` for replies).
* The panel header is a `<header aria-live="polite">` containing
  the "N comments on …" title.

The article is server-rendered; the comments panel content
hydrates on the client. By the time `@run-at document-idle` fires,
the panel structure exists (even if collapsed), so the script
doesn't need a `MutationObserver`.

### What we assume stays stable

The script breaks if any of these change:

1. The panel lives at `[data-testid="comments-panel"]` and its
   scroll container is the first descendant with computed
   `overflow-y: auto|scroll`.
2. Top-level comments are
   `[data-testid="comment-container"]`. Replies are
   `[data-testid="reply-comment-container"]`. Both have a
   `<p id="comment-content-N">` body element.
3. Each reply is nested *inside* its parent's
   `[data-testid="comment-container"]` element (so
   `reply.closest('[data-testid="comment-container"]')` returns
   the parent root).
4. A reply's container is a DOM descendant of its parent's container,
   so the nearest enclosing comment is the immediate parent. Depth
   itself doesn't matter — the shared library derives every key from
   `parentOf` at any depth. What would break it is NYT flattening the
   markup and expressing depth only visually (indentation, a left
   border); then `p` would resolve every reply to the thread root and
   `r` would silently become a synonym for `p`.
5. The panel header is the panel's first `<header>`, used as the
   anchor for `c`.

### If this breaks in the future

Triage in order:

1. Open DevTools, look for `[nyt cnav] initializing`. Missing →
   `@match` or install issue.
2. Press `c` while the panel is open. If nothing happens and the
   script logs nothing, the script isn't gated correctly — check
   `panelOpen()`.
3. Press `j`. If `[nyt cnav] no comments in panel` fires, the
   `[data-testid="comment-container"]` selector has changed —
   re-check the comment list.
4. Press `p` while on a reply. If it logs "already a root", either
   the `reply-comment-container` data-testid changed, or the
   reply is no longer nested inside the parent container.
5. After scrolling, log a snapshot of
   `document.querySelectorAll('[data-testid="comment-container"], [data-testid="reply-comment-container"]')[0].getBoundingClientRect()`
   to confirm rects look sane. If the panel has moved (e.g.
   layout shift to a bottom drawer on mobile), the panel rect
   intersection test will need to follow.

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

* `enabled()` — `panelOpen()`. The panel is a fixed side drawer that
  stays in the DOM when collapsed, with zero width and height; that's
  the open test. Everything but `c` waits for it.
* `comments()` — `comment-container` and `reply-comment-container`
  testids within the panel.
* `body()` — the `<p id="comment-content-N">` holding the text, so a
  comment stops being "current" once only its header/avatar/footer is
  on screen.
* `parentOf()` — the nearest enclosing comment container of *either*
  kind (`comment-container` or `reply-comment-container`). Replies sit
  inside their parent's reply-list-threading div, itself inside the
  parent's container, so the nearest enclosing comment is the
  immediate parent at any depth. See below.
* `container()` + `strategy: 'container'` — the panel scrolls in its
  own `overflow-y: scroll` descendant, found by computed style since
  the class is a CSS-module hash. Both the scroll and the
  current-comment test work against that element rather than the
  window.
* `headerOffset()` — see below.
* `commentsTop()` — the panel's `<header>`. **Returns null while the
  panel is closed**, since the panel element still exists at zero size
  and returning an anchor from it would make `c` scroll to a hidden
  drawer instead of opening it.
* `open` — `#comment-button-header`. An article has several copies of
  the "Read N comments" button; any toggles the same panel, and the
  header one is always present when the article has comments.

### Threads go deeper than two levels

Before version 1.1.0 this script resolved a reply's parent with
`el.closest('[data-testid="comment-container"]')` — the nearest
**top-level** container, which is the thread root by definition. On a
two-level thread the root *is* the parent, so it looked correct.

NYT threads go at least three deep (a reader replies to a reply). At
that depth `p` from the third-level comment jumped straight past its
actual parent to the root. `parentOf` now looks for the nearest
enclosing comment of either kind, which is the immediate parent at any
depth, and `r` correspondingly stops being a synonym for `p`.

### Sticky-header offset

The panel has a `position: sticky` header — close button, search box,
tab strip, about 73px — overlaying the top of its scroll viewport.
Aligning to the panel top leaves the target's first line behind it.

The element is another CSS-module hash, so instead of a selector we
measure whatever is sticky and pinned at the top of the panel. That
walks every node in the panel, and the library asks for the offset
more than once per keypress, so the result is cached for 100ms — long
enough to cover one keypress, short enough that a resize or a
collapsing header is picked up immediately.
