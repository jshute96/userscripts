# Hacker News: Keyboard comment navigation

## Summary

Adds keyboard navigation to Hacker News comment threads, and fills in
the navigation links HN doesn't provide.

HN already puts `next | prev | parent | root` on each comment, but
those are mouse-only, and `next` / `prev` step over whole subtrees, so
there's no way to just move to the comment below the one you're
reading. This adds the missing moves, orders all of them by increasing
scope, and binds a key to each.

### Keyboard shortcuts

| Key | Moves to |
| --- | --- |
| `j` / `k` | next / previous comment in display order, replies included |
| `h` / `l` | next / previous comment at the same level, skipping the current subtree |
| `p` | parent comment |
| `n` | parent's next sibling — continues past the current subtree |
| `r` | root of the current thread |
| `m` | next root thread |
| `c` | top of the comments list |

Keyboard navigation acts on the first comment visible on screen. Keys
are ignored while you're typing in a text box.

## Visible changes

* Three new links on each comment: `down` / `up` (immediately
  next/previous comment in display order), `parent-next` (up to
  parent, then next sibling) and `root-next` (up to root, then next
  top-level thread).
* The links are reordered by increasing scope:
  `down | up | next | prev | parent | parent-next | root | root-next`,
  and each shows its keyboard shortcut in the label. `c` has no link —
  it's keyboard-only, to match the scripts on other sites.
* Clicking a link acts on that link's own comment; the keyboard acts
  on the first comment visible on screen.
* On a top-level comment (no `parent-next` / `root-next` shown),
  pressing those shortcuts falls back to `next`.

## Implementation

### What HN's comment page looks like

Each comment is rendered as a single `<tr class="athing comtr"
id="<commentId>">` row. The numeric id matches HN's internal item id and
is used in nav-link hrefs as `#<commentId>` anchors.

Inside the row:

- A `<div class="comment">` holds the actual comment body. The first
  visible-on-screen `div.comment` is the most natural anchor for "what
  comment is the user looking at right now", since the header may be
  scrolled off-screen even while the body is in view.
- A `<span class="navs">` in the comment header holds the navigation
  links. Its content looks roughly like:
  ```
   | <a href="#XXX" class="clicky" aria-hidden="true">root</a>
   | <a href="#YYY" class="clicky" aria-hidden="true">parent</a>
   | <a href="#ZZZ" class="clicky" aria-hidden="true">next</a>
   <a class="togg clicky" id="<commentId>" href="javascript:void(0)">[–]</a>
  ```
  Important details we rely on:
  - The link text is the bare label (`root`, `parent`, `prev`, `next`).
  - Each navigation link has `class="clicky"` and `aria-hidden="true"`,
    and `href` starting with `#`.
  - The collapse toggle is also inside `.navs`, but is `class="togg
    clicky"` with `href="javascript:void(0)"` (so the
    `[aria-hidden="true"][href^="#"]` selector excludes it).
  - The `togg` link's `id` attribute holds the row's commentId. We use
    this to build a `commentId -> .navs` map so we can read a parent's
    or root's `next` link to compute `parent-next` / `root-next`.

Which links HN renders depends on depth:

- A top-level (root) comment: just `prev | next` (or only `next` for the
  first one).
- A second-level comment (whose parent is a root): `parent | next` (no
  separate `root` link, since parent is the root).
- A deeper comment: `root | parent | next`.

`prev` is only shown when there is a previous sibling at the same depth.

### What we assume

The script will break if any of these change:

1. `tr.athing.comtr` rows enclose comments and have stable `id`s.
2. Each row contains at most one `div.comment` (used for viewport
   detection) and one `span.navs` (used for link replacement).
3. Inside `.navs`, the existing nav links are the only descendants
   matching `a.clicky[aria-hidden="true"][href^="#"]`, and their text
   content is a single bare word from the set
   `{root, parent, prev, next}`.
4. The `[–]/[+]` toggle is `a.togg` and stays inside `.navs` (we keep
   it in place when rebuilding the row).
5. Optional `<span class="onstory">` may follow the toggle inside
   `.navs`; preserved if present.

### What we change

On `document-idle`:

1. **Capture phase.** For every `.navs`, read the existing nav links
   into a `{name -> href}` map (`captured`). This is done before any
   mutation, so subsequent rebuilds can rely on the original content.
2. **Compute extras.** Using the captured maps and the
   `commentId -> .navs` lookup, compute `parent-next` (the parent's
   `next` href) and `root-next` (the root's `next` href). For a
   second-level comment with no separate `root`, the parent is treated
   as the root, so both extras get the same target.
3. **Rebuild.** For each `.navs`, clear all children, then append new
   links in a fixed order:
   `down | up | next | prev | parent | parent-next | root | root-next`,
   with ` | ` separators. Items not present in the captured map (or
   not applicable, like `parent` on a top-level comment) are skipped.
   The `togg` (and optional `onstory`) are re-attached at the end so
   collapse continues to work.

   Each rebuilt link has:
   - `class="clicky"`, `aria-hidden="true"` (matches HN's smooth-scroll
     click handler so anchor clicks still feel native).
   - A `data-nav-name` attribute holding the canonical link name —
     used by the keyboard handler for fast lookup, instead of parsing
     decorated text.
   - A label rendered as `name (x)`, where `x` is the trigger key
     wrapped in `<u style="text-decoration: underline">`. The inline
     style is set explicitly because HN's `a { text-decoration: none }`
     would otherwise hide the `<u>` underline.

4. **Keyboard.** A single `keydown` listener on `document` maps each
   configured key to a logical action:
   - `j` / `k` (`down` / `up`) — find the comment row to navigate
     **from** (first row whose `div.comment` intersects the viewport),
     locate it in the visible `tr.athing.comtr` list, and smooth-scroll
     to the next/previous sibling.
   - `c` — smooth-scroll to the first comment row (top of the
     comments tree). Keyboard-only; no on-page link.
   - All other keys — find the same "current" row, look up
     `a[data-nav-name="<name>"]` inside its `.navs`, and `.click()` it.
     Clicking lets HN's own handler do the smooth scroll. Falls back
     to the `next` link if the requested action's link isn't on that
     row (so `n`/`m` on a top-level comment behave like `next`).

   Modifier keys (Ctrl/Meta/Alt) and typing into inputs/textareas/
   contenteditables suppress the handler.

5. **Chained presses during a smooth scroll.** With `behavior:
   'smooth'`, the viewport hasn't caught up to the scroll target by
   the time a chained keypress fires; a pure viewport check would
   re-pick the same source row and the script would look stuck.
   The script remembers the most recent target row in
   `lastJumpTarget` and treats it as "current" until invalidated.
   Invalidators are passive `wheel` / `touchmove` listeners on
   `window`, and any non-nav keypress (PageUp/Down, arrows, Home/End,
   space, …). For the anchor-click keys (`h`/`l`/`p`/`n`/`r`/`m`)
   HN does the scroll itself, but the script still parses the
   destination out of the link's `href="#<id>"` and pins
   `lastJumpTarget` to that row. See the
   `add-comment-navigation-script` skill for the general treatment.

6. **Hidden / collapsed comments.** `commentRows()` filters out rows
   inside a `display: none` ancestor with `offsetParent === null`,
   so that `j` from a comment immediately before a collapsed thread
   doesn't target a zero-rect hidden row (which would no-op the
   scroll and look stuck on the next press).

7. **Idempotency.** A `window.__hnNavLinksLoaded` guard prevents a
   second run on the same page (e.g. if both the raw and pointer
   versions of the script are installed). The script does not observe
   the DOM for later mutations, since HN serves the comments tree
   server-side and does not insert new ones after load.

### Click vs. keyboard scoping

HN's existing nav links each have an `href="#<targetId>"` baked in, so
clicking the `next` link inside comment X always navigates to X's next
sibling — independent of viewport state. We preserved that scoping for
all anchor-style links (`next`, `prev`, `parent`, `root`,
`parent-next`, `root-next`).

The `down` / `up` links can't use an `href` because the target depends
on which row the link lives in. Instead, their click handler walks up
to `closest('tr.athing.comtr')` and uses that row as the navigation
origin. This way clicking is always relative to the link, not the
viewport.

### If this breaks in the future

If the script stops working, check in this order:

1. Did `tr.athing.comtr`, `div.comment`, or `span.navs` change name?
   These are the structural anchors.
2. Did the togg link's `id` attribute move elsewhere? The
   `commentId -> .navs` map depends on it.
3. Did the link selector `a.clicky[aria-hidden="true"][href^="#"]`
   stop matching the existing nav links — e.g. by HN changing classes
   or attributes? If so, `parent-next` / `root-next` will silently not
   be added because the capture phase finds nothing.
4. Did HN start rendering nav link labels with extra whitespace or
   markup? The capture step compares `textContent` after stripping a
   trailing `\s*\([^()]*\)\s*$` (our keybinding suffix); anything else
   surrounding the label will need a similar normalization.
