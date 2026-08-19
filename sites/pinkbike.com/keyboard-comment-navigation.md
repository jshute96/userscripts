# Pinkbike: Keyboard comment navigation

## Summary

This adds keyboard shortcuts for navigating comment threads on Pinkbike.

`c` jumps to the first comment, `j` / `k` go to next / previous. Other keys are listed below.<br>
`?` opens help showing all the keys.

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

* The keyboard shortcuts above, using smooth scrolling.
* No visible markup changes — the script only attaches a `keydown`
  listener.

## Implementation

### What Pinkbike's comment page looks like

The comments section is wrapped in `<div class="news-comments-container">` whose first child (`.news-comments`) has the `N
Comments` count. The thread tree itself lives in
`<div id="comment_wrap">` inside that container.

There is also a `<span id="commenttop">` further up the page, used
by Pinkbike's own "N Comments" link in the article header. In some
sessions (logged-in users, ads enabled) related-articles tiles and
an "Online Deals" widget get injected between `#commenttop` and the
actual comments — anchoring `c` to `#commenttop` then leaves that
filler at the top of the viewport. We target `.news-comments-
container` instead, which is always the start of the comments UI.

Threads are flat — exactly one level of replies:

- Each top-level thread is wrapped in
  `<div id="pp<id>" class="ppcont">`.
- Inside a `.ppcont`, the first `<div class="cmcont comment2 ...
  goodcomm">` is the root comment.
- Subsequent `<div class="cmcont comment2 ... commentreply2
  goodcomm">` siblings inside the same `.ppcont` are the replies.
  The `commentreply2` class distinguishes a reply from a root.
- Every `.cmcont` carries `id="cm<id>"` matching Pinkbike's internal
  comment id. There is also an `<a name="cid<id>">` immediately
  before each `.cmcont` (used by the per-comment `.time` permalink).
- No deeper nesting class exists — only `commentreply2`. (Confirmed
  by grepping a captured snapshot: every reply class on the page
  ends in `2`.)

### What we assume stays stable

The script breaks if any of these change:

1. `.news-comments-container` wraps the comments UI; `#commenttop`
   exists as a fallback anchor.
2. `.ppcont` wraps each thread; `.cmcont` is the comment element;
   `.commentreply2` distinguishes replies from roots.
3. Each `.cmcont` has a usable `id` (`cm<n>`), used only in log
   output today, but assumed for diagnostics.
4. Threads stay flat (one level of replies). If Pinkbike ever
   introduces nested replies, only `parentOf` in the site config
   needs to change — the shared library already derives every key
   from it at arbitrary depth, and `r`/`m` would stop coinciding
   with `p`/`n` on their own.
5. The script runs at `document-idle` and the comments are
   server-rendered — present at load time. No `MutationObserver`.

### How we modify the page

We do not modify the DOM. The navigation itself lives in
[`lib/keyboard-comment-nav.js`](../../lib/keyboard-comment-nav.js) —
current-comment detection, the `lastJumpTarget` that keeps chained
presses advancing during a smooth scroll, the hidden-comment filter,
the drift-correcting scroll, and all nine key bindings are shared with
the other comment-navigation scripts and documented there. Key
dispatch and the `?` help overlay come from
[`lib/keyboard-shortcuts.js`](../../lib/keyboard-shortcuts.js).

What's left here is the site config:

* `comments()` — every `.cmcont`, in document order.
* `body()` — the inner `.comtext`. Viewport intersection is tested
  against the comment text rather than the `.cmcont` container, which
  includes the avatar column and reply-box footer and would stay
  barely-intersected long after we've visually scrolled into the next
  comment.
* `parentOf()` — a `.commentreply2` maps to the single
  `.cmcont:not(.commentreply2)` inside the same `.ppcont`; anything
  else is a root. This one accessor is what gives us `h`/`l`/`r`/`m`
  as well as `p` and `n`.
* `strategy: 'settle'` — the drift-correcting scroll, for the reason
  below.
* `commentsTop()` — `.news-comments-container`, falling back to
  `.news-comments` and then `#commenttop`.

### Why the drift-correcting scroll strategy

`scrollIntoView` resolves its destination to a fixed scroll offset at
call time and animates to that number. Pinkbike lazy-loads article
images and injects ad / "deals" slots as you go down the page, so
anything that finishes loading *above* the target during the ~1s
animation pushes the target further down the document and we stop
short of it. Measured on a normal news article, `c` from the top of
the page landed 100–200px above the comments header, in the
related-articles filler.

Pinkbike is the site that motivated the `settle` strategy; the
mechanism (settle detection, correction limits, the clamped-scroll
bail-out) is documented in the library's doc.

### Logging

Every action emits a `[pb nav]` line of the form
`<key>: <action> -> <comment id>`, or
`<key>: <action> — nowhere to go from <comment id>`. Combined with
`initializing` and the generated `keys:` summary, that's enough to
tell "selector broke" from "edge case at the end of the list".

### If this breaks in the future

Triage in order:

1. Open DevTools, look for `[pb nav] initializing`. Missing → `@match`
   or install issue. If `initializing` appears but the `keys:` line
   doesn't, one of the `@require`d library files failed to load.
2. Press `c`. If the comments container is missing the script logs
   `c: no comments anchor found`.
3. Press `j`. If it logs `no comments found`, the `.cmcont` selector
   has changed — re-check the comment tree under `#comment_wrap`.
4. Press `p` while on a reply. If it says it has nowhere to go, the
   `commentreply2` class has been renamed or moved off the inner
   `.cmcont`, so `parentOf` is returning null for replies.
