# Substack: Keyboard comment navigation

## Summary

This adds keyboard shortcuts for navigating comment threads on Substack.

`c` jumps to the comments, `j` / `k` go to next / previous. Other keys are listed below.<br>
`?` opens help showing all the keys.

A Substack post only shows a couple of comments inline, with a
"N more comments..." link to the full comments page. From a post, `c`
follows that link; once you're on the comments page, `c` goes to the
first comment.

Substack threads nest arbitrarily deep, so `p` (parent), `r` (thread
root) and `n` (skip past this reply subtree) all do real work here.

Scripts adding the [same key bindings for several other sites are available here](https://github.com/jshute96/userscripts/blob/main/README.md#keyboard-comment-navigation).

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `c` | Open the comments |
| `j` / `k` | Go to next / previous comment |
| `h` / `l` | Go to next / previous comment at this level, skipping the current subtree |
| `p` | Go to parent comment |
| `r` | Go to root comment of this thread |
| `n` | Go to next comment at parent level |
| `m` | Go to next comment at root level |
| `?` | Show all shortcuts on this page, from this and any other userscript |

## Visible changes

* The keyboard shortcuts above, using smooth scrolling.
* On a post page, `c` navigates to the post's comments page.
* No visible markup changes — the script only attaches a `keydown`
  listener.

## Implementation

The behavior lives in
[`lib/keyboard-comment-nav.js`](../../lib/keyboard-comment-nav.js) and
[`lib/keyboard-shortcuts.js`](../../lib/keyboard-shortcuts.js); this
script is just Substack's selectors and its `parentOf`.

### Where it runs

`@match https://*.substack.com/*` plus `@match https://*/p/*` and
`@match https://*/cp/*`, with `@exclude https://*.instagram.com/*` —
the same targeting as [`close-popups.user.js`](close-popups.md) next
door, for the same reasons. Substack publications run on custom domains
as well as on `*.substack.com`, and a match pattern can only test the
URL, so the path shape is what identifies a post on a custom domain.
`/p/<slug>` is an ordinary post and `/p/<slug>/comments` its comments
page, both covered by the same pattern; `/cp/<id>` is a cross-post, and
needs its own.

Nothing gates on the URL beyond that. `enabled()` asks two questions:
is this a Substack page, and does it have comments in the DOM. If
either is false, every key but `c` reports itself unhandled and passes
through to the site, and `commentsTop()` returns nothing so `c` does
too. The library evaluates this per keypress, which is also what makes
Substack's client-side navigation between a post and its comments page
work without a `urlchange` listener.

The Substack-page half is not redundant. `.comment` is far too generic
a class to identify anything on its own, and the `/p/*` match reaches
unrelated sites — gating on the class alone would swallow `j`/`k` on
someone else's site and scroll to whatever their `.comment` happened to
be. The test is the same one
[`close-popups.user.js`](close-popups.md) uses: a `substack.com`
hostname, or `pencraft` / `substackcdn.com` in the markup.

### What Substack's comment markup looks like

Unusually for this repo, the comment markup is *not* CSS-modules —
these are hand-written semantic class names with no build-hash
suffixes. (The surrounding page chrome is CSS-modules, `pencraft pc-*`
plus hashed classes, and is avoided here for that reason.)

```
div.comment-list-container          <- comments page only
  div.comment-list
    div.comment-list-items
      div.comment                   <- a root comment
        div#comment-317866642.comment-anchor
        div#comment-317866642-reply.comment-anchor
        div[role=article].comment-content
          … avatar, author, div.comment-body, div.comment-actions
        div.comment-list            <- its replies, if any
          div.comment-list-items
            div.comment             <- a reply, same shape recursively
```

Key points:

- **`.comment` contains its own reply subtree.** The nesting is real
  DOM nesting, so `parentOf` is just
  `el.parentElement.closest('.comment')`.
- **Depth is unbounded.** A 126-comment thread we probed reached depth
  9. Anything that assumed one or two levels would be wrong here.
- **`.comment` itself carries no id.** The id is on the empty
  `div.comment-anchor` immediately inside it, as `comment-<id>`, with a
  second `comment-<id>-reply` anchor beside it.
- **The post page uses the same `.comment` markup**, under
  `#substack-comments .comment-list.post-page-root-comment-list`, but
  shows only the first couple of root comments with their replies
  collapsed.

`a.more-comments` is the "N more comments..." link at the foot of the
post page's preview, pointing at `/p/<slug>/comments`.

The publication bar is `div.main-menu[data-testid="navbar"]`, an
in-flow placeholder holding an inner `[class*="mainMenuContent"]` that
is the thing that actually paints. Substack hides that inner bar as you
scroll down and slides it back as you scroll up, and **its geometry is
not sampleable**. Measured live while scrolling:

| scroll | `position` | `top` | `bottom` | height |
| --- | --- | --- | --- | --- |
| load, y=0 | fixed | 0 | 84 | 84 |
| y=1200, going down | absolute | 0 | 84 | 84 |
| y=3988, going down | fixed | −84 | −12 | 72 |
| y=3600, going up | absolute | −72 | 0 | 72 |
| y=3400, going up | fixed | 0 | 72 | 72 |

`position` flips between `fixed` and `absolute` mid-animation and `top`
takes any value between `0` and `-height`. The **height** is the one
stable quantity: 72px, or 84px near the top of the page where the bar
is taller. `.main-menu`'s height tracks it exactly and, being static
and in-flow, can't be perturbed by the animation at all.

### What we assume stays stable

1. `.comment`, `.comment-content`, `.comment-body`, `.comment-anchor`,
   `.comment-list-container` and `.post-page-root-comment-list` keep
   their names and are not given build-hash suffixes.
2. `.comment` continues to wrap its replies, so a reply's parent is its
   nearest `.comment` ancestor.
3. `.comment-content` and `.comment-anchor` stay *direct children* of
   `.comment`. The selectors are `:scope >`-scoped, so a wrapper
   inserted between them would silently drop the comment back to using
   its whole container as its body — which is the "`j` is stuck" bug.
4. The post-to-comments link keeps `class="more-comments"`, and the
   post's action bar keeps `aria-label="Post UFI"` with a
   `.post-ufi-comment-button` inside it. If the `Post UFI` label goes,
   the scoping does too and `c` on a cross-post could click a
   recommended-post card's comment button instead — a wrong-page
   navigation rather than a no-op, so it's worth re-checking that one
   deliberately.
5. `#substack-comments` remains the id of the post page's comments
   section.
6. The top bar is findable as `[data-testid="navbar"]` (or
   `.main-menu`), and its height is the amount of the viewport it
   covers when shown.

### Config specifics

**`body`** is `:scope > .comment-content .comment-body`. This is the
one field that has to be right: `.comment` wraps the entire reply
subtree, so using it for viewport intersection would keep a root
comment "current" for as long as any of its descendants was on screen,
and `j` would never leave the first thread. Both fallbacks are
`:scope >`-scoped too, so they can never reach into a nested reply's
prose.

**`commentsTop`** encodes the two-page split:

* Comments page — the **first visible comment**, not the
  `.comment-list-container` around it. The two sit at the same offset,
  so it makes no difference to where `c` lands; it's returned this way
  because "go to the first comment" is what `c` means here, and because
  it gives the landing a concrete element to measure against. The
  container stays as a fallback for a comments page with no comments in
  it.
* Post page — returns nothing while there's somewhere to navigate to,
  which makes the library fall through to `open`. Only when there
  isn't (a post whose comments all fit inline) does it scroll to the
  first inline comment instead.

**`open`** has two ways off a post and onto its comments page:

* `a.more-comments` — the "N more comments..." link under an ordinary
  post's inline preview.
* `[aria-label="Post UFI"] .post-ufi-comment-button` — the comment
  bubble in the post's action bar. ("UFI" is Substack's name for that
  row of like / comment / restack buttons.) This is the only way in on
  a **cross-post**, at `/cp/<id>`, which renders no comment section at
  all — `/cp/<id>/comments` is a 404 — and whose bubble navigates to
  the *original* post's `/p/<slug>/comments`, where everything works
  normally. It's a `<button>` with no `href`, so it has to be clicked
  rather than followed.

  The scoping matters: the same button class appears on every
  recommended-post card further down the page (five on the cross-post
  we measured, with comment counts 9, 9, 0, 5 and 4). There is exactly
  one `[aria-label="Post UFI"]`, and it belongs to the post itself.

**`headerOffset`** is the awkward one, and took three tries.

The bar's visibility depends on scroll *direction*, deterministically:

```
scroll down 300px -> position:fixed, top:-72   (bar gone)
scroll up   300px -> position:fixed, top:  0   (bar back)
```

So no constant is right. Always reserving the height leaves a 72px band
of the *previous* comment above the target on every downward jump,
since the bar isn't there to fill it; never reserving it buries the
start of the comment behind the bar on every upward jump, since it is.
The first two versions of this script shipped one of those mistakes
each — v1.0.0 sampled the bar's live `bottom` and got 84, 0 or 72
depending on which animation frame the keypress caught; v1.0.1 used the
constant height and pushed every downward jump 72px too far.

The library passes the jump's target element, so the current version
decides by where the jump is going:

| target's current `top` | meaning | offset |
| --- | --- | --- |
| `< -2` | heading up — the bar will come back | the bar's height |
| `> height + 2` | heading down — the bar will get out of the way | 0 |
| in between | already parked where a previous jump left it | snap to the nearer end of that band |

Called with no element (the current-comment test, asking what's covered
*right now* rather than after a jump) it answers with the painted bar's
actual visible height.

Two things that look like details and aren't:

* **The ±2px slack.** Both numbers are fractional — the bar measures
  71.7356px — so an exact comparison put a target resting at 72.0
  *outside* the band by a quarter of a pixel. `c` pressed twice from
  below then moved the page 72px on the second press: the classic
  "jumps to two different places consecutively".
* **The band snaps to an end rather than holding the live value.**
  Returning the raw current occlusion there *creeps*: mid-animation it
  reads 8, so we scroll up 8px, which brings the bar 7px further in,
  which asks for another 8px — `c` walked the page 0 → 8 → 15 on
  successive presses. Both ends of the band are fixed points, so
  snapping settles instead, and the small move to reach one goes in the
  direction that keeps the bar where it already is.

**The header collapse, and why jumps aim short.** The bar is 84px tall
while the page is within ~90px of the top and 72px below that. So a
jump that *starts* at the top loses 12px of content above its target
while the scroll animates, and lands that far past it — the clipped
username row. Both `scrollIntoView` and a computed `scrollTo` fix their
destination when called, so both overshoot by exactly the collapse.

Overshooting is the expensive mistake, because the only way back is to
scroll *up*, and scrolling up is what makes the bar slide in again. An
earlier version let `settle` correct the overshoot and the bar
reappeared right after every `c`, pushing the comments down.

So a downward jump aims **short** by the amount the page is about to
shrink, leaving any residual error for `settle` to close *downward*,
where the bar stays away. The amount is
`currentHeight - collapsedHeight`, and the second number can't be read
until the page has scrolled — so it's learned, on any `headerOffset`
call made while `scrollY > 150`, and over-estimated until then (half
the bar's height, safe for a collapse this shallow). The cost is one
extra downward nudge on the first jump after a page load:

```
first c   c -> .comment | scroll drifted 30px, correcting (1)
          y: 466 → 517 → 544    firstCommentTop: 79 → 27 → 0
every c   c -> .comment
after     y: 488 → 544          firstCommentTop: 57 → 0
```

**`strategy: 'settle'`** is what closes that gap, and it also handles
the ordinary case it's named for — avatars and embedded images loading
above the target during the animation.

 — avatars, embedded images and quoted-post
cards load lazily above the target during the scroll animation, pushing
it further down the document, so the jump needs the library's drift
correction.

### Verified

Against captured snapshots of both pages, driven through real key
events:

* Comments page: 53 `.comment` elements, depths 0–9, 53 distinct ids,
  every comment resolving a body element distinct from its container
  and never inside a nested reply. `c` → `.comment-list-container`,
  then `j`/`p`/`r`/`n`/`m`/`h`/`l`/`k` each logged the expected move —
  notably `p` from a depth-4 comment landing on the depth-3 one rather
  than on the root.
* Post page: 2 `.comment` elements, both roots; `c` logged
  `comments not shown yet, opening` and clicked the more-comments link.

Scroll landing was then re-checked against the **live** comments page,
measuring each target's `.comment-content` top *and the painted bar's
bottom edge* after the scroll settled. The number that matters is the
gap between them, which should be zero — the comment starting exactly
where the bar stops covering:

```
j (down)    top= 0  barBottom= 0  gap=0    x8
k (up)      top=72  barBottom=72  gap=0    x5
p, r (up)   top=72  barBottom=72  gap=0
n, m (down) top= 0  barBottom= 0  gap=0
```

`c` was also checked to land identically on repeat presses from both
entry states — from the page top (`y=544`, first comment at 0, bar
away) and from far below (`y=472`, first comment at 72, bar shown,
which is correct because getting there means scrolling up). The `j`
straight after `c` was confirmed to reach the *second* comment, in both
the downward and upward `c` cases.

That last one had a bug of its own for a while, worth recording because
the fix ended up being somewhere else entirely. `j` after `c` was
reaching the *third* comment: `c`'s scroll ended with the header
sliding back in, which raised the current-comment gate by the header's
height, and a first comment with a short body then failed it — so `j`
advanced from the second. It looked like the library needed to remember
`c`'s target, and for a version it did. Once the landing was fixed so
the header no longer reappears, the mismatch was gone and that crutch
was removed again: the gate sits 30px below the header, `c` lands the
comment's top at the header's bottom, and a comment's body starts ~50px
below its own top, so the body clears the gate by ~20px no matter how
short it is.

The bar's painted bottom edge was sampled every 250ms across the whole
of `c`'s scroll, not just at rest: it stays at 0 throughout, so the bar
never flashes back in mid-jump.

`c` was checked for idempotency from both entry states — from the top
of the page (three presses, identical landing each time) and from far
below it (an upward jump, then a repeat that holds position). `c` from
the top logs `scroll drifted -12px, correcting`, which is `settle`
absorbing the 84→72 header-height change.

One caveat for anyone re-running this: sample at least ~1.5s after the
keypress. A shorter wait catches `settle` corrections still in flight
and reports plausible-looking wrong numbers.
