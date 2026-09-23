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

* The gear button is one of three visually-identical
  `Button_btn … Button_iconButton` buttons in the row (Share / Privacy /
  Gear, each the only `<button>` child of its own container div). We
  identify the gear by its container's class
  `ActivitySettingsMenu_menuContainer` (matched by prefix because of
  the build-hash suffix). The same container also carries
  `title="More..."`, so that's a viable secondary identifier if the
  CSS-module name ever changes.
* The gear's container is a direct child of the toolbar row, matched
  by `ActivityToolbar_activitySettings` (CSS-module prefix) via
  `closest()`.
* The menu opens inside the gear's container: when open, the container
  gains a `<div>` wrapping an absolutely positioned
  `<div class="ActionMenu_menu…">`, whose entries are
  `<button class="ActionMenuItem_actionMenuItem…">`. They appear a few
  ms after the click, not synchronously.
* Calling `.click()` on the gear and on the matching item works the
  same as real user clicks.
* Our button copies the gear's `className`, so it takes Garmin's
  current icon-button styling without hardcoding hash suffixes.
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

(Up to September 2026, the gear sat inside a `Menu_menuWrapper` with a
`Menu_menuBtn` class, and menu items were `<div class="Menu_menuItems…">`.)

Click sequence:

1. `.click()` the gear button.
2. Poll (every 25ms, up to 1s) for the menu item whose text matches
   `/^export to tcx$/i`.
3. `.click()` it. The browser starts the TCX download.
4. If for some reason the item isn't found (Garmin rename / removal),
   we close the menu by clicking the gear again and log the failure.

The button's icon is an inline SVG (download arrow into tray) sized
to the 14px of neighboring icons, filled with Garmin's
`--icon-default` variable like theirs.
