# Feedly: Scroll Index page to top

## Summary

Scroll Feedly's Index page (`/i/feedIndex`) to the top when you navigate
to it, instead of landing part-way down the page.

Going to the Index — e.g. with the `g` then `i` keyboard shortcut — used
to leave you part-way down the page, near the bottom, so you had to
scroll back up before you could read it.

## Visible changes

* Navigating to the Index page puts you at the top of it, including via
  the `g` then `i` keyboard shortcut.
* Nothing else is touched: the scroll position is set once on arrival
  and never adjusted again, so the script can't fight you while you read.

## Implementation

### What we observed

Comparing whole-page HTML snapshots of a feed stream page and
the Index page, the ancestor chain is identical down to the last level:

```
body > #root.fx > … > .FeedlyChrome > #feedlyContainer > #feedlyFrame
     > .FeedlyFrame__body > main#feedlyPageHolderFX
        > .Page__wrapper--extraWide              (feed stream)
        > .Page__wrapper--default > .IndexPage   (Index)
```

Only the `.Page__wrapper` child is swapped on navigation.

**`div#feedlyFrame` is the scroller, not the document.** With the Index
page sitting in its wrong scrolled-down state:

```js
window.scrollY                        // 0
document.documentElement.scrollTop    // 0
// the only element with scrollTop > 0:
// DIV#feedlyFrame  scrollTop=574.5  scrollHeight=4967
```

It's an inner overflow container sized to the viewport, so its scrollbar
sits at the right edge and looks exactly like the window's — which is
what led earlier versions of this script to target the window. Every
`window.scrollTo(0, 0)` they issued was a silent no-op, and because the
poll's trigger also read `window.scrollY` it saw 0 forever and never
fired. Anything that reads or writes scroll position here must go through
`#feedlyFrame`.

The lesson worth keeping: a right-edge, full-height scrollbar is **not**
evidence that the document scrolls, and an HTML snapshot can't tell you
either (the `overflow` lives in a stylesheet). Ask the live page which
element has `scrollTop > 0`.

**The offset is carried over from the previous route.** `#feedlyFrame` is
outside the part of the tree that Feedly's router swaps, so it survives
navigation with its `scrollTop` intact. Scroll a long way down a feed,
press `g`,`i`, and the Index renders inside a container still scrolled to
where you were reading. A log line from a working run:

```
[feedly index-top] arrived at Index; scrollTop now 4560.18
```

Resetting `scrollTop` once, at the route change, is what actually fixes
it. Nothing re-scrolls the container afterwards — a 3 s poll that watched
for exactly that never fired once, which is why it's gone (see "What we
deliberately removed").

**Why the symptom varies.** The inherited offset is clamped when the
Index's content swaps in, and the result depends on how much of the Index
has rendered at that instant. Measured directly over CDP: a feed scrolled
to 1787 landed the Index at 686 — exactly the maximum scroll for its
1587px content — i.e. pinned to the bottom. But in a cold tab, where the
Index is barely taller than the viewport when the swap happens, the same
inheritance clamps to ~0 and the page looks fine by accident. So "it
worked that time" is not evidence the script ran, which is worth
remembering before concluding anything from a single observation.

Getting here took several wrong turns worth recording, all of them
downstream of one bad measurement. Because the early versions read
`window.scrollY` (always 0 here) they concluded the scroller was at the
top on arrival, and therefore that some *later* event must be doing the
scrolling. That produced a settle-window poll, an arrival cooldown, and
transient-path tolerance — machinery built to catch a jump that never
existed, all since deleted. The load-bearing line is the single
`scrollToTop()` in `onUrlChange()`.

### Testing

`scroll-index-to-top.spec.js` drives the real `g`,`i` shortcut against a
logged-in profile. Two things it has to do that aren't obvious:

* **Warm the Index first** (`warmIndex()`), so its content is rendered
  when the swap happens — see "Why the symptom varies" above.
* **Pick a feed with enough articles** (`MIN_FEED_SCROLL_HEIGHT`). Many
  feeds hold one or two, and scrolling those can't produce an offset
  larger than the Index's own maximum scroll.

It asserts on the offset the userscript *reports* at arrival
(`scrollTop now N` from the console log) rather than on a script-free
control run, because the clamping above makes the no-script outcome
environment-dependent. The spec file has a comment explaining this.

### What we assume stays stable

* Path of the Index page: `/i/feedIndex`. A fresh document load can start
  at `/i/index` and get rewritten to `/i/feedIndex` shortly after, so the
  script matches both.
* `div#feedlyFrame` is the scrolling element. If a redesign moves
  scrolling elsewhere, the read (`currentScroll()`) and the write
  (`scrollToTop()`) must be updated **together** — a mismatch between
  them is exactly how this script spent several versions doing nothing.
  There's a window fallback for the case where `#feedlyFrame` disappears
  entirely, and it is wired on both sides.
* Feedly is a SPA that navigates via `pushState`/`replaceState`.

### How it works

* `@match https://feedly.com/*` (broad, per the repo's SPA convention),
  gated inside the script on `location.pathname`.
* `pushState`/`replaceState` are patched to fire a script-scoped
  `feedly-index-top:urlchange` event; `popstate` is also handled.
* On the **transition** into the Index page — `isIndexPage()` true when
  it was false on the previous route event — the script resets
  `#feedlyFrame.scrollTop` to 0. That's the entire fix.
* Acting on the transition, not on every route event, is what keeps the
  script from yanking the page back to the top after you've deliberately
  scrolled down: Feedly emits several history events per visit to the
  Index. The `wasIndex` flag starts `false` so an initial document load
  directly on the Index still counts as an arrival.

### What we deliberately removed

Version 1.x accumulated a lot of machinery to defend against a scroll
jump that, once measured properly, turned out not to exist. All of it was
built while the script was reading `window.scrollY` (permanently 0 here),
which made it look like the container was at the top on arrival and
therefore that *something later* must be scrolling it. Deleted in 2.0.0,
recorded here in case a symptom ever justifies bringing one back:

* **A settle poll** re-asserting `scrollTop = 0` every 100 ms for 3 s
  after arrival, in case a late render restored the offset. It never once
  logged a correction, in any environment. Bring back if the Index is
  ever observed scrolling itself *after* landing correctly.
* **An arrival cooldown** (`REARM_MS`, 10 s) that ignored route events
  soon after a reset. The `wasIndex` transition check now covers the same
  ground with no timer.
* **Transient-path tolerance** — skipping poll ticks on a non-Index path,
  and confirming departures 500 ms later. This was a response to an
  ambiguous log line (two code paths shared one message), and transient
  paths were never actually confirmed. If reset-on-arrival ever fires
  while you're already sitting on the Index, this is the suspect: it
  would mean Feedly briefly reports a non-Index path mid-visit, making
  the return look like a fresh arrival.
* **User-scroll cancellation** (`wheel`/`touchstart`/scroll-key handlers
  that stopped the poll). With no poll, there's nothing to fight: the
  script touches the scroll exactly once per arrival and never again.
* Logs under the `[feedly index-top]` prefix, now just two lines: `init`
  on load, and one `arrived at Index; scrollTop now N` per arrival. If
  you see more than one arrival line for a single visit, the transition
  check has broken.
* **First thing to check if it breaks again:** the `scrollTop now N` value
  in the arrival log. A plausible non-zero number means the script is
  measuring the right element and the reset is the thing to investigate.
  A constant `0` means the scroller moved again and `currentScroll()` is
  reading the wrong element — re-run the probe from "What we observed".
