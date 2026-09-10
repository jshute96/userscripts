# Medium: Keyboard comment navigation

## Summary

This adds keyboard shortcuts for navigating the responses on a Medium
story.

`c` opens the responses, `j` / `k` go to next / previous. Other keys are listed below.<br>
`?` opens help showing all the keys.

A story page shows only the first few responses inline; the rest live
in a side drawer. `c` opens that drawer, and once it's open `c` goes to
the first response and the rest of the keys move through the thread.

Medium's replies nest, so `p` (parent), `r` (thread root) and `n` (skip
past this reply subtree) all do real work — on threads whose replies
you've expanded, which is where the navigation earns its keep.

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
* `c` on a story opens the responses drawer; pressing it again scrolls
  to the first response.
* When the drawer opens with the response composer focused, the caret
  is moved off it so the navigation keys work straight away.
* No visible markup changes — the script only attaches a `keydown`
  listener.

## Implementation

The behavior lives in
[`lib/keyboard-comment-nav.js`](../../lib/keyboard-comment-nav.js) and
[`lib/keyboard-shortcuts.js`](../../lib/keyboard-shortcuts.js); this
script is just Medium's selectors and its `parentOf`.

### Where it runs

`@match https://medium.com/*` and `@match https://*.medium.com/*`.
Stories are served from both — `medium.com/@author/slug` and
`author.medium.com/slug` are the same story — and Medium is a
single-page app, so the whole site is matched and everything but `c` is
gated on the drawer being open. The gate is evaluated per keypress, so
no `urlchange` listener is needed.

Publications on their own custom domains aren't covered. Medium has
been winding that feature down, and a match pattern can only test the
URL, so there's no path shape to key on the way Substack's `/p/` gives.

### What we depend on

Medium ships **atomic CSS**: every class is a two- or three-letter name
(`aer`, `ahc`, `vs`, `gx`) standing for one declaration, assigned per
build. They carry no meaning and rotate on every deploy, so nothing
here matches on a class. What the responses markup does have:

| Anchor | Used for |
| --- | --- |
| `button[aria-label="Response options"]` | The "..." menu — exactly one per response, and nothing else on the page uses that label. This is how responses are found at all. |
| `<pre>` | The response's prose. Used for viewport intersection. |
| `a[href*="source=responses"]` ending in `-<hex id>` | The response permalink, which gives the log label. |
| `button[aria-label="responses"]` | The speech-bubble button with the response count, in the story's sticky top bar and its footer action bar. Opens the drawer. |
| `[role="dialog"]` with an `aria-hidden="false"` child panel | The open drawer. |

**The response card is 7 levels above its "..." button**, and that
distance is the one structural assumption here — no element in the
chain is distinguishable by class or attribute:

```
button[aria-label="Response options"]
`- div                    (display: contents wrapper)
   `- div                 (menu anchor, aria-describedby)
      `- div              (header row: avatar, name, date, menu)
         `- div           (card content: header + body + actions)
            `- div
               `- div
                  `- CARD
```

We want the card rather than the content block because a response's
replies are nested *inside* the card, under a sibling of the content
block. That's what makes `parentOf` a plain containment test, at
arbitrary depth — verified on a three-level thread, where `p` from a
second-level reply lands on the first-level one and not on the root.

`cardsIn` checks the distance on every lookup: the card's first "..."
button in document order must be the one we walked up from. If Medium
adds or removes a wrapper, that check fails and the script logs an
error naming the depth, rather than silently navigating a flatter tree
than the page has.

### What we assume stays stable

* `aria-label="Response options"`, `aria-label="responses"`, and the
  `?source=responses` query on response links.
* Response prose in a `<pre>`.
* The 7-level card depth above (self-checked, as described).
* The drawer is a `[role="dialog"]` whose visible panel is the child
  with `aria-hidden="false"` — the dialog itself stays in the DOM,
  zero-height, while the drawer is closed, so its presence proves
  nothing.
* Replies live inside their parent's card.

Known gap: `drawer()` requires the open panel to contain at least one
response card, so on a story with *no* responses it never reports open.
`j`/`k` then have nothing to move through, which is correct, but `c`
keeps clicking the toggle rather than recognizing the drawer it already
opened. Not worth a fix until it bites — loosening the test risks
matching some other Medium dialog.

### Focus, and why the keys can go dead

For a signed-in reader Medium mounts a response editor at the top of
the drawer — Slate, as
`div[role="textbox"][data-slate-editor="true"][contenteditable="true"]`
— and opens it with the caret already in it, about a second after the
drawer appears. That is fatal rather than merely annoying: the shared
shortcut layer ignores every key while the caret is in an editable —
deliberately, so that typing a response doesn't scroll the thread — and
`c` is a key too, so the drawer opens and then swallows everything,
with no way back from the keyboard.

So `open.click()` follows up with `releaseComposerFocus()`, which waits
for the caret to land in an editable inside the dialog and moves it
somewhere harmless. Three things had to be right, and each was wrong in
a way that looked like the whole fix doing nothing:

**1. Listen, don't poll.** The moment we're waiting for is neither ours
nor quick: the drawer mounts, and only *then* does Medium load the
editor bundle and focus it. A `focusin` listener doesn't have to guess
when that is.

**2. Move the caret to an element of our own.** Not the dialog: Medium
wraps the drawer in react-focus-lock, which treats focus landing on the
locked container itself as focus that escaped and redirects it to the
first tabbable inside — the composer we just left. Not the close button
or one of the drawer's links either, the other ready-made focusables: a
later Space or Enter would then close the drawer or follow a link
instead of scrolling. So the script inserts its own target — an empty
`div[data-medium-cnav-focus]` with `tabindex="-1"`, zero-sized and
absolutely positioned. It satisfies the lock (it *is* inside the locked
container), it swallows no keys, and Space still scrolls.

**3. Let Medium finish first, then check that it stuck.** Moving the
caret in the same tick as the `focusin` just gets it put straight back —
Medium's own focus work isn't done yet. The script waits ~700ms, moves
it, then re-checks and retries a few times before giving up. Whether the
move stuck is not something to assume: the first version assumed it, and
the failure was invisible because it was reported through `console.warn`,
which the test harness wasn't capturing.

Two things it must never do, both verified against a signed-in account:

* **Steal a draft.** It stands down if the composer holds anything the
  reader typed. Note that `textContent` alone gets this wrong, and only
  once the editor is fully mounted: Slate renders its placeholder as a
  real span inside the editable (`data-slate-placeholder`), so an
  untouched composer reads as "What are your thoughts?" and every empty
  one looks like a draft. Immediately after mount it's still a lone
  zero-width character, which is why a check that ran early appeared to
  work. `isEmpty` drops the placeholder before reading.
* **Fight the user.** A `mousedown`, or a `Tab`, once armed is the user
  placing the caret deliberately, and stands the watch down. That guard
  is also what makes the long (10s) watch safe: short of those, the only
  way to reach the end of it is Medium moving focus on its own.

  It is deliberately *not* every keystroke. Standing down on any key
  broke the most natural flow there is — `c`, then `j` a moment later,
  before the editor has even loaded. That `j` killed the watch, the
  composer took focus unopposed, and the keyboard went dead for good.

### Closing the window, rather than shrinking it

Between Medium focusing the composer and the script moving the caret off
it there is about a second, and a key pressed inside it goes to the
composer. That is worse than a swallowed keystroke: `j` *types a "j"*,
which leaves a draft — and the draft rule above then refuses to touch
the composer, so a single fast keypress wedges the keyboard for good.
Settling faster doesn't help; every window has the same race.

So the script doesn't race it. A `keydown` listener on `document` in the
**capture** phase runs ahead of both Slate (a descendant) and the
shortcut layer (which listens on `document` while bubbling), and while
the caret is in an empty composer it takes the keystroke away before it
can become text: `preventDefault`, move the caret to the holder, then
re-dispatch the key there so it still does what the reader meant.

Only the keys this script binds are taken. Anything else is the reader
starting to write, so it types normally and the watch stands down —
which is also what happens the moment the composer holds any text.

Verified with *trusted* key events (CDP `Input.dispatchKeyEvent`); a
synthetic `keydown` never inserts text, so it would hide exactly the
behavior under test:

| Key, pressed while the composer holds focus | Composer | Focus ends | Result |
| --- | --- | --- | --- |
| `j` | stays empty | holder | `j: next -> …` — navigates |
| `x` | `"x"` | composer | watch stands down; reader is writing |

If focus reaches the composer some other way — clicking into it, or a
route this doesn't cover — the keys stay dead until you click outside
it, and Esc closes the drawer. That's the shortcut layer working as
intended, not this script failing.

**Any of this needs a signed-in profile to test.** A signed-out reader
gets no editor at all — the drawer shows "Create an account to write a
response" — so the caret never moves, every timing looks equally fine,
and a fix that does nothing passes. Two rounds were lost to that here
before the test browser was logged in. A stand-in `contenteditable` is
not a substitute: it has no placeholder, no focus lock and no autofocus
retry, which are precisely the three things that were wrong.

### Scrolling

The drawer scrolls in a container of its own, not the window, so
`container()` finds it and `strategy: 'container'` scrolls it. Both the
panel and one descendant have `overflow-y: auto`; the one that actually
scrolls is the inner one, so the lookup takes the deepest scrollable
element that still holds response cards.

Nothing inside the drawer is sticky — the heading, the composer and the
sort control all scroll away with the content — so no `headerOffset` is
needed.

### A note for anyone testing this over CDP

A Chromium window that's hidden or fully occluded reports
`document.visibilityState === "hidden"`, and there the browser runs no
`requestAnimationFrame` callbacks and does not animate smooth scrolls.
Every scroll in this script then silently does nothing, which looks
exactly like the container lookup being wrong — it cost a wrong
diagnosis here ("smooth `scrollTo` no-ops on this container, use the
`raf` strategy") before the window was raised and both worked fine.
Raise the window (`wmctrl -i -a <id>`) before measuring anything that
scrolls.
