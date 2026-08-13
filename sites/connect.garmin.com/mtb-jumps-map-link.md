# Garmin Connect: Improve UI in MTB Dynamics jumps view

## Summary

Garmin Connect's MTB Dynamics view shows jumps on the map and in a table
but has no UI to match them up, or find specific jumps.

This script links them.  Jumps in the map get labeled with their ID in
the table (e.g. "Jump 3"), and clicking them highlights the corresponding
row in the table.  Clicking rows in the table selects the row and
also the corresponding jump on the map (scrolling it into view if necessary).

This also adds a **Hide Charts** button, since the stack of charts between
the map and the jumps table otherwise means scrolling back and forth
past them.

**Example:**

![Jump 3 selected, with the charts hidden](screenshots/mtb-jumps-map-link.png)

## Visible changes

* Map jump popups are titled "Jump 12" instead of "Jump", and gain a
  `Score:` line (which the table has and the popup didn't).
* Rows in the jumps table are clickable — clicking one opens that
  jump's popup on the map, panning the jump into a comfortable part of
  the map (not squeezed against an edge with the bubble clipped) and
  scrolling the map into view if it's off screen.
* The selected jump's row is highlighted in amber, whether you picked
  it from the table or from the map. It stays on the right jump when
  you re-sort the table, and clears when you close the popup.
* Row hover gets a highlight and a pointer cursor to advertise this.
* A **Hide Charts** / **Show Charts** button sits immediately right of
  Customize Charts, styled to match it, collapsing the charts so the
  map and the jumps table are on screen together. The state carries
  across activities within a session.

## Implementation

### What the page gives us

The MTB Dynamics tab and the map markers are both rendered from one
array held in React state:

```js
jumps: [{ score, hangTime, distance, timestamp, latitude, longitude, speed }, …]
```

Notably there is **no per-jump ID**. The "jump number" shown in the
table is just the 1-based array index, and the map markers are created
in the same array order. Garmin's own code therefore relies on
positional identity too — there is nothing better available.

None of that reaches the DOM:

* **Map markers** are bare `<img src="/images/feature/mtb/jump.svg"
  class="leaflet-marker-icon …">` inside `.leaflet-marker-pane`, with
  only a pixel `transform`. No `data-*`, no id, no title.
* **Table rows** (`table[class*="mtbJumpsTable"]`) are plain `<td>`s.
  The jump number is text in cell 1; cells are
  `[icon, number, score, distance, hang time, speed]`.
* **Popup content** is bound to the marker up front, not fetched:
  clicking a marker issues no network request. The popup body is
  `<b>Jump</b>` followed by one `<div>` per metric —
  `Distance: 2.49 m` / `Hang time: 0.50 s` / `Speed: 17.8 kph`.
  No number, no score.

### How we link them

Two independent mechanisms, which cross-check each other:

1. **Popup → jump number, by metrics.** Distance + hang time + speed
   together are unique across a ride's jumps (verified on a 36-jump
   activity: zero duplicate triples), so we parse those out of the
   popup and look up the matching table row. This needs no assumption
   about ordering, and it gives us the score to add as well.

2. **Table row → marker, by position.** Marker *n* in DOM order is
   jump *n*. Verified on the live page for jumps 1, 3, 5, 7, 12, 20,
   33, 34 and 36, and geometrically: walking the 36 markers in DOM
   order traces the route (~1642 px of path) versus ~7983 px for a
   random ordering.

When the MTB Dynamics tab isn't open the table isn't in the DOM at
all, so (1) can't run; the script falls back to the index of the
marker that was clicked (tracked by a document-level capture-phase
click listener, which sees both real clicks and the synthetic ones we
make from a row click). In that case the popup gets a number but no
score.

When both are available and they disagree, we log a warning. That's
the canary for Garmin changing marker emission order, which is the
one thing direction (2) depends on.

### Selection highlight

Garmin already tints one row — the best jump — with
`rgba(84, 169, 254, 0.2)` (light blue) applied to the `<tr>` via a
`Tabs_active__*` class. Ours has to be visibly a different thing, and
has to win when both land on the same row, so it's amber
(`rgba(245, 166, 35, 0.32)` plus a 3px inset bar on the first cell)
and is declared last at higher specificity
(`table[class*="mtbJumpsTable"] tbody tr[data-mtb-jumps-selected]`
beats a bare class on the `<tr>`).

The selected jump is kept as a **number in a variable**, not as state
on a row element. Sorting the table reorders rows *and* rewrites their
cells, so a highlight pinned to an element would end up on the wrong
jump; instead a MutationObserver on `tbody` re-derives which row to
mark from the number whenever the table changes. That observer watches
`childList`/`characterData` only, never attributes, so our own
`data-mtb-jumps-selected` writes don't re-enter it.

Keeping it out of the DOM also means it survives the MTB Dynamics tab
being switched away and back, which destroys and rebuilds the table.

Selection is set from both directions (row click, and popup labelling
covers marker clicks) and cleared when the popup closes — Leaflet
removes the popup element entirely on close, which the popup-pane
observer already sees.

### Hiding the charts

The charts live in `div.activity-charts`, whose direct children are the
toolbar row (Customize Charts + the Time/Distance toggle) followed by
one element per enabled chart — 5 on an MTB ride with Flow and Grit, 3
without. `activity-charts` is a plain semantic class, not a CSS module,
so it has no build-hash suffix to rot.

Hiding is a `data-jshute-charts-hidden` attribute on `<html>` plus one
rule:

```css
html[data-jshute-charts-hidden] .activity-charts > *:not(:first-child) { display: none; }
```

Not inline styles on each chart: React rebuilds them on the
Time/Distance toggle and on any Customize Charts change, which would
wipe inline styles, and `<html>` is outside React's tree entirely so
nothing the app does can clear the flag. That's also why the state
carries across SPA navigation to another activity.

The button is inserted after the Customize Charts button, **found by
its label**. "First button in the first cell of the toolbar row" looks
equivalent and isn't: the toolbar's two cells render at slightly
different times, and running in the window where only the
Time/Distance cell exists anchors onto the "Time" button — which also
means adopting its segmented-control styling. (This happened.) The 1s
re-check also moves the button back and re-copies the className if it
ever ends up somewhere else, so a bad first placement heals itself.

The button appears on every activity page, not only MTB ones. It was
briefly gated on the MTB Dynamics tab, which created a dead end: the
hiding rule keys off `<html>` and survives SPA navigation, so hiding
the charts on an MTB ride and then navigating to a run left the charts
hidden with no button to bring them back.

### Other things worth knowing

* **Row clicks activate the marker by keyboard, not `.click()`.**
  Leaflet silently drops a synthetic click on a marker in some map
  states — reproducibly after zooming in, panning, and zooming back
  out. The click event fires on the element, but Leaflet never routes
  it to the marker (it dispatches from the map container via an
  internal target table, and markers carry no click handler of their
  own), so no popup opens. It stays that way until the user clicks a
  marker for real, which is exactly the "map highlight is stuck on one
  jump while the table keeps updating" symptom.

  The markers are `tabindex="0" role="button"`, and Leaflet's keyboard
  path opened the popup in every state we could produce, including the
  broken one. So we `focus({preventScroll: true})` and dispatch
  Enter (`keydown`/`keypress`/`keyup`). Focusing also makes Leaflet pan
  the marker into view, which is what we want for a jump that's off
  the edge of the map. `.click()` remains as a fallback if the popup
  doesn't appear within 600ms, and a failure to open either way is
  logged.
* **We pan the map ourselves before opening the popup.** Leaflet's own
  panning — `_panOnFocus` on marker focus, and the popup's autoPan —
  brings the *marker* only just inside the map edge, which routinely
  left the bubble clipped or entirely above the top edge, since the
  bubble is drawn upwards from the marker.

  **It takes two boxes.** A jump inside `ACCEPT_BOX` (25%–75% across,
  50%–75% down) is left alone, so clicking through nearby jumps doesn't
  shove the map on every click. One outside it is panned the minimum
  distance needed to sit inside the smaller `TARGET_BOX` (35%–65%,
  55%–70%), which keeps as much of the surrounding trail in place as
  possible.

  The two boxes must be different, and that's the whole trap. Panning
  moves the minimum distance — `map.panInside()` is built on exactly
  this — so if the box you test against is also the box you pan into,
  every jump that needed moving lands precisely **on** the line that
  defines "badly placed": hard against the edge, bubble jammed against
  the map's top, indistinguishable from the framing never running.
  Widening a single box only relocates that edge, so the symptom
  survives it. (This was the first attempt, and it's why jumps kept
  arriving at exactly 45% down.)

  Both boxes sit below center because the bubble is drawn upwards from
  the marker and needs ~155px above it. `ACCEPT_BOX`'s top bounds the
  worst case allowed to stay put: 0.5 leaves ~45px of bubble clear,
  0.45 left only ~25px, which still read as jammed.

  The pan is deliberately **not animated**. It settles before we
  activate the marker, so Leaflet's focus-pan and popup autoPan see a
  view that already suits them and never fight our position.

  Note the marker's *anchor* is its center, not the bottom of its
  icon — measure against the anchor when checking any of this.

* **Framing inside the map isn't enough on its own.** The map is only
  400px tall and sits near the top of a long page, so it's easily half
  scrolled off the window — and then a bubble that's correctly placed
  *within the map* is still above the top of the window. Any row click
  that finds the map not fully visible scrolls it into view first.

  Getting at the `L.Map` object is the awkward part — Leaflet puts no
  back-reference on the container, and the map *instance* only exists
  in the react-leaflet context, so we walk the container's fiber chain
  looking for an object that quacks like a Map (`panInside` +
  `containerPointToLatLng`) rather than hardcoding a path. If it isn't
  found, framing is simply skipped and everything else still works.
  Nothing here needs the page's `window.L` global — `panBy` takes a
  plain `[x, y]`, so that's one less thing to depend on. The marker's latlng comes off the Leaflet layer
  (`map._layers[…]._icon === markerEl`), not from the icon's on-screen
  rect, which is mid-flight during a pan animation and would convert
  to the wrong position.
* Leaflet binds marker activation to *toggle*, so activating a marker
  whose popup is already open would close it. Row clicks check the open
  popup's number first and skip when it's already showing.
* **Opening is async, so row clicks carry a sequence number.** Each
  click bumps `openRequestId`; the wait resolves false the moment a
  newer click supersedes it, and a superseded request returns without
  logging or falling back. Without that, clicking two rows in quick
  succession could let the older request's `.click()` fallback fire
  *after* the newer popup opened, reopening the wrong jump. The wait
  also checks for *this* jump's popup rather than any popup, so one
  request can't mistake another's popup for its own success. The
  fallback additionally requires that nothing is showing, since
  clicking a marker whose popup is up would toggle it shut.
* **Leaflet creates one popup per marker and reuses that same content
  node for the life of the page.** Nearly every bug in this file traces
  back to forgetting that — work skipped as "already done" on the first
  open stays skipped forever, including on a later open when the
  missing information is finally available:
  - Don't mark the content with a "we already looked at this" flag: set
    at a moment when the jump couldn't be identified (popup open before
    the MTB Dynamics tab was, so no table to match against), it leaves
    that jump unlabelled for good. "Already done" is derived from the
    title text instead — `Jump` needs labelling, `Jump 12` doesn't.
  - A popup numbered from marker order alone has no Score line, because
    there was no table to read a score from. So an already-numbered
    popup is still revisited to fill that in once a table exists.
  - **Don't hang anything else off the labelling branch.** The table
    selection was originally set there, which meant clicking a jump on
    the map only moved the row highlight the *first* time that jump was
    opened — reliably, then never again. Selection is now read back off
    whichever popup is open, independently of whether it needed
    labelling.

  The 1s tick also re-runs this on an open popup, since opening the tab
  mutates nothing inside the popup pane and the observer alone would
  never revisit it.
* Garmin builds these popups with `closeButton: false`, so there's no
  close control to click — a popup is dismissed by re-clicking its
  marker or clicking the map background. Both close paths clear the
  row selection.
* The table is sortable, so row order is not jump order. We always
  read the number from cell 1, never from the row index.
* Row clicks are handled by one delegated document-level listener, so
  they survive the table re-rendering on every sort and tab switch.
* Popup content is rebuilt by Leaflet on each open, so we watch
  `.leaflet-popup-pane` with a MutationObserver rather than any
  individual popup, and mark decorated content with
  `data-mtb-jumps-numbered` (both for idempotency and so re-entrant
  mutations from our own edits terminate).
* The map can be rebuilt underneath us and the MTB tab appears late,
  so a 1s interval re-checks that the popup-pane observer is still
  attached. We deliberately don't observe `body` — the recharts
  charts churn the DOM on every hover.
* Only jump markers have a bare `Jump` popup title; the start/finish
  and player markers don't open popups at all, so the title check is
  enough to leave them alone.

### What we assume stays stable

* `.leaflet-marker-pane img[src*="/mtb/jump"]` finds exactly the jump
  markers, in jump order.
* `table[class*="mtbJumpsTable"]` with cells
  `[icon, number, score, distance, hang time, speed]`.
* The popup body labels `Distance` / `Hang time` / `Speed`, formatted
  identically to the table cells (we compare the strings verbatim, so
  a unit change on one side but not the other would break matching —
  it would fall back to marker order, and log the disagreement).
* The map is Leaflet (`Web.MapView.LeafletEnabled` is a user
  preference — if Garmin ever serves a non-Leaflet map, the popup
  selectors go away entirely).
* `div.activity-charts` wraps the chart stack, with the toolbar as its
  first child and one element per chart after it, and that toolbar
  holds a button labeled "Customize Charts".
