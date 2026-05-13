# Pinkbike: better comment navigation

## Summary

Add keyboard shortcuts for moving through the comments section of a
Pinkbike news article.

## Visible changes

* Keyboard shortcuts (active anywhere on the article page, except
  while typing in an input/textarea/contenteditable):
  - `j` — next comment (in display order, replies counted)
  - `k` — previous comment
  - `p` — jump to the parent (root) of the current reply; no-op on a
    root comment
  - `n` — jump to the root of the next thread
  - `c` — jump to the `N Comments` line at the top of the comments
    section
* All jumps use smooth scrolling. The script does not modify any
  visible markup — only attaches a `keydown` listener.

## Implementation

### What Pinkbike's comment page looks like

The comments section is wrapped in `<div class="news-comments-container">` whose first child (`.news-comments`) has the `N
Comments` count. The thread tree itself lives in
`<div id="comment_wrap">` inside that container.

There is also a `<span id="commenttop">` further up the page, used
by Pinkbike's own "N Comments" link in the article header. In some
sessions (logged-in users, ads enabled) related-articles tiles and
an "Online Deals" widget get injected between `#commenttop` and the
actual comments — anchoring `c` to `#commenttop` then leaves that
filler at the top of the viewport. We target `.news-comments-
container` instead, which is always the start of the comments UI.

Threads are flat — exactly one level of replies:

- Each top-level thread is wrapped in
  `<div id="pp<id>" class="ppcont">`.
- Inside a `.ppcont`, the first `<div class="cmcont comment2 ...
  goodcomm">` is the root comment.
- Subsequent `<div class="cmcont comment2 ... commentreply2
  goodcomm">` siblings inside the same `.ppcont` are the replies.
  The `commentreply2` class distinguishes a reply from a root.
- Every `.cmcont` carries `id="cm<id>"` matching Pinkbike's internal
  comment id. There is also an `<a name="cid<id>">` immediately
  before each `.cmcont` (used by the per-comment `.time` permalink).
- No deeper nesting class exists — only `commentreply2`. (Confirmed
  by grepping a captured snapshot: every reply class on the page
  ends in `2`.)

### What we assume stays stable

The script breaks if any of these change:

1. `.news-comments-container` wraps the comments UI; `#commenttop`
   exists as a fallback anchor.
2. `.ppcont` wraps each thread; `.cmcont` is the comment element;
   `.commentreply2` distinguishes replies from roots.
3. Each `.cmcont` has a usable `id` (`cm<n>`), used only in log
   output today, but assumed for diagnostics.
4. Threads stay flat (one level of replies). If Pinkbike ever
   introduces nested replies, `p` (jump to parent) will need to walk
   up the reply chain instead of jumping straight to the root, and
   `j`/`k` may need a "skip subtree" variant.
5. The script runs at `document-idle` and the comments are
   server-rendered — present at load time. No `MutationObserver`.

### How we modify the page

We do not modify the DOM. The script:

1. Records a `window.__pbNavLoaded` guard so a second run is a no-op.
2. Attaches a single `keydown` handler to `document`.
3. The handler ignores modifier-key combos (Ctrl/Meta/Alt) and key
   presses while focus is inside an input/textarea/select/
   contenteditable, so site forms (reply, search) keep working.

For each keypress:

* `j` / `k` — find the "current" comment (first `.cmcont` whose
  bounding rect intersects the viewport), then `scrollIntoView` the
  next/previous `.cmcont` in document order. If no current is found
  (comments not on screen yet), `j` jumps to the first comment.
* `p` — find the current; if it's a `.commentreply2`, walk up to its
  enclosing `.ppcont` and scroll to that container's first
  `.cmcont:not(.commentreply2)`. On a root, log and no-op.
* `n` — find the current's enclosing `.ppcont`, walk forward to the
  next `.ppcont` sibling, scroll to its root `.cmcont`.
* `c` — scroll `.news-comments-container` into view (falling back
  to `.news-comments`, then `#commenttop`).

All `scrollIntoView` calls use `{ behavior: 'smooth', block: 'start'
}`.

### Logging

Every action emits a `[pb nav]` log line: which key, which source
and destination comment id (or "no current", "already a root", "no
next thread", etc.). Combined with `init` and the "keys:" summary
line, this lets a future debugging session distinguish "selector
broke" from "edge case at end of list".

### If this breaks in the future

Triage in order:

1. Open DevTools, look for `[pb nav] initializing`. Missing → @match
   or install issue.
2. Press `c`. If the comments container is missing the script logs
   "no comments container found".
3. Press `j`. If `[pb nav] no comments on page` fires, the
   `.cmcont` selector has changed — re-check the comment tree under
   `#comment_wrap`.
4. Press `p` while on a reply. If it logs "is already a root", the
   `commentreply2` class has been renamed or moved off the inner
   `.cmcont`.
