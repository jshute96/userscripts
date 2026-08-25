# Pinkbike: Auto-close the floating footer ads

## Summary

Gets rid of the floating ad banners that Pinkbike pins across the
bottom of every page, covering the article text you're reading.

Pinkbike's own sticky footer never slides in at all: the script
dismisses it up front, before the page has a chance to show it. Ad
units injected by third parties can't be headed off that way, so those
are closed as soon as they appear instead.

## Visible changes

* The sticky footer ad that overlays the bottom of Pinkbike pages
  never appears at all — the script tells the page it has been
  dismissed before it gets a chance to slide in. If that isn't
  possible it falls back to closing the ad the moment it appears.
* The floating Underdog Media ad panel (the one with the small dog
  logo next to its X) is closed the same way.

## Implementation

### What Pinkbike's page looks like

Two independent ad units, from two different sources, each with its
own close control.

**Pinkbike's own sticky footer** — a Google Ad Manager slot
(`sticky-footer-pb`) wrapped in markup Pinkbike serves itself:

- `#nfs_footer` — the outer container. Present in the DOM whenever the
  ad is active. Hidden/shown via CSS (`style` and `class` attributes)
  rather than being added/removed.
- `#sticky-footer-pb-close` — the X inside it. The handler is actually
  an `onclick="nfs_footerClose()"` on the enclosing `#nfs_footer_ad`
  div; the click on the button bubbles up to it.
- Pinkbike's inline `document.onscroll` shows and hides this unit with
  jQuery `fadeIn("slow")` / `fadeOut("fast")`, based on where
  `#blog-head` and `#blog-foot` are relative to the viewport.
  `nfs_footerClose()` sets a `nfs_footer_hidden` flag that suppresses
  later fade-ins — but only for the page's own scroll handler.

**Underdog Media adhesion unit** — injected at runtime by a
third-party tag, so none of it is in the initial HTML:

- `.udm-inpage-footer-container` — `position: fixed; bottom: 0` with
  `z-index: 2147483647`; holds the whole floating panel.
- `.udm-close-button` — the dark tab's X. The click handler is on this
  `<div>`; the `<svg>` inside it carries a `udmIgnore` class, so click
  the div, not the svg.
- `.udm-site-button` / `.udm-adhesion-logo` — the small dog linking to
  underdogmedia.com. Useful for recognizing the unit in a screenshot,
  not used by the script.

Both containers can appear well after `document-idle`, and can toggle
visibility more than once during a page's life.

### What we assume

The script will break if any of these change:

1. `#nfs_footer` / `#sticky-footer-pb-close` keep their ids.
2. `.udm-inpage-footer-container` / `.udm-close-button` keep their
   class names — these belong to Underdog Media, not Pinkbike, so
   they survive a Pinkbike redesign but not an ad-vendor switch.
3. Both close buttons are direct click targets, i.e. `el.click()` is
   enough and no synthetic pointer events are needed.
4. Appearance and visibility changes show up as childList mutations or
   `style` / `class` attribute changes somewhere under
   `document.documentElement`.

### What we change

On `document-idle`, a single table of `{name, container, close}`
entries — plus an optional `preempt` — drives everything:

0. **Suppress the unit up front where the page lets us.** Pinkbike's
   own close button runs `nfs_footerClose()`, which hides the footer
   *and* sets a page-level `nfs_footer_hidden` flag that its scroll
   handler checks before every `fadeIn`. Calling that function
   ourselves at startup suppresses the unit for the life of the page:
   nothing is ever visible, not even for the length of a fade, and the
   slot stays `display: none`. A target opts in with
   `preempt: 'nfs_footerClose'`.

   It is reachable because the page declares it as a top-level
   function in a classic `<script>`, so it lands on `window`, and
   `@grant none` puts the userscript in that same world. **This is the
   one part of the script that depends on sandbox mode** — a manager
   running us in an isolated world would not see the function. Hence
   the `typeof` check, the 5s `PREEMPT_DEADLINE_MS` grace period for
   the page's scripts to run, and the fact that the whole click path
   below is kept as the fallback rather than replaced. A call that
   *throws* gets that same grace period rather than being fatal: the
   usual cause is the function existing before the slot it dismisses
   does, and treating the first throw as final dropped the unit to the
   click path for the life of the page — which means watching the ad
   slide in before it's closed, the thing preempting exists to avoid.
   The throw is logged once per unit, not once per retry. Verified: after
   the call, three synthetic scroll events that would otherwise fade
   the footer in leave it at `display: none`.

   The one cost is that this fires the site's `pb.analytics`
   `news-sticky-footer-ad-close` event on page load, i.e. it reports a
   close the user didn't manually perform. That is the same event a
   real close sends, and the script's whole purpose is to close the
   thing, so it's reported once rather than once per retry.

   The right-rail unit has an equivalent `nfs_sidebarClose()`, unused
   — we leave the sidebar alone (see the end of this file).

1. **Sweep once immediately**, then on every mutation. One
   `MutationObserver` on `document.documentElement` watches
   childList/subtree plus `style` and `class` attributes; its callback
   is coalesced through a 100ms timer, since ad loading generates
   mutation bursts.

   **Mutations are not the only thing that schedules a sweep**, and
   assuming they were was a bug (fixed in 1.3.0). Any path that
   declines to click *now* — a cooldown that hasn't expired, a
   `verify()` that found the click didn't stick — schedules its own
   follow-up sweep. Otherwise the retry waits for a mutation that
   never comes: the fade which undid the click is typically the
   page's last activity on a static article, and with `@noframes`
   nothing inside the embedded video counts. The observed symptom was
   an ad sitting open for the life of the page after exactly one
   failed click. `scheduleSweep(delay)` keeps whichever pending sweep
   is due soonest, so a mutation can still pull a cooldown retry
   forward.
2. **Close each visible container.** Both units are `position: fixed`,
   so `offsetParent` is always null and useless here; visibility is
   `display` / `visibility` / `opacity` from `getComputedStyle` plus a
   non-empty `getBoundingClientRect()`. (The udm unit hides itself by
   flipping `visibility` and `opacity`, not `display`.) When a
   container is visible, the script finds its close button *within*
   that container and clicks it.
3. **Click when the fade ends, detected rather than waited out.**
   `fadeIn("slow")` runs for ~600ms, and a click landing part-way
   through is undone by the remainder of the animation — the ad blinks
   shut and comes back. Through 1.2.x the script clicked immediately,
   lost that race, and only recovered on a retry `VERIFY_DELAY_MS`
   (then 1200ms) later, so the ad sat on screen for well over a
   second.

   Measured on a live article, `#nfs_footer` during a fade-in:

   | t | computed opacity | inline `style` |
   |---|---|---|
   | 0–586ms | 0 → 0.998 | `opacity: <n>; display: block;` |
   | 612ms | 1 | `display: block;` |

   jQuery holds an inline `opacity` for the whole ramp and *removes
   the property* in its completion step. So **full computed opacity
   with no inline `opacity` left** is a precise "the animation is
   over" signal needing no safety margin. The script polls every
   `POLL_MS` (50ms) while a unit is visible but unsettled, then clicks
   once. `SETTLE_MS` (120ms at full opacity) is the fallback for a
   unit that parks at inline `opacity: 1` and never animates, and
   `MAX_SETTLE_WAIT_MS` (1500ms) clicks anyway rather than watching
   forever something that never reaches opacity 1. That deadline runs
   from the start of the current fade, not from when the unit first
   appeared: a container that goes opaque and then fades again is
   starting a new animation, and a deadline that kept running would
   leave the settle gate open for every later click on that appearance.

   Because the click is now aimed at a settled unit, `VERIFY_DELAY_MS`
   (300ms) and `CLICK_COOLDOWN_MS` (250ms) no longer have to outlast a
   fade — they only cover a click that genuinely failed. Measured
   effect on the same ad: close lands at ~630ms instead of ~1170ms,
   with one click issued instead of two. (Each click also fires the
   site's `pb.analytics` close event, so single-clicking is the
   politer outcome too.)
4. **Keep watching after a successful close.** The observer stays
   connected for the life of the page and re-closes a unit that comes
   back — either because the site re-showed it, or because a click
   raced a fade. This was the original bug: v1.0.x set a `dismissed`
   flag on the first apparent success and disconnected, so anything
   that reappeared afterwards stayed on screen for good.
5. **Give up eventually.** After `MAX_ATTEMPTS` (12) *consecutive*
   clicks that don't stick, the script stops clicking that unit and
   says so; otherwise a changed close button means clicking forever.
   Consecutive failures back the cooldown off linearly (250ms, 500ms,
   750ms, …), so the budget spans ~16s rather than the 3s a flat
   250ms would give it. With the click aimed at a settled unit a retry
   is already rare, so repeated failures mean something is genuinely
   wrong — and each one fires the site's analytics close event.
   The count resets on every confirmed close, so a long read that
   re-shows the ad a dozen times doesn't exhaust the budget and report
   a break that isn't one. The observer disconnects only once every
   unit has been given up on.

Watching the whole document, rather than attaching to each container
as it appears, means a unit that gets re-injected after being closed
is picked up again with no extra bookkeeping.

### Ads rotate

Which ad network fills the floating slot varies from page load to page
load, so the two units above are unlikely to be the only ones. Adding a
newly-spotted one is a matter of appending a `{name, container, close}`
entry to `TARGETS`.

At 15s the script logs one status line per known unit, built from
every fact it has rather than the first one that applies:
`suppressed up front` (only when the preempt function returned
cleanly), then `not seen` / `closed xN` / `SEEN, GAVE UP`, then
`OPEN NOW` if the container is visible at that moment — e.g.
`sticky footer: suppressed up front, not seen` on a normal load, or
`suppressed up front, SEEN, GAVE UP, OPEN NOW` for a preempt that
returned cleanly without holding. Reporting only the first applicable
fact hid exactly that case, which is the break the line exists to
catch: "the ad wasn't served" and "the close path is broken" have to
stay distinguishable without DevTools open from page load.

Pinkbike's sticky right-rail ad, `#nfs_sidebar`, is left alone. It has
its own close button (`#sticky-right-rail-pb-close`) and could be added
to `TARGETS` if we ever want it dismissed automatically.
