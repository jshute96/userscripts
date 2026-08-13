# NYT: Keyboard comment navigation

## Summary

Adds keyboard shortcuts for moving through the comments panel on a New
York Times article, so a long discussion can be read without dragging
the panel's scrollbar. As well as stepping comment by comment, you can
jump from a reply back to its parent or skip the rest of a thread —
and `c` opens the panel in the first place.

The bindings match the comment-navigation userscripts for other sites.

### Keyboard shortcuts

| Key | Moves to |
| --- | --- |
| `j` / `k` | next / previous comment in display order, replies included |
| `p` | a reply's parent root comment; does nothing on a root comment |
| `n` | the next root thread, skipping the current thread's remaining replies |
| `c` | opens the comments panel, or jumps to its header if already open |

`j` / `k` / `p` / `n` work only while the panel is open, and all keys
are ignored while you're typing in a text box.

## Visible changes

* The keyboard shortcuts above, scrolling smoothly within the panel's
  own scroll container.
* No visible markup changes — the script only attaches a `keydown`
  listener. Keys are ignored while focus is in an
  input/textarea/contenteditable.

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
* Replies are flat — exactly one level. Pressing the "Replies N"
  button on a top-level comment expands an inline reply list:
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
4. Threads stay flat — one level of replies. If NYT adds nested
   replies, `p` will need to walk up the reply chain instead of
   jumping straight to the root, and `n` (which scans top-level
   roots) will need rework.
5. The panel header is the panel's first `<header>`, used as the
   anchor for `c`.

### How we modify the page

We do not modify the DOM. The script:

1. Records a `window.__nytCNavLoaded` guard so a duplicate run is a
   no-op.
2. Attaches a single `keydown` handler to `document`.
3. The handler ignores modifier-key combos (Ctrl/Meta/Alt) and key
   presses while focus is inside an
   input/textarea/select/contenteditable. `c` is always allowed
   through — it opens the panel when closed. `j` / `k` / `p` /
   `n` only act when the panel is open (the panel element is
   removed from the DOM while closed, so `panel()` returning null
   is the gate). The `@match` covers all of `nytimes.com/*`, so
   when the user is on the front page or a non-article page the
   `j`/`k`/`p`/`n` keys are silently ignored; `c` will also no-op
   because the "Read N comments" button doesn't exist there.

For each keypress:

* `j` / `k` — find the "current" comment (see below), then
  `scrollIntoView` the next/previous container in document order
  across the combined list of top-level and reply containers. If
  no current is found (panel scrolled above all comments), `j`
  jumps to the first comment.
* `p` — find the current. If it's a reply, walk up to
  `closest('[data-testid="comment-container"]')` (the parent root)
  and scroll to it. On a root, log and no-op.
* `n` — find the current, derive its enclosing root (itself if a
  top-level, parent root if a reply), find the next top-level
  container in document order, scroll to it.
* `c` — if the panel is closed, click the "Read N comments"
  button (`#comment-button-header`) to open it; otherwise scroll
  the panel's `<header>` into view.

All scrolls go through `smoothScrollTo`, which manually computes
the target scrollTop on the panel's scroll container and uses
`scrollTo({ behavior: 'smooth' })`. We can't use
`scrollIntoView({ block: 'start' })` because the panel has a
`position: sticky` header (close button + search box + tabs,
~73 px tall) that overlays the top of the scroll viewport. A
`block: 'start'` alignment lands the target at the panel top —
behind the header — so the comment's first line ends up cut off.
Instead we compute `target = scroller.scrollTop + (elemTop -
scrollerTop) - headerOffset` so the element sits just below the
sticky header.

`headerOffset()` walks the panel for any descendant with
`position: sticky` whose top is at or above the panel's top and
takes the bottom-most match. This is dynamic because the sticky
header's exact class is a hashed CSS-module name (currently
`css-pzragr`) that we don't want to hardcode.

Smooth scrolling is animated by the browser and only progresses
while the document is visible — fine for end users, but if you
test via CDP on a backgrounded tab you'll see the script's logs
without any actual scroll motion. Force `Page.bringToFront`
before evaluating scroll tests.

### Finding the "current" comment

The intuitive rule — "the first comment whose body intersects the
viewport" — is too lax in NYT's layout. When a reply has been
scrolled to the top of the panel, the parent's
`<p id="comment-content-N">` body is still slightly above with a
small sliver (~25–30 px) overlapping the visible area, because
the parent's `comment-container` wraps the reply list. That
sliver makes a pure-intersect test latch onto the parent, so `p`
would log "already a root" instead of jumping to the parent.

We require at least `CURRENT_MIN_VISIBLE = 30` pixels of the
body's bottom to lie below the *header bottom* (panel top +
`headerOffset()`) before considering it current. That excludes
both a barely-visible parent body and any comment hidden behind
the sticky header, and lets the fully-visible reply body take
over.

Comparisons use the panel's `getBoundingClientRect`, not
`window.innerHeight`, because the panel only occupies a portion
of the screen width and has its own scroll container.

### Logging

Every action emits a `[nyt cnav]` log line: which key, which
source and destination comment id (or "no current", "already a
root", "no next root", etc.). Combined with the `init` and
`keys:` summary lines, this lets a future debugging session
distinguish "selector broke" from "edge case at end of list".

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
