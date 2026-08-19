# The Athletic: Keyboard comment navigation

## Summary

This adds keyboard shortcuts for navigating comment threads on The Athletic.

`c` opens the comments, `j` / `k` go to next / previous. Other keys are listed below.<br>
`?` opens help showing all the keys.

Scripts adding the [same key bindings for several other sites are available here](https://github.com/jshute96/userscripts/blob/main/README.md#keyboard-comment-navigation).

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `c` | Open the comments, loading them if needed |
| `j` / `k` | Go to next / previous comment |
| `h` / `l` | Go to next / previous comment at this level, skipping the current subtree |
| `p` | Go to parent comment |
| `r` | Go to root comment of this thread |
| `n` | Go to next comment at parent level |
| `m` | Go to next comment at root level |
| `?` | Show all shortcuts on this page, from this and any other userscript |

Keys work anywhere on the article page.

## Visible changes

* The keyboard shortcuts above, using smooth scrolling.
* `c` on a page whose comments haven't been lazy-loaded yet clicks the
  "Open Comments" pill in the article toolbar, so the site loads and
  scrolls there itself.
* No other visible markup changes — the script only attaches a
  `keydown` listener.

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
   resolving to the most recent non-reply, and `j`/`k` may
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

* `comments()` — `[class*="Comment_Base"]`. The Athletic uses
  CSS-modules with hashed suffixes that rotate every deploy, so every
  selector here is a prefix match.
* `body()` — `[class*="Comment_BodyContainer"]`.
* `parentOf()` — threads are one level deep *and flat in the DOM*:
  roots and replies are siblings in document order rather than nested.
  So a reply's parent is the nearest preceding non-reply. Tracked in
  one left-to-right pass through `CommentNav.parentMapper` rather than
  scanned backwards per comment, which would be O(n) inside the
  library's O(n) sibling scan.
* `headerOffset()` — NYT sets `scroll-padding-top` on `<html>` to
  clear its fixed top nav; we reuse that value so a comment mostly
  hidden behind the nav isn't treated as "current".
* `commentsTop()` — `[class*="Comments_CommentBanner"]`, falling back
  to `#comments-section`. The banner is preferred because
  `#comments-section` sits above it with a sponsored puzzle tile in
  between, which is not where `c` should land.
* `open` — `button[aria-label="Open Comments"]`. The Athletic doesn't
  render the comments markup until it scrolls near the viewport, so
  when neither anchor exists we click the pill and let the site load
  and scroll there itself.