# Washington Post: Keyboard comment navigation

## Summary

This adds keyboard shortcuts for navigating comment threads on the Washington Post.

`c` opens the comments drawer, `j` / `k` go to next / previous. Other keys are listed below.<br>
`?` opens help showing all the keys.

Scripts adding the [same key bindings for several other sites are available here](https://github.com/jshute96/userscripts/blob/main/README.md#keyboard-comment-navigation).

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `c` | Open the comments drawer |
| `j` / `k` | Go to next / previous comment |
| `h` / `l` | Go to next / previous comment at this level, skipping the current subtree |
| `p` | Go to parent comment |
| `r` | Go to root comment of this thread |
| `n` | Go to next comment at parent level |
| `m` | Go to next comment at root level |
| `?` | Show all shortcuts on this page, from this and any other userscript |

## Visible changes

- The keyboard shortcuts above.
- When `c` opens the drawer, the article's scroll position is
  preserved so the page doesn't jump.
- The nested-thread keys (`h`, `l`, `p`, `n`, `r`, `m`) from the
  canonical key set are intentionally omitted — no nested replies
  appear on the articles we've looked at.

## Implementation

### How comments are rendered

The comments drawer is a portal-rendered modal (`#coralDrawerWrapper`)
that mounts on demand and contains a Coral Talk embed inside an
**open shadow root** hosted by:

```
<div id="coral-shadow-root" data-test-id="comment-shadow-root-container">
```

When the drawer is closed, neither the wrapper nor the host exists in
the DOM. We use the presence of the shadow host as the
"drawer is open" gate — no separate listener is needed for the
open / close transitions.

### Selectors we depend on

In the regular DOM (used to open the drawer from a `c` press when
the drawer is closed):

- **Comments-open button:** `[data-qa="comments-btn"]`. The
  surrounding "Comments NNN" pill renders in two places (above the
  fold inline summary and a sticky CTA), but both share this
  `data-qa`, so the first hit is fine.

Inside the shadow root:

- **Comment containers:** `[data-testid^="comment-"]` filtered to
  UUID-shaped ids (`/^comment-[0-9a-f]{8}-/`). The same `comment-`
  prefix is shared by sentiment / reply buttons
  (e.g. `comment-reply-button`, `comment-sentimentClarifying-button`),
  so the UUID filter is load-bearing — without it `j` / `k` would
  step onto button elements. We also drop comments whose
  `offsetParent` is `null` — in Featured / Top filter views some
  replies live inside a collapsed `ReplyListCommentContainer-
  hiddenReplies` (display:none) container, and stepping onto them
  is what made `j` cycle between two scroll positions instead of
  advancing.
- **Comment body text:** `[class*="HTMLContent-root"]` inside the
  container. Coral uses CSS-modules with build-hash suffixes
  (`HTMLContent-root-5770ce4668399900d87c06ad10ba71a5`) that rotate
  on every deploy, so the prefix-match attribute selector is
  required — never hardcode the hash. The body wrapper is the
  element we test for viewport intersection and the element we
  scroll into view: the outer container also includes a header /
  reaction footer, so a partially-scrolled comment can still
  intersect the container long after the body has scrolled past.
- **Top-of-comments anchor:** `.comment-prompt` is the "1.9k
  comments" banner near the top of the drawer interior. We fall
  back to `#tabPane-COMMENTS` if Coral ever renames the class.
- **Sticky tab bar:** `[class*="StickyNav-root"]` is the
  Featured/Top/All/Newest-first tab strip. It pins to the top of
  the drawer (~56px tall) once scrolled past, and we have to read
  its height each keypress to offset jumps and viewport-intersection
  checks — see "sticky-header compensation" below.

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

* `enabled()` — the presence of `#coral-shadow-root`'s shadow root.
  The host only exists while the drawer is open, so it doubles as the
  open gate. Everything but `c` waits for it.
* `comments()` — `[data-testid^="comment-"]` inside the shadow root,
  filtered to UUID-shaped ids. Other elements share that prefix
  (sentiment buttons, `comment-reply-button`).
* `body()` — `[class*="HTMLContent-root"]`. Scrolling still targets
  the whole container, which keeps the ~42px avatar/username row above
  the text from ending up behind the sticky tab bar.
* `parentOf()` — the last card before the enclosing reply list; see
  below.
* `container()` + `strategy: 'raf'` — see below.
* `headerOffset()` — Coral's sticky tab bar (Featured / Top / All /
  Newest first), `[class*="StickyNav-root"]`, about 56px. The hash
  rotates, so only the prefix is safe to match.
* `commentsTop()` — `.comment-prompt`, falling back to
  `#tabPane-COMMENTS`.
* `open` — `[data-qa="comments-btn"]`. Clicking focuses the button,
  and the browser's scroll-the-focused-element-into-view yanks the
  article; the page scroll is pinned for a few frames to absorb that
  and the layout shift from mounting the drawer's portal.

### Finding a reply's parent

Coral nests replies, but **not inside the parent's card**. The parent
card and the reply list are siblings under a shared wrapper:

```
div#<parentUuid>.AllCommentsTabCommentContainer
|- div#comment-<parentUuid>.CommentContainer      <- parent card
`- div#coral-comments-replyList
     `- div#comment-<replyUuid>.CommentContainer  <- reply card
```

So walking up from a reply looking for an ancestor card finds nothing,
no matter how far it goes — which is why the first version of this
config returned null for every reply, and `p`/`r` did nothing while
`h`/`l` treated the whole thread as one flat sibling set.

Instead, the reply list is what identifies the parent: the last card
*before* the list, in document order, is the comment being replied to.
Every card between them is a sibling inside the list. That holds at any
nesting depth, and needs no indentation measurement or username
matching.

A card with no enclosing reply list is top-level.

That's derived in one left-to-right pass, keeping a stack of the reply
lists currently open (innermost last), each paired with the card that
owns it. A card leaves any list it isn't inside, and the first card
seen inside a new list records its predecessor as the owner. Doing it
as a per-comment backward scan instead would be O(n) inside the
library's O(n) sibling scan; `CommentNav.parentMapper` caches the map
for the duration of a keypress.

**The anchor is the `coral-comments-replyList` id, matched by
prefix** — `[id^="coral-comments-replyList"]`. Two reasons it can
never be a `getElementById` lookup: the id carries a per-thread
suffix, and it is reused across threads rather than being unique.
(An exact-match selector was the first attempt here and silently
matched nothing.)

It deliberately does *not* fall back to `[class*="ReplyList"]`: Coral
also uses `ReplyListCommentContainer` on individual replies, and
`closest` would match that nearer element, resolving a reply's parent
to its previous sibling — a wrong answer rather than no answer.

If Coral renames the list, `parentOf` returns null for everything and
the failure is at least visible: `p` reports it has nowhere to go from
a comment that is plainly a reply.

### Scrolling inside the drawer

The Coral drawer is a fixed-position overflow container with
`scrollbar-gutter: stable`, and **both `scrollIntoView` and
`scrollTo` silently no-op on it in Chrome**. Direct assignment to
`scrollTop` is the only thing that moves it, which is what the
library's `raf` strategy does — hand-rolled cosine easing writing
`scrollTop` each frame.

The container itself is found by walking composed ancestors (crossing
the shadow boundary) until one is reached that actually scrolls.

### Shadow DOM and the keyboard

A document-level `keydown` listener still receives events from inside
an open shadow root, because they're composed — but `e.target`
retargets to the shadow host, so it can't tell whether the user is
typing in the reply box. The library's typing guard walks
`e.composedPath()` instead, which crosses the boundary. That's
unconditional in the library, so it's correct here without any
site-specific opt-in.
### What we assume stays stable

- The Coral embed continues to mount inside an open shadow root
  hosted by `#coral-shadow-root` (id, not just data-attr).
- Each rendered comment carries `data-testid="comment-<uuid>"`
  matching `/^comment-[0-9a-f]{8}-/`.
- Comment text is wrapped in an element whose className contains
  `HTMLContent-root` (substring, not the hash).
- `.comment-prompt` continues to mark the comment-count banner at
  the top of the drawer interior, or `#tabPane-COMMENTS` survives.
- The sticky tab strip's class name continues to start with
  `StickyNav-root` (substring match).

If the comments stop responding to `j` / `k`, run this in the page
console while the drawer is open:

```js
(() => {
  const sr = document.getElementById('coral-shadow-root')?.shadowRoot;
  if (!sr) return 'drawer not open';
  return {
    host: !!sr,
    comments: sr.querySelectorAll('[data-testid^="comment-"]').length,
    realComments: [...sr.querySelectorAll('[data-testid^="comment-"]')]
      .filter(c => /^comment-[0-9a-f]{8}-/.test(c.getAttribute('data-testid'))).length,
    bodies: sr.querySelectorAll('[class*="HTMLContent-root"]').length,
    prompt: !!sr.querySelector('.comment-prompt'),
    tabPane: !!sr.querySelector('#tabPane-COMMENTS'),
    stickyNav: !!sr.querySelector('[class*="StickyNav-root"]'),
    commentsBtn: !!document.querySelector('[data-qa="comments-btn"]'),
  };
})()
```

The first null / zero in that record is the broken assumption.

### SPA behavior

WaPo article pages are SPA-routed but this script doesn't care:
it registers one document-level keydown listener at init and the
handler self-gates on shadow-host presence, so it does the right
thing on every article without re-running on URL changes. `@match`
is the site root so the script loads regardless of which page the
user starts on.
