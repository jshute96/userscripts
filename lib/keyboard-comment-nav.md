# keyboard-comment-nav.js

A shared `@require` helper implementing this repo's comment-thread
keyboard navigation.

```js
// @require https://raw.githubusercontent.com/jshute96/userscripts/main/lib/keyboard-shortcuts.js
// @require https://raw.githubusercontent.com/jshute96/userscripts/main/lib/keyboard-comment-nav.js
```

Order matters: this file calls into `keyboard-shortcuts.js`. The
manager runs required files sequentially in the userscript's own
sandbox before the body, so the second sees the first.

## Summary

The comment-thread navigation shared by every site in this repo that
has it. A site config supplies its selectors and one tree accessor,
`parentOf`; this file supplies all nine keys and everything behind
them — which comment counts as current, how the page scrolls, which
comments are eligible, and the log lines.

### The keys

| Key | Action |
| --- | --- |
| `c` | Open the comments |
| `j` | Go to next comment |
| `k` | Go to previous comment |
| `h` | Go to next comment at this level |
| `l` | Go to previous comment at this level |
| `p` | Go to parent comment |
| `r` | Go to root comment of this thread |
| `n` | Go to next comment at parent level |
| `m` | Go to next comment at root level |

Plus `?` for the shared help overlay, from `keyboard-shortcuts.js`.

Registration order is what the help screen shows, so it runs outward:
get to the comments, move within one, then up, then past.

### Every key works on every site

Sites differ in how deep their threading goes, but all nine keys are
bound everywhere and each does the most sensible available thing. The
duplication in shallow cases is deliberate — there's one set of keys
to learn, not one per site.

| Key | Nested threads | One level of replies | Flat comments |
| --- | --- | --- | --- |
| `j` / `k` | next / previous comment | same | same |
| `h` / `l` | next / previous sibling | between roots, or between replies within a thread | same as `j` / `k` |
| `p` | parent | reply → its root; root → nothing | nothing |
| `n` | parent's next sibling | next thread (same as `m`) | same as `j` |
| `r` | thread root | reply → its root (same as `p`) | nothing |
| `m` | next thread | next thread | same as `j` |

`p` and `r` mean "go up", and there's no up from a root — so on a root
they log that they have nowhere to go and don't scroll.

## Visible changes

* All nine keys are bound on every site that uses this library.
* Hidden comments (collapsed threads, inactive filter tabs) are never
  jumped to.
* Repeated presses keep advancing instead of stalling while a smooth
  scroll is still animating.

## Implementation

### The tree model

The entire model is a flat display-ordered list of comments plus
`parentOf(el)`. Depth, thread root, next thread, and skip-past-subtree
all derive from those two:

```js
depthOf = el => { let d = 0; while ((el = parentOf(el))) d++; return d }
rootOf  = el => { while (parentOf(el)) el = parentOf(el); return el }
rootsOf = () => all.filter(c => !parentOf(c))
```

The level moves (`h`, `l`, `n`, `m`) are then a single primitive:
scan display order from the current comment for the first one no
deeper than a given depth — the current depth for `h`/`l`, one less
for `n`, zero for `m`.

Indexing into a sibling list would be the obvious implementation and
is the wrong one: it dead-ends. On a thread's last reply `h` found no
next sibling and reported "nowhere to go" with half the page still
below, and `n` did the same whenever the *parent* was itself a last
child. Scanning by depth escalates on its own, and where a sibling
does exist it *is* the first comment at or above the current depth
(everything in between is a descendant), so the common case is
unchanged.

Nothing is skipped in either direction. Forward, the comments passed
over are the current subtree; backward, they're the previous sibling's
subtree — and from a first child the previous comment at or above its
depth is the parent itself, which is why `l` there behaves like `p`.

Depth also carries the degradation: with no `parentOf`, every comment
is at depth zero, so `h` naturally becomes `j`.

`parentOf` returns live DOM elements, so identity comparison is valid.

`depthOf` and `rootsOf` call it once per comment, so a `parentOf`
that *scans* the comment list to find the parent makes them quadratic.
Sites in that shape derive the whole map in one left-to-right pass and
wrap it in `CommentNav.parentMapper`:

```js
parentOf: CommentNav.parentMapper(all => {
  const map = new Map();
  // … one pass, map.set(comment, parent) …
  return map;
})
```

The library builds the comment array fresh on each keypress and passes
that same array everywhere, so keying the cache on it gives exactly one
build per keypress and O(1) lookups within it. A `WeakMap` means the
entry dies with the array. Sites whose parent is a DOM ancestor
(`closest`) are already cheap and don't need it.

### Site config

| Field | Required | Meaning |
| --- | --- | --- |
| `tag` | yes | Log prefix. |
| `comments()` | yes | Flat, display-ordered list of comment elements. |
| `body(el)` | | Element used for viewport intersection. Defaults to `el`. |
| `parentOf(el, all)` | | Parent comment, or null. Defaults to null — a flat site. |
| `id(el)` | | Label for logs. Defaults to `#<index>`. |
| `commentsTop()` | | Element `c` scrolls to. |
| `open` | | `{ canOpen(), click() }` for sites that don't render comments until a button is clicked. |
| `enabled()` | | Gate for everything but `c` (panel open, on a comments page). |
| `container()` | | Scroll container, when comments have their own. |
| `headerOffset()` | | Sticky-header height to offset scrolls and the current-comment test by. |
| `strategy` | | Scroll strategy, below. |
| `capture` | | Passed through to `keyboard-shortcuts.js`. |

### Current-comment detection

The "current" comment is the first one whose **body** intersects the
viewport — never whichever has focus. Anchoring on the body rather
than the comment container matters: a container wraps the whole
subtree plus header and reply bar, so it stays intersecting long after
the user has visually scrolled into the next comment, and `j` gets
stuck.

A comment must have `MIN_VISIBLE_PX` (30) of its body visible *below*
`headerOffset()` to qualify. Without that slack, a comment that's just
been scrolled past still has a sliver bleeding behind the sticky
header, so a naive `bottom > 0` test re-picks it and `j` stalls.

`lastJumpTarget` holds the comment we most recently scrolled to and is
treated as "current" on the next keypress. With smooth scrolling the
viewport hasn't caught up when the next key arrives, so a pure
viewport check would re-pick the same source, recompute the same
target, and look like the script is doing nothing. It's invalidated by
`wheel`, `touchmove`, and any unbound keypress (PageDown, arrows,
space) — all signs the user moved the viewport themselves.

### The comment list is never cached

`comments()` is re-queried on every keypress. The visible set can
change from lazy "show replies" expansion, SPA navigation, filter tabs,
sort changes, or new comments arriving, and re-querying handles all of
them without subscribing to any site event. Results are filtered by
`offsetParent !== null` to drop comments inside a `display: none`
ancestor — they have zero-area rects so they never qualify as
"current", but `j` from the comment before them would pick them as a
target and the scroll would resolve to a degenerate position, looking
exactly like `j` being stuck.

### Scroll strategies

These differ between sites for real reasons, so this stays pluggable:

* `intoView` (default) — plain `scrollIntoView` on the window, or a
  computed `window.scrollTo` when `headerOffset()` is non-zero, since
  `scrollIntoView` has no offset option.
* `settle` — `intoView` plus drift correction. `scrollIntoView`
  computes its destination once and animates to that fixed offset; a
  page that lazy-loads images and injects ad slots keeps growing
  *above* the target during the animation, so we land short. After the
  scroll settles, re-measure and re-issue if the target moved. Bails
  when the scroll is clamped at the document end — that's the browser
  doing all it can, not drift.
* `container` — `scrollTo` on the panel's own scroll container.
* `raf` — hand-rolled cosine easing writing `container.scrollTop`
  directly, for containers where both `scrollIntoView` and `scrollTo`
  silently no-op (observed on WaPo's fixed drawer with
  `scrollbar-gutter: stable`).

Both container strategies fall back to a window scroll, with a log
line, when `container()` comes up empty. A site's container lookup is a
search — NYT walks the drawer for a computed `overflow-y`, WaPo walks
composed ancestors for a scrollable host — and either can fail against
a redesign. Landing in roughly the wrong place beats throwing out of
the keydown handler, where nothing surfaces without DevTools open.

### Logging

Every action logs `<tag> <key>: <action> -> <target>`, or
`<key>: <action> — nowhere to go from <target>`. The shape is
identical across sites, so a spec (or a person) can grep for it
without knowing which site it came from.

### `c`

`c` scrolls to `commentsTop()`. When that returns nothing and the site
provides `open`, it clicks the button that renders the comments
instead. If neither is available its `when` predicate returns false, so
the keystroke passes through to the site rather than being swallowed.

It deliberately does **not** set `lastJumpTarget`: `c` means "go to the
top of the section", and the next `j` should advance from whatever
comment the viewport actually lands on.
