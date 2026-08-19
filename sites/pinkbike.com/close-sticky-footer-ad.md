# Pinkbike: Auto-close the floating footer ads

## Summary

Closes the floating ad banners that Pinkbike pins across the bottom of
every page, as soon as they appear.

## Visible changes

* The sticky footer ad that overlays the bottom of Pinkbike pages is
  closed automatically the moment it appears.
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
entries drives everything:

1. **Sweep once immediately**, then on every mutation. One
   `MutationObserver` on `document.documentElement` watches
   childList/subtree plus `style` and `class` attributes; its callback
   is coalesced through a 100ms timer, since ad loading generates
   mutation bursts.
2. **Close each visible container.** Both units are `position: fixed`,
   so `offsetParent` is always null and useless here; visibility is
   `display` / `visibility` / `opacity` from `getComputedStyle` plus a
   non-empty `getBoundingClientRect()`. (The udm unit hides itself by
   flipping `visibility` and `opacity`, not `display`.) When a
   container is visible, the script finds its close button *within*
   that container and clicks it.
3. **Verify after the fade, not immediately.** `fadeIn("slow")` runs
   for ~600ms, and a click landing part-way through is undone by the
   remainder of the animation — the ad blinks shut and comes back. So
   the result is checked `VERIFY_DELAY_MS` (1200ms) after the click,
   and a target is not re-clicked within `CLICK_COOLDOWN_MS` (1000ms),
   which also keeps the flurry of per-frame `style` writes during a
   fade from burning through the attempt budget in one second.
4. **Keep watching after a successful close.** The observer stays
   connected for the life of the page and re-closes a unit that comes
   back — either because the site re-showed it, or because a click
   raced a fade. This was the original bug: v1.0.x set a `dismissed`
   flag on the first apparent success and disconnected, so anything
   that reappeared afterwards stayed on screen for good.
5. **Give up eventually.** After `MAX_ATTEMPTS` (10) clicks that
   don't stick, the script stops clicking that unit and says so;
   otherwise a changed close button means clicking forever. The
   observer disconnects only once every unit has been given up on.

Watching the whole document, rather than attaching to each container
as it appears, means a unit that gets re-injected after being closed
is picked up again with no extra bookkeeping.

### Ads rotate

Which ad network fills the floating slot varies from page load to page
load, so the two units above are unlikely to be the only ones. Adding a
newly-spotted one is a matter of appending a `{name, container, close}`
entry to `TARGETS`.

At 15s the script logs one status line — each known unit as `not seen`,
`closed xN`, `closed xN but OPEN NOW`, or `SEEN, GAVE UP` — so "the ad
simply wasn't served on this page" is distinguishable from "the close
selector broke" without having DevTools open from page load.

Pinkbike's sticky right-rail ad, `#nfs_sidebar`, is left alone. It has
its own close button (`#sticky-right-rail-pb-close`) and could be added
to `TARGETS` if we ever want it dismissed automatically.
