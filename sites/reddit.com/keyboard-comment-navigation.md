# Reddit: Keyboard comment navigation

## Summary

Adds keyboard shortcuts for moving through the comments on a reddit
post, following the shape of the thread — not just the next comment,
but the parent, the next sibling at the same depth, and the next
top-level thread, so a long discussion can be skimmed or read in
depth without the mouse.

Reddit's own `j` / `k` move linearly through everything and don't let
you skip a subtree; this script takes those keys over. The bindings
match the comment-navigation userscripts for other sites.

### Keyboard shortcuts

| Key | Moves to |
| --- | --- |
| `j` / `k` | next / previous comment in display order, replies included |
| `h` / `l` | next / previous sibling at the same depth, skipping the current subtree |
| `p` | parent of the current comment |
| `n` | parent's next sibling — continues past the current subtree |
| `r` | root of the current thread |
| `m` | next root thread |
| `c` | top of the comments section (the sort dropdown / "N Comments" row) |

The "current" comment is the first one visible on screen, not whichever
has focus. Keys are ignored while you're typing in a text box.

## Visible changes

* The keyboard shortcuts above, on reddit post pages.
* Reddit's built-in `j` / `k` bindings are replaced.
* No visible markup changes — only scrolling, using
  `behavior: 'smooth', block: 'start'`.
* The current comment is the first one whose body text intersects the
  visible area below reddit's sticky top banner. Keys are ignored when
  a typing target is focused (`input`, `textarea`, `select`,
  contenteditable) or any modifier is held.

## Implementation

### DOM observations

Reddit (new design, `www.reddit.com`) renders each comment as a
`<shreddit-comment>` custom element. The key attributes we use:

* `thingid="t1_xxxxxx"` — unique comment id.
* `depth="N"` — 0 for top-level, increments per reply.
* `parentid="t1_yyyyyy"` — present on replies, absent on roots.

Nested replies live inside their parent's *light* DOM (slotted into the
shadow DOM for rendering via `slot="children-t1_yyyyyy-N"`). That means
`closest('shreddit-comment')` walks the comment tree, and
`element.querySelectorAll(':scope > shreddit-comment')` returns direct
children only.

The comment body is a div with id `${thingid}-comment-rtjson-content` and
`slot="comment"`. We anchor viewport intersection on that div rather than
the surrounding `<shreddit-comment>` element — the latter wraps the entire
subtree (body + nested replies + reply box) and stays intersecting long
after the actual text has scrolled away.

The viewport check requires at least 30 px of the body to be visible
*below* reddit's sticky banner (`rect.bottom - --shreddit-header-height
>= 30`). A plain `rect.bottom > 0` test treats the strip behind the
banner as intersecting, so the comment that just scrolled past `j`'s
target keeps re-winning the "current" lookup and `j` stalls. The 30 px
floor is a small safety margin past the banner edge.

The comment tree container is `<shreddit-comment-tree id="comment-tree">`;
its direct `<shreddit-comment>` children are the root threads. The
`<shreddit-comments-sort-dropdown>` (and fallback
`<shreddit-comment-tree-stats>`) marks the top of the comments UI for the
`c` key.

### What we assume stays stable

* `shreddit-comment` custom element with `thingid` and `depth` attributes.
* Nested replies are real light-DOM children of their parent
  `shreddit-comment`.
* Each comment body div has id `${thingid}-comment-rtjson-content`.
* `shreddit-comment-tree`, `shreddit-comments-sort-dropdown`, and
  `shreddit-comment-tree-stats` exist at the top of the comments section.

### How the script works

* Single capture-phase `keydown` listener on `document`. Capture phase plus
  `preventDefault()` + `stopImmediatePropagation()` is how we beat reddit's
  built-in `j`/`k` handler to the event.
* On init, injects a `<style id="reddit-nav-scroll-margin">` that applies
  `scroll-margin-top: calc(var(--shreddit-header-height) + 8px)` to every
  element we ever scroll to (`shreddit-comment`,
  `shreddit-comments-sort-dropdown`, `shreddit-comment-tree-stats`,
  `shreddit-comment-tree`). Reddit only sets the inline scroll-margin on
  depth-0 comments, so without this nested replies and the comments header
  land with their first line tucked behind reddit's sticky top banner.
* Reddit is an SPA, so `@match` is `https://www.reddit.com/*` and the
  handler self-gates on `location.pathname` containing `/comments/`.
  Outside a post page, all keys pass through to reddit's own handling
  untouched.
* No DOM mutation — we only scroll. Queries are run fresh on every
  keypress, so SPA navigation between posts works without rebinding.

### Notes

* The handler intentionally does nothing on feed pages (`/`, `/r/<sub>`,
  search results) — reddit's own `j`/`k` for cycling posts there is fine.
* The script is `@noframes` since reddit's comment tree only ever lives in
  the top frame.
