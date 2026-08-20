# The Atlantic: Keyboard comment navigation

## Summary

This adds keyboard shortcuts for navigating comment threads on The Atlantic.

`c` opens the discussion drawer, `j` / `k` go to next / previous. Other keys are listed below.<br>
`?` opens help showing all the keys.

Atlantic discussions get long and deeply nested, and the drawer gives
you no way to move through them except scrolling. `n` and `m` skip past
a reply thread you're done with.

Scripts adding the [same key bindings for several other sites are available here](https://github.com/jshute96/userscripts/blob/main/README.md#keyboard-comment-navigation).

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| `c` | Open the discussion drawer, or jump to the top of it if already open |
| `j` / `k` | Go to next / previous comment |
| `h` / `l` | Go to next / previous comment at this level, skipping the current subtree |
| `p` | Go to parent comment |
| `r` | Go to root comment of this thread |
| `n` | Go to next comment at parent level |
| `m` | Go to next comment at root level |
| `?` | Show all shortcuts on this page, from this and any other userscript |

## Visible changes

- The keyboard shortcuts above.
- `c` from anywhere on an article opens the discussion drawer;
  pressing it again puts the first comment at the top of it, skipping
  past the composer and the tab strip.
- Jumps land the comment just below the drawer's sticky "All Comments"
  bar rather than underneath it.

## Implementation

### How comments are rendered

The Atlantic's comments are [Coral](https://coralproject.net/) — the
same commenting platform the Washington Post and The Verge use — so
the DOM *inside* the drawer matches
[those](../washingtonpost.com/keyboard-comment-navigation.md)
[scripts](../theverge.com/keyboard-comment-navigation.md), and their
`parentOf` pass is reused verbatim. The Atlantic's wrapper is its own:

```
div[data-event-module="comments drawer"]   role=dialog, position:fixed,
                                           overflow-y:auto  <- the scroller
|- button[data-event-element="close"]      sticky
|- div.ArticleComments_header__<hash>      sticky, "Discussions"
`- div#coral_thread
     `- div#coral-shadow-container         open shadow root
          `- (the Coral comment stream)
```

Two things about the drawer that shaped the config:

**It has no stable id.** Its `id` is React-generated (`:R5lhim:`) and
changes between renders. `data-event-module="comments drawer"` — an
analytics attribute, but a semantic one — is the only stable handle.

**It stays mounted when closed**, and is moved off-screen with a
`transform`, keeping its full 600×956 rect the whole time. So the
"is it open?" test can't be a size check (as it is on The Verge) or an
`offsetParent` check (it's `position: fixed`, so that's null in both
states). It's a horizontal-position test: the drawer's left edge
inside the viewport. Measuring during the slide animation gives an
in-between answer, which is harmless — the worst case is one keypress
acting on a drawer that's on its way out.

### Selectors we depend on

In the regular DOM:

- **Drawer:** `[data-event-module="comments drawer"]`. Also the scroll
  container — `overflow-y: auto` is on the same element.
- **Shadow host:** `#coral-shadow-container`, inside `#coral_thread`.
- **Comments-open button:** `[data-event-element="comments button"]`.
  The article renders three of them — the byline row, the floating
  side rail, and the "View Discussion" bar under the article — all
  sharing the attribute and all opening the same drawer, so the first
  rendered one is fine. Buttons inside the drawer are excluded: a
  width test is not a visibility test here, since the drawer keeps its
  full rect while closed. There's no per-article filter (unlike The
  Verge's, these are buttons carrying no article identity), which is
  safe only because section and topic index pages render no comments
  button at all — checked on `/ideas/`.
- **Drawer header:** `[class*="ArticleComments_header"]`, the sticky
  "Discussions" bar. CSS-modules with a build hash, so prefix only.

Inside the shadow root — all shared with the other two Coral sites:

- **Comment containers:** `[data-testid^="comment-"]` filtered to
  UUID-shaped ids (`/^comment-[0-9a-f]{8}-/`). The prefix is shared by
  `comment-reply-button`, `comment-reaction-button` and
  `comment-report-button`, so the UUID filter is load-bearing.
  Note that these containers all report the same
  `getBoundingClientRect().left` regardless of depth — Coral's indent
  is padding on the reply list, and only the body inside shifts. Don't
  read the tree off container positions.
- **Comment body text:** `[class*="HTMLContent-root"]`. Coral's
  CSS-module hashes rotate every deploy — never hardcode one.
- **Reply lists:** `[id^="coral-comments-replyList"]`. The full id is
  `coral-comments-replyList-log--<parentUuid>`, so this can only ever
  be a prefix match. (This build also carries the same information as
  `data-testid="commentReplyList-<parentUuid>"`; the id is used for
  consistency with the sibling scripts.)
- **Sticky tab bar:** `[class*="StreamContainer-tabBarRow"]`, the
  "All Comments (N)" bar. WaPo's build calls the equivalent element
  `StickyNav-root`, so both prefixes are matched.
- **Top-of-comments anchor:** `#tabPane-COMMENTS`. WaPo's
  `.comment-prompt` banner isn't rendered in The Atlantic's theme.

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

* `enabled()` — the drawer's left edge is inside the viewport.
* `comments()` — UUID-shaped `data-testid` cards in the shadow root.
* `body()` — `[class*="HTMLContent-root"]`. Scrolling still targets the
  whole container, which keeps the username and timestamp rows above
  the text from ending up behind the sticky bars.
* `parentOf()` — the last card before the enclosing reply list; see
  below.
* `container()` — the drawer itself, with `strategy: 'container'`.
  Unlike WaPo's drawer, this one scrolls normally.
* `headerOffset()` — measured, 55px; see below.
* `commentsTop()` — the **first comment**, falling back to
  `#tabPane-COMMENTS` when there are none. The tab pane is the top of
  the Coral stream, which starts above the first comment — the
  composer and the tab strip come first — so anchoring `c` there left
  it looking like it hadn't reached the comments.

  Also **null while the drawer is closed**. That's mandatory rather
  than defensive: the shadow root survives a close, so returning an
  anchor unconditionally would make `c` scroll an off-screen drawer
  instead of opening it.
* `open` — clicks the first rendered "Discuss" button.

### Finding a reply's parent

Coral nests replies, but **not inside the parent's card**. The parent
card and the reply list are siblings under a shared wrapper:

```
div.AllCommentsTabCommentContainer-<hash>
|- div#comment-<parentUuid>.CommentContainer-<hash>
`- div.coral-comment-replies
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

**Depth here is deep.** The article this was built against had 717
comments at levels 0 through 6 — 297 roots, and 11 comments six levels
down. Resolving a reply's parent to its thread root would make `p`
overshoot on the great majority of replies.

Seven levels is an *observation*, not a known limit — nothing in this
config or the library caps depth, and both derive it by walking
`parentOf` until it returns null. Coral does ship a `flattenReplies`
setting that stops nesting past a fixed depth and re-parents deeper
replies onto the last nested ancestor; whether The Atlantic has it
enabled, and at what depth, isn't something we've established. Seeing
level 6 means it's either off or set higher. Either way the config
needs no change: flattening would show up as a genuinely shallower
tree, not as a wrong one.

Coral gives each card a `coral-level-N` class, which is an independent
source for the same depth. It isn't used — the reply-list pass yields
the parent *element*, which is what the library needs, not just a
number — but it's the cross-check to reach for if `p` starts
misbehaving: derive depth both ways and compare. On the article above
the two agreed on all 717 comments.

### Virtualization

The all-comments log is a virtualized list
(`AllCommentsTabVirtualizedComments-virtuoso`), so in principle cards
can be unmounted while off-screen. In practice this build renders the
whole thread — 717 of 725 loaded comments were in the DOM at once,
before and after scrolling — so the comment list the library re-queries
on each keypress is complete.

Worth knowing because the parent derivation depends on document order
being complete: if virtuoso ever did drop a parent card while keeping
its replies, "the last card before the reply list" would name the wrong
comment rather than none. Nothing guards against that; a much longer
thread is where it would first show up.

### What we assume stays stable

- The drawer keeps `data-event-module="comments drawer"` and remains
  its own scroll container.
- The drawer stays mounted when closed and is moved off-screen rather
  than resized. (If The Atlantic switched to unmounting it,
  `enabled()` would still be correct — a missing element reads as
  closed.)
- The Coral stream stays in an open shadow root on
  `#coral-shadow-container`.
- Each rendered comment carries `data-testid="comment-<uuid>"` matching
  `/^comment-[0-9a-f]{8}-/`.
- Comment text is wrapped in an element whose className contains
  `HTMLContent-root` (substring, not the hash).
- Reply lists' ids start with `coral-comments-replyList`.
- `#tabPane-COMMENTS` survives inside the shadow root.
- The open buttons keep `data-event-element="comments button"`.

If the comments stop responding to `j` / `k`, run this in the page
console with the drawer open:

```js
(() => {
  const d = document.querySelector('[data-event-module="comments drawer"]');
  const sr = document.getElementById('coral-shadow-container')?.shadowRoot;
  return {
    drawer: !!d,
    drawerOpen: !!d && d.getBoundingClientRect().left < window.innerWidth - 50,
    scrolls: !!d && d.scrollHeight > d.clientHeight,
    shadowRoot: !!sr,
    comments: sr ? sr.querySelectorAll('[data-testid^="comment-"]').length : 0,
    realComments: sr ? [...sr.querySelectorAll('[data-testid^="comment-"]')]
      .filter(c => /^comment-[0-9a-f]{8}-/.test(c.getAttribute('data-testid'))).length : 0,
    bodies: sr ? sr.querySelectorAll('[class*="HTMLContent-root"]').length : 0,
    replyLists: sr ? sr.querySelectorAll('[id^="coral-comments-replyList"]').length : 0,
    tabBar: !!sr?.querySelector('[class*="StreamContainer-tabBarRow"]'),
    tabPane: !!sr?.querySelector('#tabPane-COMMENTS'),
    openButtons: document.querySelectorAll('[data-event-element="comments button"]').length,
  };
})()
```

The first null / zero in that record is the broken assumption.
`replyLists: 0` on a thread that visibly has replies means `p`, `r`,
`n` and `m` have silently degraded to flat behavior.

### SPA behavior

The Atlantic is a Next.js app and article-to-article navigation is
client-side, but this script doesn't care: it registers one
document-level keydown listener at init and the handler self-gates on
the drawer's position, so it does the right thing on every article
without re-running on URL changes. `@match` is the site root so the
script loads regardless of which page the user starts on.

Comments are only rendered for signed-in readers; with no session the
"Discuss" buttons are still present but the drawer never fills, and
every key but `c` reports nothing to move to.
