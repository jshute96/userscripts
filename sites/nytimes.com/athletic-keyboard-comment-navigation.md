# The Athletic: Keyboard comment navigation

## Summary

Add keyboard shortcuts for moving through the comments section on a
New York Times "The Athletic" article page.

## Visible changes

* Keyboard shortcuts (active anywhere on the article page, except
  while typing in an input/textarea/contenteditable):
  - `j` — next comment (in display order, replies counted)
  - `k` — previous comment
  - `p` — jump to the root of the current reply's thread; no-op on a
    root comment
  - `n` — jump to the root of the next thread
  - `c` — jump to the `COMMENTS` header at the top of the comments
    section. If the comments haven't been lazy-loaded yet, clicks the
    "Open Comments" pill in the article toolbar so the site loads and
    scrolls there itself.
* All jumps use smooth scrolling. The script does not modify any
  visible markup — only attaches a `keydown` listener.

## Implementation

### What The Athletic's comment page looks like

The Athletic is the comments UI mounted at NYT under
`https://www.nytimes.com/athletic/<id>/<year>/<month>/<day>/<slug>`.
The comments UI is rendered with CSS-module classnames whose suffix
hashes rotate on every deploy (e.g. `Comment_Base__JMxYy`,
`Comment_Reply__dGqAP`). We match by prefix with attribute-substring
selectors: `[class*="Comment_Base"]`, `[class*="Comment_Reply"]`,
`[class*="Comment_BodyContainer"]`.

Threads are flat — exactly one level of replies:

- Each comment is rendered as `<div class="Comment_Base__…">`.
- A reply has both `Comment_Base__…` and `Comment_Reply__…` on the
  same element.
- Roots and replies are siblings in the comments DOM (verified by
  parsing a captured snapshot — no comment appears nested inside
  another). The thread a reply belongs to is the most recent
  preceding non-reply comment in document order.
- The body text lives in a child `[class*="Comment_BodyContainer"]`
  div. We test that div (not the outer wrapper) for viewport
  intersection — the wrapper includes the avatar row, like / reply
  bar, etc., and can stay barely-intersected with the viewport
  after we've visually scrolled into the next comment.
- The comments UI is rooted at `<div id="comments-section">`
  (also carrying an `Article_CommentsWrapper__…` class), but that
  wrapper starts above a sponsored "Connections" puzzle tile, so
  scrolling there leaves the puzzle at the top of the viewport
  instead of the comments. The actual `COMMENTS <count>` banner
  row inside the wrapper carries a class prefixed
  `Comments_CommentBanner_` — that's the anchor we use for `c`,
  with `#comments-section` as a fallback if the banner class is
  ever renamed.
- The Athletic doesn't render any of the comments markup
  (`#comments-section`, banner, or any `Comment_Base` elements)
  until the section scrolls near the viewport. On a fresh article
  load both `c`-anchors above are missing. The article toolbar at
  the top of the page has a `<button aria-label="Open Comments"
  class="Pill_Pill__…">` whose own click handler scrolls the page
  to the comments and triggers the lazy load. When neither anchor
  is present, `c` clicks that button instead of scrolling.

Comments don't carry stable per-item ids in the DOM, so log lines
identify them by index in the flat list (`#3 (reply)`) rather than
a comment id.

The comments are typically lazy-loaded — a "Load more" button at
the bottom expands the list. The script doesn't need to coordinate
with that: every keypress re-queries the live DOM, so newly
appended comments are picked up automatically.

### What we assume stays stable

The script breaks if any of these change:

1. Each comment element has a class starting with `Comment_Base`
   (matched as `[class*="Comment_Base"]`).
2. Replies are distinguished from roots by an additional class
   starting with `Comment_Reply`.
3. Each comment contains a child with a class starting with
   `Comment_BodyContainer` that holds the comment text.
4. The `COMMENTS <count>` banner row inside the comments wrapper
   carries a class prefixed `Comments_CommentBanner_`. As a
   fallback if that class is renamed, the wrapper still has
   `id="comments-section"`.
5. Threads stay flat (one level of replies, roots and replies as
   document-order siblings). If The Athletic introduces nested
   replies, `p` will need to walk up the reply chain instead of
   scanning backward to the most recent non-reply, and `j`/`k` may
   need a "skip subtree" variant (`h`/`l`).

### URL handling

The `@match` is `https://www.nytimes.com/athletic/*`, broad enough
to cover both article pages (where comments exist) and any sibling
paths under `/athletic/`. The script always registers its keydown
listener; the handler queries the DOM on every keypress, so on
non-article pages it simply logs `no comments on page` and does
nothing. NYT navigates between articles client-side, so a narrow
article-only `@match` would miss in-app navigations (see the SPA
notes in the repo's `CLAUDE.md`); the broad `@match` plus
DOM-time gating avoids that problem without needing URL-change
detection.

### How we modify the page

We do not modify the DOM. The script:

1. Records a `window.__athleticNavLoaded` guard so a second run is
   a no-op.
2. Attaches a single `keydown` handler to `document`, plus passive
   `wheel` / `touchmove` listeners on `window` used only for jump-
   target invalidation (see "Chained presses" below).
3. The handler ignores modifier-key combos (Ctrl/Meta/Alt) and key
   presses while focus is inside an input/textarea/select/
   contenteditable, so site forms (reply, search) keep working.

For each keypress:

* `j` / `k` — find the "current" comment, then `scrollIntoView` the
  next / previous comment in document order. If no current is
  found, `j` jumps to the first comment.
* `p` — find the current; if it's a reply, walk backwards through
  the flat comment list to the most recent non-reply and scroll to
  it. On a root, log and no-op.
* `n` — find the current; walk forward through the flat list to
  the next non-reply and scroll to it. If nothing is on screen,
  jump to the first root.
* `c` — scroll the `Comments_CommentBanner_…` row (the
  `COMMENTS <count>` header) into view, falling back to the
  `#comments-section` wrapper if the banner class is missing.
  If neither exists (comments not lazy-loaded yet), `.click()`
  the `button[aria-label="Open Comments"]` pill in the article
  toolbar; the site's own handler scrolls the page and triggers
  the comments to render.

All `scrollIntoView` calls use `{ behavior: 'smooth', block:
'start' }`.

### Chained presses during a smooth scroll

"Current" comment selection is more than just the topmost-in-
viewport check. With `behavior: 'smooth'`, the viewport hasn't
caught up to the scroll target by the time a chained keypress
fires; using the on-screen position would make every rapid `j`
press re-target the same comment instead of advancing. So the
script also remembers the most recent comment it jumped to
(`lastJumpTarget`) and treats that as "current" until something
invalidates it. The invalidators:

* `wheel` and `touchmove` on the window — the user is scrolling
  the page themselves, so the keyboard cursor should follow the
  new viewport position.
* Any non-nav `keydown` (PageUp/PageDown, arrows, Home/End,
  space, etc.) — same reason: those keys move the viewport.

Without this, `j j j j` only advances by one (re-targeting the
same comment three times) and `n n n` never moves past the first
next-root.

### Logging

Every action emits an `[athletic nav]` log line: which key, which
source and destination comment (by 1-based index and root/reply
flag), or an explanation when nothing happened (`no comments on
page`, `already a root`, `no next thread`, etc.). Combined with
`init` and the "keys:" summary line, this lets a future debugging
session distinguish "selector broke" from "edge case at end of
list".

### If this breaks in the future

Triage in order (see `CLAUDE.md` → "When a script stops working"
for the general process):

1. Open DevTools, look for `[athletic nav] initializing`. Missing
   → `@match` or install issue.
2. Press `c` while the comments section is fully off-screen. If
   it logs `no comments anchor or open button found`, the
   `aria-label="Open Comments"` selector has broken — find the
   toolbar pill in DevTools (it lives in the article header and
   shows a chat icon + count) and update `SEL.openButton`. If it
   logs `no comments anchor found` while comments are visible on
   screen, both the `Comments_CommentBanner_` class prefix and
   the `#comments-section` id have changed; update
   `SEL.sectionTop`.
3. Press `j`. If it logs `no comments on page`, the
   `Comment_Base` class prefix has been renamed; re-check the
   comment markup and update `SEL.comment`.
4. Press `p` while on a reply. If it logs `is already a root`,
   the `Comment_Reply` class prefix has been renamed or moved off
   the comment element; update `SEL.reply`.
5. If `j`/`k` feel one comment "off" (current detection seems to
   lag the actual viewport), re-check the
   `Comment_BodyContainer` class prefix — falling back to the
   wrapper rect changes the viewport-intersection answer.
