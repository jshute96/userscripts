# Hacker News: Keyboard comment navigation

## Summary

This adds keyboard shortcuts for navigating comment threads on Hacker News.

`c` jumps to the first comment, `j` / `k` go to next / previous. Other keys are listed below.<br>
`?` opens help showing all the keys.

HN already puts `next | prev | parent | root` links on each comment,
but those are mouse-only, and `next` / `prev` step over whole
subtrees, with no way to move to the comment just below the one
you're reading.

Scripts adding the [same key bindings for several other sites are available here](https://github.com/jshute96/userscripts/blob/main/README.md#keyboard-comment-navigation).

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `c` | Go to the first comment |
| `j` / `k` | Go to next / previous comment |
| `h` / `l` | Go to next / previous sibling at the same depth, skipping the current subtree |
| `p` | Go to parent comment |
| `r` | Go to root comment of this thread |
| `n` | Go to next comment at parent level |
| `m` | Go to next comment at root level |
| `?` | Show all shortcuts on this page, from this and any other userscript |

## Visible changes

* The keyboard shortcuts above, using smooth scrolling.
* No markup changes — the script only attaches a `keydown` listener.
  Collapsed threads are skipped over rather than jumped into.

## Implementation

The navigation itself lives in
[`lib/keyboard-comment-nav.js`](../../lib/keyboard-comment-nav.js),
shared with the other comment-navigation scripts; key dispatch and the
`?` overlay come from
[`lib/keyboard-shortcuts.js`](../../lib/keyboard-shortcuts.js). What's
here is HN's site config.

### What HN's comment page looks like

Each comment is a single `<tr class="athing comtr" id="<commentId>">`.
The numeric id is HN's internal item id.

Inside the row:

* `<div class="comment">` holds the comment body. Viewport
  intersection is tested against it rather than the row, because the
  row also holds the metadata header and reply link and would stay
  "intersecting" long after the text has scrolled past.
* `<td class="ind" indent="N">` is the indent spacer in the row's
  first cell, holding `<img src="s.gif" width="N*40">`. **This is
  where the reply tree lives** — HN renders comments as a flat list of
  sibling `<tr>`s with no nesting, so depth is encoded only in that
  spacer.

### Deriving the tree from indentation

The shared library needs one accessor, `parentOf`. A row's parent is
the nearest preceding row at a shallower depth, which is a single
left-to-right pass keeping a stack of the most recent row seen at each
depth.

Resolving that per call would be O(n) inside the library's O(n)
sibling scan, so the map is built in one pass and handed to
`CommentNav.parentMapper`, which caches it for the duration of a
keypress — one build per keypress, none for repeat lookups within it.
Measured fine on an 835-comment thread.

`indent` is read from the attribute, falling back to the image width
divided by 40 for older markup.

### What we assume stays stable

1. `tr.athing.comtr` rows enclose comments and have stable `id`s.
2. Each row contains one `div.comment` for the body text.
3. `td.ind` carries either an `indent` attribute or an `<img width>`
   that is 40px per level. **If both change, every comment reads as
   depth 0** — the thread flattens, and `h`/`n`/`m` silently collapse
   onto `j` while `p`/`r` report they have nowhere to go. That's the
   failure mode to look for, since it degrades quietly rather than
   erroring.
4. Comments are server-rendered and present at load. No
   `MutationObserver`.

Collapsed threads are handled by the library's `offsetParent` filter,
which drops rows inside a `display: none` ancestor. On a large thread
that's typically a few dozen rows.

### Previously

Before version 1.2.0 this script also rewrote each comment's
`span.navs` row: it added `down` / `up` / `parent-next` / `root-next`
links HN doesn't provide, reordered them by increasing scope, and
labeled each with its keyboard shortcut. Navigation worked by
`.click()`ing those anchors and letting HN's own handler scroll.

That was dropped in favor of the shared library, so HN behaves like
every other site. It also removed a dependency on HN's link markup —
the old approach could only reach a move HN had rendered a link for,
and had to special-case the top-level rows where `parent-next` and
`root-next` were absent. Deriving the tree from indentation has
neither limitation.

### If this breaks in the future

1. Open DevTools, look for `[hn nav] initializing`. Missing → `@match`
   or install issue. If `initializing` appears but the `keys:` line
   doesn't, one of the `@require`d library files failed to load.
2. Press `j`. If it logs `no comments found`, `tr.athing.comtr` has
   changed.
3. Press `p` on a reply. If it says it has nowhere to go, depth
   detection is broken — check `td.ind` for the `indent` attribute and
   the spacer image's width.
