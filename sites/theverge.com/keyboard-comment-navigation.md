# The Verge: Keyboard comment navigation

## Summary

This adds keyboard shortcuts for navigating comment threads on The Verge.

`c` opens the comments drawer, `j` / `k` go to next / previous. Other keys are listed below.<br>
`?` opens help showing all the keys.

This also closes the "Refresh comments" pill, which floats over the
comment text when new comments arrive.

Scripts adding the [same key bindings for several other sites are available here](https://github.com/jshute96/userscripts/blob/main/README.md#keyboard-comment-navigation).

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `c` | Open the comments drawer, or jump to the top of it if already open |
| `j` / `k` | Go to next / previous comment |
| `h` / `l` | Go to next / previous comment at this level, skipping the current subtree |
| `p` | Go to parent comment |
| `r` | Go to root comment of this thread |
| `n` | Go to next comment at parent level |
| `m` | Go to next comment at root level |
| `?` | Show all shortcuts on this page, from this and any other userscript |

## Visible changes

- The keyboard shortcuts above.
- `c` from anywhere on an article opens the comments drawer; pressing
  it again puts the first comment at the top of it, skipping past the
  welcome banner, the community-guidelines blurb and the composer.
- Jumps land the target comment flush at the top of the drawer, with
  no part of the previous comment above it.
- Coral's "Refresh comments" pill — which floats over the comment text
  when new comments arrive — is dismissed automatically. The cost is
  that you no longer get prompted to load them; reopening the drawer
  does that.

## Implementation

### How comments are rendered

The Verge's comments are [Coral](https://coralproject.net/) — the
same commenting platform the Washington Post and The Atlantic use — so
the DOM *inside* the drawer matches
[those](../washingtonpost.com/keyboard-comment-navigation.md)
[scripts](../theatlantic.com/keyboard-comment-navigation.md) closely,
and their `parentOf` pass is reused verbatim. The Verge's own wrapper
around Coral is what differs.

The drawer is built from three light-DOM elements, all with stable ids:

```
div#coral-drawer                     role=dialog, position:fixed
`- section#coral-drawer-scroll       the scroll container
     `- …
        `- div#comments-drawer
             `- div#coral-shadow-container   <- open shadow root
                  `- (the Coral comment stream)
```

Only the comment stream itself is in the shadow root. Both the scroll
container and the drawer chrome are ordinary elements outside it.

**The drawer is not torn down when closed.** `#coral-drawer`,
`#coral-drawer-scroll` and the shadow root all persist after the close
button is pressed; the drawer is hidden with `display: none`, which
zeroes its rect. So unlike WaPo — where the shadow host's existence
*is* the open gate — the open test here has to be geometric:
`#coral-drawer` having a non-zero width and height.

### Selectors we depend on

In the regular DOM:

- **Drawer:** `#coral-drawer` — the open/closed gate.
- **Scroll container:** `#coral-drawer-scroll`.
- **Shadow host:** `#coral-shadow-container`.
- **Comments-open links:** `a.duet--article--comments-link`, an anchor
  to `<article path>#comments`. The page carries several of them —
  the sticky-header count, the byline row, the button under the
  article — *and* one per headline in the "More in …" and "Top
  Stories" rails, which point at **other** articles. We match on the
  href's pathname against `location.pathname` so `c` can never open
  someone else's thread, and take the first one that's actually
  rendered (the rail links have zero-size rects on a fresh load, but
  that's not something to rely on).

Inside the shadow root — all identical to WaPo, and documented in
detail there:

- **Comment containers:** `[data-testid^="comment-"]` filtered to
  UUID-shaped ids (`/^comment-[0-9a-f]{8}-/`). The prefix is shared by
  `comment-reply-button`, `comment-reaction-button` and
  `comment-report-button`, so the UUID filter is load-bearing.
- **Comment body text:** `[class*="HTMLContent-root"]`. Coral's
  CSS-module hashes rotate every deploy — never hardcode one.
- **Reply lists:** `[id^="coral-comments-replyList"]`. The full id is
  `coral-comments-replyList-log--<parentUuid>`, so this can only ever
  be a prefix match.
- **Top-of-comments anchor:** `#tabPane-COMMENTS`. WaPo's
  `.comment-prompt` banner isn't rendered in The Verge's theme.

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

* `enabled()` — `#coral-drawer` has a non-zero rect.
* `comments()` — UUID-shaped `data-testid` cards in the shadow root.
* `body()` — `[class*="HTMLContent-root"]`. Scrolling still targets the
  whole container, which keeps the username and "In reply to" rows
  above the text from ending up under the floating controls.
* `parentOf()` — the last card before the enclosing reply list; see
  below.
* `container()` — `#coral-drawer-scroll`, with `strategy: 'container'`.
  Unlike WaPo's drawer, this one scrolls normally: both `scrollTo` and
  direct `scrollTop` assignment move it, so the hand-rolled `raf`
  strategy isn't needed.
* `headerOffset()` — zero in the normal case, and deliberately so; see below.
* `commentsTop()` — the **first comment**, falling back to
  `#tabPane-COMMENTS` when there are none. The tab pane is the top of
  the Coral stream, which on The Verge starts well above the first
  comment: welcome banner, community-guidelines blurb, "post a comment"
  composer, tab strip, sort dropdown. Anchoring `c` there left it
  looking like it hadn't reached the comments at all.

  Also **null while the drawer is closed**. That's mandatory rather
  than defensive: the shadow root survives a close, so returning an
  anchor unconditionally would make `c` scroll a `display: none`
  drawer instead of opening it.
* `open` — clicks the article's own comments link.

### Finding a reply's parent

Coral nests replies, but **not inside the parent's card**. The parent
card and the reply list are siblings under a shared wrapper:

```
div.AllCommentsTabCommentContainer-<hash>
|- div
|   `- div#comment-<parentUuid>.CommentContainer-<hash>
`- div
    `- div#coral-comments-replyList-log--<parentUuid>
         `- div
             `- div#comment-<replyUuid>.CommentContainer-<hash>
```

So walking up from a reply looking for an ancestor card finds nothing,
however far it goes. What identifies the parent is the reply list: the
last card *before* the list, in document order, is the comment being
replied to. Every card between them is a sibling inside the list.

That's derived in one left-to-right pass, keeping a stack of the reply
lists currently open (innermost last), each paired with the card that
owns it. A per-comment backward scan would be O(n) inside the library's
O(n) sibling scan; `CommentNav.parentMapper` caches the map for the
duration of a keypress.

**Depth here genuinely exceeds two** — of the two articles this was
built against, one had replies at depths 0-2 and the other at 0-3 — so
resolving a reply's parent to its thread root would make `p` overshoot.
Verified by pressing `p` repeatedly from a deep reply and watching it
stop at each level rather than jumping to the root.

**Don't try to derive the tree by measuring indentation.** Replies
*are* indented visually, but the indent lives on the reply list as
padding, not on the cards: every comment container reports the same
`getBoundingClientRect().left` at every depth, and only the body
inside it shifts (~20px per level). The first version of this doc
claimed The Verge rendered replies flat, on exactly that measurement.
Read the reply-list ids instead.

Unlike The Atlantic's Coral build, this one puts no `coral-level-N`
class on the cards, so there's no second source for depth here.

### Why the header offset is zero

`#coral-drawer-scroll` runs the full height of the viewport, and
**nothing occupies a header band across the top of it**. The drawer's
own controls — the notification bell and close button — float in the
top-right *corner*, about 90px wide and 50px tall.

The first version treated that corner cluster as a header and offset
jumps by its height. That was wrong in a way worth recording, because
it looked plausible: every jump landed the target comment 50px down,
which left the tail of the *previous* comment — its last line of text
and its Rec / Reply / Share row — sitting above it. The result was
ambiguous about which comment the jump had actually pointed at. With
no offset the target comment is flush at the top and there's nothing
above it, and the corner cluster still doesn't cover anything: a
comment's opening line is a short left-aligned username row.

`headerOffset()` is kept rather than hardcoded to 0, as a backstop for
overlays that *do* cover the text column — Coral's refresh pill below,
and anything of that shape The Verge adds later. It measures the
largest bottom edge among `position: fixed` descendants of
`#coral-drawer` that overlap the top of the scroller, and applies two
filters:

* skip anything taller than 200px or narrower than 20px — those are
  the drawer's own full-height layers, not overlays;
* **skip anything that doesn't reach into the left 40% of the drawer.**
  That's what separates an overlay sitting on the text column from one
  tucked into the corner, and it's what makes the corner cluster score
  zero.

Classes here are build-hashed vanilla-extract names (`_1cg7m4i2` and
friends) with nothing semantic in them, so this measures rather than
naming elements. The result is cached for 100ms — the library asks more
than once per keypress and this walks the drawer — short enough that an
overlay appearing is picked up immediately.

That sweep covers the drawer's **light DOM only**, and Coral's refresh
pill is in the shadow root, which `querySelectorAll` does not cross
into. So the pill is measured **separately**, by the same selector the
dismissal uses. (An earlier version's claim to backstop the pill from
the light-DOM sweep was simply false — the offset stayed 0 with the
pill up.) Measuring it by selector rather than sweeping the shadow root
for computed positions matters too: that sweep would be
`getComputedStyle` on every node of every comment, on every keypress.

### Dismissing Coral's "Refresh comments" pill

When new comments arrive while the drawer is open, Coral floats a
`⟳ Refresh comments | Close ✕` pill over the top of the stream — not
in a header band, directly on top of whatever comment text is there,
which is exactly where a jump lands. The script closes it on sight.

The pill is in the shadow root and its classes are CSS-module hashes.
The stable part is the aria-labels: `button[aria-label^="Refresh"]`
for the refresh control (Coral localizes it as "Refresh comments" /
"Refresh reviews" / "Refresh questions" depending on story mode) and
`button[aria-label="Close"]` for the dismiss. Coral's markup puts them
in a small shared container:

```
div
`- Flex
     |- Flex
     |    |- button[aria-label="Refresh comments"]
     |    `- div "|"
     `- button[aria-label="Close"]
```

so the Close button is found by walking up from the refresh button
until an ancestor contains one. Scoping it that way matters — a bare
`button[aria-label="Close"]` search over the shadow root could match
some other dismiss control in the stream. Two limits keep the walk from
recreating that problem by climbing too far: at most three hops, and
never past a container holding more than four buttons. Without the
second, a pill rendered without its own Close would send the walk up
into a stream-level container, where `querySelector` returns the first
Close *anywhere* below it — and we'd click it.

A `MutationObserver` on the shadow root drives it, debounced 100ms:
it fires on every mutation anywhere in the stream — comments arriving,
reaction counts ticking, the composer being typed in — and each run
queries across every comment card. The dismissal also sets a
reentrancy flag, because the click makes Coral re-render and re-enters
the observer; that terminates on its own today (the button goes away),
but a build that re-rendered the pill in place would otherwise loop.

Getting the observer attached at all needs care. The shadow root
doesn't exist until the drawer is *first opened*, which can be any time
— the reader may spend ten minutes on the article first, or land on the
homepage and navigate in under the site-wide `@match`. The first
version polled for the host every 500ms and gave up after two minutes,
which meant that in the ordinary case — read, then open the comments —
the watcher was already dead by the time it was needed, having logged a
misleading "comment stream never mounted". It's now a second
`MutationObserver`, on `#comments-drawer` (present at document-idle,
and where Coral mounts), which disconnects itself once the host
appears.

That observer alone isn't enough, though, and the reason is easy to
miss: **the host `<div>` is inserted a beat before its shadow root is
attached.** The observer fires on the insertion, finds
`.shadowRoot === null`, and then never hears anything again — every
subsequent mutation happens *inside* the shadow tree, which a
light-DOM observer cannot see. So on seeing the host appear it hands
off to a bounded 250ms retry (20s) that waits for the shadow root and
logs if it never arrives. Symptom of getting this wrong: everything
works except that "comment stream mounted" never appears in the
console, and the pill is never dismissed.

**The trade-off:** dismissing the pill also removes the only prompt to
load newly-arrived comments, and it will be dismissed again each time
it reappears. Reopening the drawer loads them. If that turns out to
matter more than the obstruction, the fix is to click the *refresh*
button instead of *close* — same removal, keeps the comments coming,
at the cost of the list reflowing under you mid-navigation.

### What we assume stays stable

- `#coral-drawer`, `#coral-drawer-scroll` and `#coral-shadow-container`
  keep those ids, and the Coral stream stays in an open shadow root.
- The drawer stays resident when closed and is hidden by a style that
  zeroes its rect. (If The Verge switched to unmounting it, `enabled()`
  would still be correct — `getElementById` returning null reads as
  closed.)
- Each rendered comment carries `data-testid="comment-<uuid>"` matching
  `/^comment-[0-9a-f]{8}-/`.
- Comment text is wrapped in an element whose className contains
  `HTMLContent-root` (substring, not the hash).
- Reply lists' ids start with `coral-comments-replyList`.
- `#tabPane-COMMENTS` survives inside the shadow root.
- The comments links keep the `duet--article--comments-link` class and
  an href ending in `#comments`.
- Coral's refresh pill keeps its `aria-label="Refresh …"` /
  `aria-label="Close"` button pair within three levels of each other,
  in a container holding only those buttons.
  If it doesn't, the pill simply stops being dismissed — the script
  logs that it found the pill but no close button, and nothing else
  breaks.

If the comments stop responding to `j` / `k`, run this in the page
console with the drawer open:

```js
(() => {
  const d = document.getElementById('coral-drawer');
  const sr = document.getElementById('coral-shadow-container')?.shadowRoot;
  return {
    drawer: !!d,
    drawerOpen: !!d && d.getBoundingClientRect().width > 0,
    scroller: !!document.getElementById('coral-drawer-scroll'),
    shadowRoot: !!sr,
    comments: sr ? sr.querySelectorAll('[data-testid^="comment-"]').length : 0,
    realComments: sr ? [...sr.querySelectorAll('[data-testid^="comment-"]')]
      .filter(c => /^comment-[0-9a-f]{8}-/.test(c.getAttribute('data-testid'))).length : 0,
    bodies: sr ? sr.querySelectorAll('[class*="HTMLContent-root"]').length : 0,
    replyLists: sr ? sr.querySelectorAll('[id^="coral-comments-replyList"]').length : 0,
    tabPane: !!sr?.querySelector('#tabPane-COMMENTS'),
    openLinks: document.querySelectorAll('a.duet--article--comments-link').length,
  };
})()
```

The first null / zero in that record is the broken assumption.
`replyLists: 0` on a thread that visibly has replies means `p`, `r`,
`n` and `m` have silently degraded to flat behavior.

### SPA behavior

The Verge is a Next.js app and article-to-article navigation is
client-side, but this script doesn't care: it registers one
document-level keydown listener at init and the handler self-gates on
the drawer's geometry, so it does the right thing on every article
without re-running on URL changes. `@match` is the site root so the
script loads regardless of which page the user starts on.
