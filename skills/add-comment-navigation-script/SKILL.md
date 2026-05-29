---
name: add-comment-navigation-script
description: Write a userscript that adds keyboard navigation to the comments section of a forum or news site. Use when the user asks to add comment navigation to a site, matching the behavior of other scripts in this repo. Covers the canonical key bindings and behavior.
---

## When to use

The user has comment-navigation userscripts on a few sites (HN, Pinkbike) and
wants the same on another site. The keys and behavior should match what they
already have, so they don't have to learn a different set per site.

Existing references in the repo (read whichever is closest in structure to the
new site before starting):
- `sites/news.ycombinator.com/keyboard-comment-navigation.user.js` — nested
  threads, server-rendered, full key set, rebuilds existing nav links.
- `sites/pinkbike.com/keyboard-comment-navigation.user.js` — flat threads,
  server-rendered, minimal key set.
- `sites/nytimes.com/keyboard-comment-navigation.user.js` — flat threads in a
  fixed side-panel drawer with its own scroll container and a sticky header
  inside.
- `sites/nytimes.com/athletic-keyboard-comment-navigation.user.js` — flat
  threads, CSS-module hashed classnames (matched by prefix).
- `sites/reddit.com/keyboard-comment-navigation.user.js` — nested
  `<shreddit-comment>` custom-element tree, SPA, overrides reddit's own
  `j`/`k` via capture-phase + `preventDefault`.
- `sites/washingtonpost.com/keyboard-comment-navigation.user.js` — Coral
  comments in a portal-rendered drawer inside an open shadow root; `c` opens
  the drawer when it's closed.

## Desired behavior

Bind a `keydown` listener on `document`. Skip the handler when:
- Any of Ctrl / Meta / Alt is held.
- Focus is inside an `input`, `textarea`, `select`, or `contenteditable`
  element (so site forms — reply box, search — still work).

The "current" comment for keyboard actions is **the first comment whose body
intersects the viewport**, not whichever has focus. Pick the most natural body
element for the site (e.g. the actual comment text container) for viewport
testing, not the outer wrapper — the wrapper's header may be scrolled off
while the body is still visible.

All scrolling uses `scrollIntoView({ behavior: 'smooth', block: 'start' })`.

### Canonical keys

| Key | Action | Notes |
|---|---|---|
| `j` | next comment in display order (replies counted) | Walk the flat list of comments in the order they appear on screen. |
| `k` | previous comment in display order | |
| `h` | next sibling at the same depth (skip subtree) | Only meaningful on nested threads. On flat sites, omit. |
| `l` | previous sibling at the same depth (skip subtree) | Same as above. |
| `p` | parent of the current comment | No-op (with a log line) if already at a root. |
| `n` | parent's next sibling (i.e. continue past current subtree) | On a top-level comment, fall back to "next root thread". |
| `r` | root of the current thread | No-op on a root. |
| `m` | next root thread | Skips the rest of the current thread entirely. |
| `c` | top of the comments section | See "`c` when comments aren't loaded" below. |

If the site's threads are flat (one level of replies, like Pinkbike), only
`j` / `k` / `p` / `n` / `c` apply — drop `h`, `l`, `r`, `m`.

### `c` when comments aren't loaded

Some sites (e.g. Washington Post) don't render comments inline — there's a
Comments button that opens a separate pane / drawer on click. For those:

- If the comments pane isn't open yet, `c` should locate that button and click
  it. (Don't scroll the page to the button unless necessary.)
- If the pane is already open, `c` scrolls to the top of the comments
  ("N comments" header / banner inside the pane), same as normal.
- The other keys (`j`/`k`/etc.) should silently do nothing while the pane is
  closed.

Use the presence of a stable marker (the drawer wrapper, the shadow host,
etc.) as the "is the pane open" check — don't try to track open/close events.

## Common gotchas

Things that have bitten us on at least one site each — verify each one
manually after the first pass.

### Scroll target sits behind a sticky/fixed header

Many sites have a sticky banner (the site's top nav, or a sticky header
*inside* the comments panel: search box, tab strip, "N comments" row). A
plain `scrollIntoView({ block: 'start' })` puts the target at viewport-top,
which is *behind* that header — the first line of the comment is hidden.

Verify by pressing `j` repeatedly and watching whether each landing comment's
first line is fully visible. If it's clipped, offset by the header height.
Two ways:

- Inject a stylesheet that puts `scroll-margin-top: <header height>` on every
  element you scroll to. Cheapest fix when the header height is a CSS
  variable (Reddit exposes `--shreddit-header-height`).
- Manually compute target scrollTop on the scroll container, subtracting the
  header offset. Necessary when the panel has its own scroll container or
  when the header is `position: sticky` inside the panel (NYT). Find the
  sticky header dynamically (walk descendants for one whose computed
  `position` is `sticky` or `fixed` and which sits at the top of the panel)
  rather than hardcoding a class — the class is usually a CSS-module hash.

### `j` / `k` get stuck on the same comment

Symptom: pressing `j` once works; pressing it again finds the *same* comment
and doesn't progress. Three causes, all worth checking on every new site:

1. **Viewport detection is anchored on the wrong element.** If the comment
   wrapper element encloses the whole subtree (body + nested replies + reply
   bar), it stays "intersecting the viewport" long after the user has
   visually scrolled into the next comment, because its bottom is far down
   the tree. **Anchor viewport intersection on the comment's body text
   element**, not the outer wrapper — pick a child that holds just the
   prose. On sites with CSS-modules this is usually a `[class*="Body"]` or
   similar.
2. **The strip behind the sticky header counts as "intersecting".** A
   comment that's just been scrolled past has `top < 0` but `bottom >
   header_height > 0`, so a naïve `rect.bottom > 0 && rect.top <
   viewport.height` check still picks it up. Require the body to be
   meaningfully below the header bottom (e.g. 30+ px of the bottom of the
   body's rect lies below `panel_top + header_offset`).
3. **Smooth scrolling lags the keypress.** With
   `behavior: 'smooth'`, the viewport hasn't caught up to the previous
   scroll target by the time the next keypress fires. A pure viewport
   check re-picks the same source comment, recomputes the same target,
   and re-issues a `scrollIntoView` to the same place — visually it
   looks like the script is doing nothing. Fix: remember the last
   comment the script scrolled to (`lastJumpTarget`) and treat it as
   "current" on the next keypress. Invalidate it on any sign the user
   moved the viewport themselves: passive `wheel` + `touchmove` on
   `window`, and any non-nav `keydown` (PageUp/PageDown, arrows, Home/
   End, space). The Athletic script is the canonical implementation;
   without this, `j j j j` advances by one and `n n n` never moves
   past the first next-root.

Test by pressing `j` 5–10 times in a row and confirming each press advances
one comment.

### CSS-module classnames with rotating hash suffixes

Sites built on CSS-modules (NYT, The Athletic, WaPo Coral, etc.) emit
classes like `Comment_Base__JMxYy` where the suffix changes every deploy.
**Never hardcode the full class.** Use `[class*="Comment_Base"]` /
`[class*="HTMLContent-root"]` substring selectors and document the prefix
in the script's `.md` doc.

### Custom scroll containers, drawers, shadow DOM

If comments live in a side panel or modal drawer:

- The scrollable element isn't `window`; viewport rects must be compared to
  the panel's `getBoundingClientRect()`, not `window.innerHeight`.
- `scrollIntoView({ behavior: 'smooth' })` sometimes silently no-ops on
  fixed-position drawers with `scrollbar-gutter: stable` (observed in WaPo).
  Fallback: small rAF easing that writes `container.scrollTop` directly.
- Shadow DOM: a normal `document.addEventListener('keydown', …)` still
  receives composed events from inside an open shadow root, but `e.target`
  retargets to the shadow host. Use `e.composedPath()` to walk the original
  path for input/contenteditable focus detection.

### Site already binds `j` / `k`

Reddit, GitHub, Gmail, etc. bind their own `j`/`k`. To beat them: register
the listener in **capture phase**, and on each handled key call
`preventDefault()` + `stopImmediatePropagation()`. Don't suppress unrelated
keys — only the ones the script actually handled.

### Hidden / collapsed comments are still in the DOM

A `querySelectorAll` for comment containers will happily return
comments that are inside a collapsed "Show more replies" section,
a hidden tab pane, or any other ancestor with `display: none`. They
have zero-area bounding rects, so:

- Their body never intersects the viewport → they never qualify as
  "current".
- But `j` from a real comment immediately *before* them in DOM order
  picks them as the next target. The scroll then resolves to a
  degenerate position (no visible change), and the next press picks
  them again — `j` looks stuck in a short cycle of scroll positions.

Filter them out at the source — `commentEl.offsetParent === null`
catches any `display: none` ancestor without having to know which
wrapper the site uses for collapsed state (Coral uses
`ReplyListCommentContainer-hiddenReplies`, others differ). This is
distinct from the "current detection" check, which already ignores
zero-rect bodies; the symptom only shows up in the "next target"
selection.

### The comment list can change under you — never cache it

Re-query the comment list inside every keypress handler instead of
caching it at init or first use. The visible set of comments can change
at any moment from any of these:

- "Load more" / "Show replies" lazy expansion.
- SPA navigation between articles (comments are torn down and replaced).
- Comments mounting on demand into a shadow root or portal (Coral, NYT).
- **Filter tabs** (Featured / Top / All / My comments) that swap which
  comments are in the DOM. The user can switch filters between any two
  keypresses; a script that cached the list at init will step through
  ghosts.
- **Sort changes** (Newest first / Oldest first / Top) that keep the
  same set of comments but reorder them. The user's current comment is
  now at a different index, and `j` should advance to its new neighbour,
  not the old one.
- Real-time new comments arriving from other users.

Re-querying each press is cheap (a single `querySelectorAll` in the
shadow root / panel) and handles all of these without subscribing to
filter / sort / pagination events. Combined with viewport-intersection
"current" detection (rather than a stored index), the script stays
correct across every kind of list mutation.

### `c` lands on filler ads / related articles

Sometimes the most obvious anchor (`#commenttop` on Pinkbike) sits above
injected widgets (ads, "Online Deals", "More from this author") that occupy
viewport space. The user wants to land *at the first row of actual
comments*, not at the start of the filler. Prefer an anchor that's the
comments-section root or the "N comments" header itself.

## Script name

Use `keyboard-comment-navigation.user.js` as the script name.
