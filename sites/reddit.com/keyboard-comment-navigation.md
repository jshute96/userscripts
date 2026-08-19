# Reddit: Keyboard comment navigation

## Summary

This adds keyboard shortcuts for navigating comment threads on Reddit.

`c` jumps to the first comment, `j` / `k` go to next / previous. Other keys are listed below.<br>
`?` opens help showing all the keys.

Reddit's own `j` / `k` move linearly through everything and don't let
you skip a subtree; this script takes those keys over.

Scripts adding the [same key bindings for several other sites are available here](https://github.com/jshute96/userscripts/blob/main/README.md#keyboard-comment-navigation).

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `c` | Open the comments |
| `j` / `k` | Go to next / previous comment |
| `h` / `l` | Go to next / previous sibling at the same depth, skipping the current subtree |
| `p` | Go to parent comment |
| `r` | Go to root comment of this thread |
| `n` | Go to next comment at parent level |
| `m` | Go to next comment at root level |
| `?` | Show all shortcuts on this page, from this and any other userscript |

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

* `capture: true` — reddit binds its own `j`/`k`. Capture phase plus
  `stopImmediatePropagation` on handled keys is what beats it, and
  only handled keys are suppressed.
* `enabled()` — `/\/comments\//` on the pathname. `@match` covers the
  whole site so the script survives SPA navigation into a thread; this
  gate decides whether to act.
* `comments()` — every `shreddit-comment`.
* `body()` — the `<thingid>-comment-rtjson-content` div. The
  `shreddit-comment` element wraps its entire subtree and would stay
  intersecting the viewport long after its text scrolled past.
* `parentOf()` — `parentElement.closest('shreddit-comment')`. Nested
  comments live in their parent's light DOM (slotted into shadow DOM
  only for rendering), so the light-DOM ancestor chain is the tree.
* `headerOffset()` — see below.
* `commentsTop()` — the sort dropdown, falling back to the tree-stats
  element and then the tree itself.

### Sticky-header offset

Reddit's top banner is sticky, and reddit sets `scroll-margin-top` on
depth-0 comments itself but not on nested replies or the comments
header — so we compute the offset for every scroll instead.

Reddit declares the height as `--shreddit-header-height`, **but on
`<shreddit-app>`, not the document root.** Reading it off `:root`
returns the empty string and falls silently through to the default.
Both are checked. Measured against the live `<reddit-header-large>`
the declared 56px is accurate to a pixel; 8px is added for breathing
room, and a landing comment's body settles around y=100 (the ~36px
avatar/username row sits above the body).
