# Pinkbike: Keyboard comment navigation

## Summary

Adds keyboard shortcuts for moving through the comments on a Pinkbike
article, so a long discussion can be read or skimmed without reaching
for the scroll wheel. As well as stepping comment by comment, you can
jump to a reply's parent or skip the rest of a thread.

The bindings match the comment-navigation userscripts for other sites.

### Keyboard shortcuts

| Key | Moves to |
| --- | --- |
| `j` / `k` | next / previous comment in display order, replies included |
| `p` | the parent (root) of the current reply; does nothing on a root comment |
| `n` | the root of the next thread |
| `c` | the top of the comments section |

Keys work anywhere on the article page, and are ignored while you're
typing in a text box.

## Visible changes

* The keyboard shortcuts above, using smooth scrolling.
* No visible markup changes — the script only attaches a `keydown`
  listener. Keys are ignored while focus is in an
  input/textarea/contenteditable.

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
}`, via `scrollToTopSettled()` — see below.

### Drift correction after the scroll

`scrollIntoView` resolves its destination to a fixed scroll offset at
call time and animates to that number. Pinkbike lazy-loads article
images and injects ad / "deals" slots as you go down the page, so
anything that finishes loading *above* the target during the ~1s
animation pushes the target further down the document and we stop
short of it. Measured on a normal news article, `c` from the top of
the page landed 100–200px above the comments header, in the
related-articles filler.

`scrollToTopSettled(el)` handles this: it issues the smooth scroll,
then polls on `requestAnimationFrame` until `scrollY` holds steady
for a few frames, re-measures `el.getBoundingClientRect().top`, and
re-issues the scroll if it's off by more than 4px. Up to 3
corrections, with a 4s overall timeout; both the give-up and the
timeout log.

Two cases where "the target isn't at the top" is not drift, and
correcting would be wrong:

* **The scroll is clamped.** Every comment within one viewport height
  of the document end — on a typical article that's the last several
  — can't be brought to the top, because the page has already
  scrolled as far as it goes. Measured on a 66-comment article, the
  last comment settles 331px down at maximum scroll. `scrollIsClamped()`
  checks `scrollY` against `scrollHeight - innerHeight` (and against
  0 for the top edge) and stops silently; without it, every `j` into
  the tail of a thread would burn three corrections and log a
  failure for a jump that worked correctly.
* **The animation hasn't started yet.** Chrome takes a frame or two
  to begin a smooth scroll, and "scrollY hasn't moved" is true during
  that window. `SETTLE_GRACE_MS` (250ms) keeps the first settle check
  from firing until the animation is genuinely under way.

A monotonically-increasing `correctionToken` guards it. Starting a
new jump, or anything that calls `invalidateJumpTarget()` (user
`wheel` / `touchmove`, a non-nav keypress), bumps the token and the
in-flight polling loop exits on its next frame — so the correction
never fights a user who has started scrolling themselves.

### Chained presses during a smooth scroll

A pure viewport-intersection test re-targets the same comment on
chained keypresses: with `behavior: 'smooth'`, the viewport hasn't
caught up to the previous scroll target when the next `j` fires, so
`j j j j` would advance by one. We remember the last comment we
scrolled to (`lastJumpTarget`) and treat it as "current" until
something invalidates it: passive `wheel` / `touchmove` on the
window, or any non-nav keypress (PageUp/Down, arrows, space, etc.).
See the `add-comment-navigation-script` skill for the canonical
treatment.

### Hidden / collapsed comments

`commentRows()` filters with `el.offsetParent === null` so any
`.cmcont` inside a `display: none` ancestor (a collapsed thread, a
hidden tab) is excluded. Without this, `j` from a comment
immediately before a hidden one would target the hidden comment,
the scroll would no-op, and the next press would pick it again —
classic "stuck" behavior.

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
