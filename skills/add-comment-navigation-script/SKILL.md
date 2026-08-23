---
name: add-comment-navigation-script
description: Write a userscript that adds keyboard navigation to the comments section of a forum or news site. Use when the user asks to add comment navigation to a site, matching the behavior of other scripts in this repo. Covers the shared library, the site config it needs, and how to work out a site's reply tree.
---

## When to use

The user has comment-navigation userscripts on several sites and wants
the same on another one. The keys and behavior must match what they
already have, so there's one set of keys to learn rather than one per
site.

**The behavior lives in a shared library — you are writing a config,
not a script.** A new site is typically 40–90 lines, almost all of it
selectors.

* [`lib/keyboard-comment-nav.js`](../../../lib/keyboard-comment-nav.js)
  — all nine bindings and everything behind them.
* [`lib/keyboard-shortcuts.js`](../../../lib/keyboard-shortcuts.js) —
  key dispatch, the typing guard, and the `?` help overlay.

Read both docs (`.md` beside each) before starting. Existing configs,
shortest first, each showing a different shape:

| Site | Shape it demonstrates |
| --- | --- |
| `sites/pinkbike.com/` | One level of replies, nested in a thread wrapper; the `settle` scroll strategy |
| `sites/reddit.com/` | True DOM nesting; capture phase to beat the site's own `j`/`k` |
| `sites/news.ycombinator.com/` | Flat DOM with depth encoded in an indent attribute |
| `sites/nytimes.com/athletic-*` | Flat DOM, one level, CSS-module class prefixes |
| `sites/nytimes.com/keyboard-*` | Panel with its own scroll container and sticky header |
| `sites/washingtonpost.com/` | Shadow DOM, `raf` scroll strategy, parent found via reply-list boundary |

## The keys

Registration order is the order shown on the `?` help screen, running
outward: get to the comments, move within, then up, then past.

| Key | Action |
| --- | --- |
| `c` | Jump to the comments |
| `j` / `k` | Next / previous comment |
| `h` / `l` | Next / previous comment at this level |
| `p` | Parent comment |
| `r` | Root comment of this thread |
| `n` | Skip past this reply thread |
| `m` | Next thread |

**Bind all nine on every site.** Do not drop keys because a site's
threads are shallow. The library derives everything from `parentOf`,
so on a one-level site `r` collapses onto `p` and `n` onto `m`, and on
a flat site `h`/`n`/`m` all become `j`. That duplication is the point.

## What the library already does — don't reimplement

Copying any of this into a site config is a bug, not thoroughness:

* Skipping modifiers, and skipping while the user types (including
  inside an open shadow root, via `composedPath`).
* Caps-Lock-safe letter matching.
* Re-querying the comment list on **every** keypress, so filter tabs,
  sort changes, lazy "show replies", and SPA navigation all just work.
* Filtering comments inside a `display: none` ancestor
  (`offsetParent === null`), which otherwise makes `j` look stuck.
* `lastJumpTarget`, so chained presses advance instead of stalling
  while a smooth scroll is still animating, plus its invalidation on
  wheel / touchmove / any unbound key.
* Requiring 30px of a comment's body to be visible below the header
  before it counts as "current".
* The `?` overlay, and swallowing Esc so the site doesn't also act on
  it.

## Writing the config

```js
CommentNav.create({
  tag: '[site nav]',
  comments: () => [...document.querySelectorAll(SEL.comment)],
  body: el => el.querySelector(SEL.bodyText) || el,
  parentOf: el => …,
  id: el => el.id,
  commentsTop: () => document.querySelector(SEL.header),
});
```

Full field list is in `lib/keyboard-comment-nav.md`. The two that
always need thought:

**`body`** — the element used for viewport intersection. Pick the
comment's *prose*, not its container. A container wraps the header,
avatar, reply bar, and often the whole reply subtree, so it stays
intersecting the viewport long after the user has visually scrolled
past — the single most common cause of "`j` is stuck".

**`parentOf`** — see below. It is the only thing that tells the
library about the site's tree.

## Working out `parentOf` — probe first, don't guess

This is where every site has surprised us, and where a wrong guess
fails *silently*: the keys still work, they just quietly behave as if
the thread were flatter than it is.

**Do not write `parentOf` from a screenshot.** Visual indentation and
"Replying to X" text tell you a hierarchy exists; they tell you
nothing about how it's expressed in the DOM. Run a probe on a thread
that actually has replies, and read the real structure.

```js
(() => {
  const root = document;                  // or the shadow root / panel
  const SEL = '<your comment selector>';
  const cards = [...root.querySelectorAll(SEL)];
  const reply = cards.find(c => c.getBoundingClientRect().left
    > cards[0].getBoundingClientRect().left);   // first indented one
  if (!reply) return `no indented card among ${cards.length}`;

  const desc = el => el.tagName.toLowerCase()
    + (el.id ? '#' + el.id : '')                       // NEVER truncate ids
    + (el.getAttribute('class') || '').split(/\s+/).filter(Boolean)
        .map(c => '.' + c.replace(/-[A-Za-z0-9_-]{5,}$/, '-<hash>')).join('')
    + (el.matches(SEL) ? '   <== COMMENT' : '');

  const chain = [];
  for (let el = reply; el && el !== root; el = el.parentElement) chain.push(desc(el));
  return chain.map((l, i) => '  '.repeat(i) + l).join('\n');
})()
```

**Print ids in full.** A truncated id reads as a complete one and
sends you to an exact-match selector that matches nothing. If a
printed string ends exactly at your slice width, assume it's cut off.

Four shapes seen so far, and what each needs:

1. **True nesting** — the parent's container is an ancestor of the
   reply. `el.parentElement.closest(COMMENT_SEL)`. (Reddit.)

2. **Nested, but the parent card is not an ancestor.** The parent card
   and the reply list are siblings under a shared wrapper:
   ```
   div#<parentId>.Wrapper
   |- div#comment-<parentId>     <- parent card
   `- div#replyList
        `- div#comment-<replyId> <- reply card
   ```
   Walking up finds no card, ever. Instead find the enclosing reply
   list, then take **the last comment before that list in document
   order** — everything between is a sibling inside the list. Works at
   any depth. (WaPo.)

3. **Flat DOM, depth in an attribute.** Build a parent map in one pass
   with a stack of the most recent comment at each depth. (HN, via
   `td.ind[indent]`.)

4. **Flat DOM, one level, replies marked by class.** A reply's parent
   is the nearest preceding non-reply. (The Athletic.)

**If resolving one parent means scanning the comment list, build the
whole map in one pass and wrap it in `CommentNav.parentMapper`.** The
library calls `parentOf` once per comment (`siblingsOf`, `rootsOf`), so
a scanning `parentOf` is quadratic. `parentMapper` caches your map for
the duration of a keypress, keyed on the array the library passes in.
Shapes 2, 3 and 4 above all need it; shape 1 (`closest`) doesn't.

### The two-level trap

Both NYT and WaPo shipped broken in this exact way, differently.

A site whose threads *look* one level deep tempts you into "a reply's
parent is the thread root" — `closest(TOP_LEVEL_SEL)`, or a backward
scan to the nearest non-reply. At two levels the root *is* the parent,
so it tests clean. On a three-level thread `p` jumps straight past the
actual parent to the root, and `r` becomes indistinguishable from `p`.

**Write `parentOf` to find the immediate parent at arbitrary depth
even if you only see two levels.** It costs nothing and the failure
mode is otherwise invisible until someone notices `p` overshooting.
Where the site genuinely cannot express more depth, say so explicitly
in the doc's stability assumptions.

Verify by pressing `p` on a *third*-level reply if you can find one.

## Site investigation

Snapshot every state you'll depend on before writing anything —
closed, each menu open, hover/focus. Recurring surprises:

* CSS-module class names carry build hashes that rotate every deploy.
  **Never hardcode the full class**; use `[class*="Comment_Base"]`
  prefixes and record the prefix in the doc.
* An id may be reused across elements rather than unique, and may
  carry a per-instance suffix. Match with `[id^="prefix"]`, not
  `getElementById`.
* Capitalization of visible text varies across surfaces; match
  case-insensitively.
* Attributes like `aria-controls` often exist only while a popup is
  open.

### Selector preference

1. Stable ids / `data-*` the site authors put there.
2. Semantic CSS-module class **prefixes** and meaningful
   `aria-label` / `title` strings.
3. Role/tag selectors disambiguated by text content.
4. Visual identifiers — SVG path geometry, pixel positions. Last
   resort. A 460-character minified `<path d="…">` is a code smell;
   walk up the tree for a semantic container instead.

## Remaining site-specific concerns

**Headers that hide on scroll-down.** Before writing `headerOffset`,
check whether the header's *visibility* depends on scroll direction —
Substack's does, and this cost three iterations. Measure it: scroll the
live page down 300px, then up 300px, and read the bar's `position`,
`top` and `height` after each.

If it hides going down and returns going up, no constant is right, and
neither is sampling its live position — mid-animation it flips between
`fixed` and `absolute` with `top` anywhere in `[-height, 0]`, so you
get a different answer on every keypress. Decide by *direction*
instead: `headerOffset` is called with the jump's target, so
`rect.top < 0` means heading up (reserve the height, the header is
coming back) and `rect.top > height` means heading down (reserve
nothing, it's leaving). For a target already within that band, snap to
whichever end the header is currently at — returning its live occlusion
there feeds back on itself and walks the page a few px per press.
Leave a pixel or two of slack on the band's edges: these measurements
are fractional (71.7356px), and an exact comparison put a target
resting at 72.0 outside the band and moved the page a full header
height on a repeat press.

Sanity check by measuring the gap between the target's top and the
header's *painted bottom edge* after each key; it should be 0 in both
directions. Sample ~1.5s after the keypress, or you catch `settle`
corrections in flight and get plausible-looking wrong numbers.

  Two follow-on effects to expect on such a site:

  * **Never let a downward jump overshoot.** A correction for an
    overshoot is a scroll *upward*, and upward is the gesture that
    brings a hide-on-scroll header back, so it reappears right after the
    jump looks finished and shoves the content down. Users notice
    immediately. The cause to check for is a header that also *changes
    height* near the top of the page (Substack's is 84px above ~90px of
    scroll and 72px below): a jump starting at the top loses that
    difference in content height while it animates, and both
    `scrollIntoView` and a computed `scrollTo` fix their destination
    before it happens. Aim short by the collapse amount and let `settle`
    close the gap downward. The collapsed height can't be read until the
    page has scrolled, so learn it on any `headerOffset` call made while
    scrolled and over-estimate until then — erring short is free, erring
    long summons the header.
  * **Check `j` immediately after `c`.** `c` doesn't set
    `lastJumpTarget`, so the next `j` re-derives "current" from the
    viewport — and if `c`'s landing and the visibility gate disagree
    about the header, `j` starts from the second comment and looks like
    it skipped one. On Substack the header slid back in during `c`'s
    scroll, raising the gate by its own height, and a first comment with
    a short body then failed it. Fix the landing, not the bookkeeping:
    once `c` lands the comment's top at the header's bottom, the gate
    (30px below the header) sits well inside the comment's own body.
    This one is invisible until you hit a page whose first comment is
    short.

**Sticky headers.** If anything overlays the top of the scroll area,
supply `headerOffset()`. Prefer a value the site declares over
measuring — but check *where* it's declared: Reddit sets
`--shreddit-header-height` on `<shreddit-app>`, not `:root`, so
reading it off the document root silently yields `""` and falls
through to a hardcoded default. If you must measure by walking the
DOM, cache the result briefly (NYT caches 100ms); the library asks
more than once per keypress.

**Custom scroll containers.** Supply `container()` and
`strategy: 'container'`. Viewport tests then use the panel's rect
rather than `window.innerHeight`, automatically. Returning null is
safe — the library logs and falls back to a window scroll.

**Scroll that silently no-ops.** On some fixed-position drawers both
`scrollIntoView` and `scrollTo` do nothing (WaPo's Coral, with
`scrollbar-gutter: stable`). Use `strategy: 'raf'`, which writes
`scrollTop` directly.

**Pages that grow while you scroll.** Lazy images and injected ad
slots above the target push it down mid-animation, so the jump lands
short. Use `strategy: 'settle'`.

**The site already binds `j`/`k`.** Set `capture: true`.

**Comments not rendered until a click.** Supply
`open: { canOpen(), click() }`. Make `commentsTop()` return null while
they're closed — otherwise `c` scrolls to a hidden panel instead of
opening it. Everything but `c` should be gated by `enabled()`.

**SPA sites.** Broaden `@match` to the site root and gate with
`enabled()` reading `location.pathname`. The gate is evaluated per
keypress, so no `urlchange` listener is needed.

## Naming, listing, testing

* Script name: `keyboard-comment-navigation.user.js`, with
  `"category": "keyboard-comments"` in `script_manifest.json`. Run
  `scripts/update_readme.py` after.
* `@require` both library files, keyboard-shortcuts first, using the
  full `raw.githubusercontent.com` URL. SourceMonkey maps it to the
  local file for a local install. **Greasy Fork will not accept a
  GitHub `@require`** — publishing needs the libraries hosted
  somewhere it allows, which is unsolved.
* The Playwright fixture resolves `@require` and synthesizes `GM_info`
  from the metadata block. Loading two scripts into one page gives
  each its own library copy with the DOM registry shared, which is how
  the cross-script `?` overlay is tested.
* Log lines are `<tag> <key>: <action> -> <target>`, generated by the
  library — specs assert on that shape.
