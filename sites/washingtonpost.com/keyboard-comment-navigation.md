# Washington Post: Keyboard comment navigation

## Summary

Adds keyboard shortcuts for moving through the comments drawer on a
Washington Post article, so a discussion can be read without dragging
the drawer's scrollbar — and `c` opens the drawer in the first place,
without losing your place in the article.

The bindings match the comment-navigation userscripts for other sites.
Washington Post threads are flat in practice, so only the flat subset
of those bindings is used here.

### Keyboard shortcuts

| Key | Moves to |
| --- | --- |
| `j` / `k` | next / previous comment |
| `c` | opens the comments drawer, or jumps to the "N comments" banner at its top |

`j` / `k` only act while the drawer is open; the rest of the time they
fall through to the page and browser. All keys are ignored while
you're typing in a text box, so the reply box still works normally.

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

### Sticky-header compensation

Coral pins the tab strip (`StickyNav-root`) to the top of the drawer
once it's scrolled past, occupying roughly the top 56px of the
drawer viewport. Without compensation:

- A plain `j` jump lands the comment with its top at drawer-top 0,
  which is *behind* the 56px sticky bar — the first line is hidden.
- Worse, the "current" comment detection (first body to intersect
  the viewport) sees the just-jumped-past comment's body peeking
  out under the sticky bar (`bottom` ≈ 30, still > 0) and keeps
  reporting it as current. `j` then re-targets the *same* comment
  instead of advancing, so the cursor sticks.

Both are fixed by reading the sticky header's `offsetHeight` each
keypress and applying it as an offset:

- `smoothScrollTo(el, headerOffset)` subtracts `headerOffset` from
  the computed target `scrollTop` so the comment lands just below
  the sticky bar.
- `findCurrentIndex(bodies, headerOffset)` requires the body's
  `bottom` to be at least `headerOffset + 30` (an extra 30px slack
  to ignore comments that are mostly under the bar).
- Scrolling targets the **outer comment container** (`[data-testid=
  "comment-<uuid>"]`), not the body — there's a ~42px header row
  (avatar / username / time) above the body that needs to land on
  screen too. Viewport-intersection still uses the body, so the
  "stuck" failure mode doesn't come back via the taller container.

The header height is queried by class-prefix (`[class*="StickyNav-root"]`)
so the CSS-module hash suffix can rotate without breaking the script.
If the class is renamed entirely, the offset silently goes to 0 and
both bugs (clipped top line, stuck cursor) come back — that's the
first thing to check if `j` starts misbehaving.

The 'c' jump intentionally doesn't apply the offset: `.comment-prompt`
sits *above* the tab strip in the document, so scrolling it to top
naturally leaves the unstuck tab strip below it.

### Why a single document-level keydown listener works

Keyboard events that originate inside the shadow root bubble out
composed by default, so a normal `document.addEventListener('keydown',
…)` receives them. The catch is that `e.target` retargets to the
shadow host (`#coral-shadow-root`), so we can't tell from `e.target`
alone whether the user is typing in Coral's reply box. We use
`e.composedPath()` to walk the original event path across the shadow
boundary and skip the handler when any element in the path is an
input / textarea / contenteditable.

### Scrolling inside the drawer

The drawer (`#coralDrawerWrapper`) is the scrollable ancestor of the
shadow content, but neither `Element.scrollIntoView({behavior:
'smooth'})` nor `drawer.scrollTo({behavior: 'smooth'})` actually
moves it in Chrome — both calls return silently with `scrollTop`
unchanged. Direct assignment to `drawer.scrollTop` works fine. The
combination that triggers the no-op appears to be `position: fixed`
+ `overflow-y: auto` + `scrollbar-gutter: stable` on the drawer,
which is set inline by Coral and not easy to override from a
userscript.

So instead of the canonical `scrollIntoView({behavior:'smooth'})`
this script uses a small rAF-driven cosine-easing animation that
writes `container.scrollTop` directly each frame. `findScrollContainer`
walks composed ancestors (crossing the shadow boundary by hopping
from a `ShadowRoot` parent to its `.host`) until it finds the first
element that actually scrolls.

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

### Filter and sort changes

The sticky tab strip exposes four filters (Featured / Top / My
comments / All) and a sort dropdown (Newest first / Oldest first /
Top). Each filter change swaps the active inner tab pane:
`#tabPane-ALL_COMMENTS` becomes `#tabPane-TOP_COMMENTS` etc., with
a different set of comments inside. The old pane is unmounted
entirely (no zombie comments to worry about). Sort changes keep the
same set but reorder them.

The script handles both without any subscription to those events
because `commentBodies()` re-runs on every keypress and "current"
is detected by viewport intersection, not stored index. After the
user switches filters, the next `j` walks the new list from
whichever comment happens to be visible.

### SPA behavior

WaPo article pages are SPA-routed but this script doesn't care:
it registers one document-level keydown listener at init and the
handler self-gates on shadow-host presence, so it does the right
thing on every article without re-running on URL changes. `@match`
is the site root so the script loads regardless of which page the
user starts on.
