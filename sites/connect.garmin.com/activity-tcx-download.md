# Garmin Connect: One-click TCX download

## Summary

Adds a Download button to the toolbar of every Garmin Connect activity
page, which exports that activity as a TCX file in one click.

Garmin's own export is three clicks deep — open the gear "More…" menu,
find "Export to TCX", click it, which is tedious.

## Visible changes

* A small download-arrow icon button appears in the activity-detail
  toolbar, immediately to the right of the gear ("More…") icon.
* Clicking it downloads the activity as TCX without any visible menu
  interaction (the menu is opened and the item clicked
  programmatically; both happen too fast to flicker visibly).

## Implementation

The activity toolbar lives inside a CSS-module flex container
`<div class="ActivityToolbar_activitySettings__<hash>">` containing
five children: `Edit`, `Favorite`, `Share`, `Privacy`, and the gear
("More…") menu wrapper. We append our button as a sixth child of
that row.

What we depend on:

* The gear button is one of three visually-identical `Menu_menuBtn`
  buttons in the row (Share / Privacy / Gear all share the same
  outer class and `aria-label="Toggle Menu"`). We identify the gear
  by its semantic outer container class
  `ActivitySettingsMenu_menuContainer` (matched by prefix because of
  the build-hash suffix). The same container also carries
  `title="More..."`, so that's a viable secondary identifier if the
  CSS-module name ever changes.
* The gear's container ancestor matches `ActivityToolbar_activitySettings`
  (CSS-module prefix). We walk up at most six levels from the gear
  button looking for that class — robust to small hash changes.
* The menu opens in-place inside the gear's `Menu_menuWrapper` div:
  when closed, that wrapper contains `<div class="Menu_menuNone…">`;
  when open, it contains `<div class="Menu_menuItemWrapper…">` with
  `<div class="Menu_menuItems…">` children for each menu entry.
* Menu items are plain `<div>`s (not `<button>` or `<a>`), with
  React `onClick` handlers. Calling `.click()` on the matching item
  fires the export the same way a real user click does.
* The Garmin SPA rebuilds the toolbar when navigating between
  activities. A `MutationObserver` on `document.body` re-adds our
  button whenever it disappears.
* Garmin Connect is a single-page app. `@match` is broadened to
  `/app/*` so the script is registered on whatever page the user
  initially loaded, and we re-evaluate on every SPA navigation
  (`popstate` plus a wrapper around `history.pushState` /
  `replaceState`). All work paths (initial run, URL-change handler,
  MutationObserver) gate on `/^\/app\/activity\//` against
  `location.pathname` so the script no-ops outside activity pages.

Click sequence:

1. `.click()` the gear button — React opens the menu synchronously,
   but we defer one `setTimeout(0)` tick (50ms) before reading menu
   items so React's commit phase has flushed.
2. Find the menu item whose text matches `/^export to tcx$/i`.
3. `.click()` it. The browser starts the TCX download.
4. If for some reason the item isn't found (Garmin rename / removal),
   we close the menu by clicking the gear again and log the failure.

The button's icon is an inline SVG (download arrow into tray) sized
to the 14px of neighbouring icons. Styling uses Garmin's CSS
variables (`--border-default`, `--background-alt`, `--text-default`)
so it adapts to light/dark themes.
