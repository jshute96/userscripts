# Trailforks ↔ Strava: Cross-link maps

## Summary

Add links between Trailforks and Strava maps, opening to the same location
and zoom level.

* On Trailforks maps (embedded or fullscreen), add a Strava button that
  opens the full-page Strava map, with heatmaps and segments.
* On Strava maps (full-page maps under Maps and
  the map on an activity page), add a Trailforks button that opens the
  full-screen Trailforks map.

## Visible changes

* Trailforks, embedded maps (trail pages, region maps): a Strava logo
  at the end of the left-hand group of buttons in the map's toolbar,
  after Activity.
* Trailforks, newer full-page map: a Strava logo pill after the
  activity / Filters / Views buttons along the top.
* Strava full-page map: a Trailforks logo button after the "Segments" pill.
* Strava activity page: a Trailforks logo button between the map style
  selector and the fullscreen toggle.

## Implementation

### Coordinates

Both sites use web Mercator maps with 512px tiles, so zoom level N is the
same scale on both. A view is three numbers — lat, lon, zoom — and the
link just reformats them:

* Strava: `https://www.strava.com/maps/global-heatmap/personal-heatmap#<zoom>/<lat>/<lon>`.
  The hash is how Strava's own map page keeps its position, and the page
  reads it on load. Query parameters (sport, colors, etc.) are left off;
  Strava restores its own last-used settings.
* Trailforks: `https://www.trailforks.com/map/?z=<zoom>&lat=<lat>&lon=<lon>`.
  The same query parameters Trailforks uses in its own "view on map"
  links. `activitytype` is left off, so the user's default applies.
  Not `/trails/map/`: the page's inline config (`window.__tfMapPanelEntry`)
  marks that as a landing path that auto-opens the Discover panel over
  the map, and it collapses to `/map/` on the first pan anyway.

### Reading the current view

**Trailforks** exposes its Mapbox GL map as a global, `window.map`
(`getCenter()`, `getZoom()`), on every page that has a map. The script
uses `@grant none` so it runs in the page's world and can see it.

**Strava** draws its maps with its own WebGL engine (there's no Mapbox
object, and the canvas has no exposed API). The React component that owns
the canvas keeps the engine in its context, so the script walks up the
React fiber tree from the `<canvas>` (the `__reactFiber$…` expando
property React puts on DOM nodes, which is why `@grant none` matters here
too) until it finds a `stateNode.context.terrainEngine`. Its
`getCamera()` gives:

* `getTarget().lookAtPoint` — `{latitude, longitude}` of the view center.
* `getScaleMetersPerPixel()` — meters per CSS pixel at the center.

Zoom is recovered by inverting the web Mercator ground resolution:
`zoom = log2(2π · 6378137 · cos(lat) / (512 · metersPerPixel))`. Checked
against the hash on the heatmap page: they agree to two decimals. If the
fiber walk finds nothing, the URL hash (`#zoom/lat/lon`) is the fallback,
which covers the full-page map but not activity pages.

The view is read when the button is hovered, focused, or clicked, so the
href is current for copy-link and right-click too. Nothing is read
continuously.

### Where the button goes

Trailforks has three map UIs:

* Embedded maps (trail pages, region maps, inline or fullscreen) now
  have a toolbar `div#tfmapctl > div.tf-mapctl__bar` (role=toolbar) of
  `button.tf-mapctl__btn`s: Basemap, Layers, Style, Filters, Activity,
  then a spacer and Trail list, Search, Saved Map Views, Open in Map,
  and the `div.tf-mapctl__more` "More" menu. The button is an
  `a.tf-mapctl__btn` inserted before `.tf-mapctl__spacer`, ending the
  left-hand group. (The items marked `tf-mapctl__btn--wide-only`, on the
  right, hide when the map is narrow; the left group doesn't.)
* The older version of that toolbar (replaced by the above in 2026-10; the
  script still handles it in case it comes back somewhere) (trail pages, region maps, whether inline or fullscreen)
  has `<ul class="bartop">` menu bar over the map with `<li
  class="menuitem">` entries, each wrapping a `div.parent` that carries
  the site's hover highlight. The button is a new `<li>` with the same
  structure, right after `li#mapViewMenu` (the "save this map view"
  icon), padded to the neighbors' height. The same element serves both
  inline and fullscreen; fullscreen just restyles it.
* The newer full-page map (`/map/`, `/trails/map/`; `body.mapv2`) has a
  floating bar along the top, `div#tfMapFloatbar`, whose
  `.tf-map-floatbtns-row` holds the activity, Filters, and Views pills
  (`button.tf-map-floatbtn`). The button is appended to that row with the
  same class. (The "Tools" rail on the right, `#tfMapTopTools`, was the
  first choice, but the top row is where the eye goes.)

Strava has two as well, both React-rendered with hashed CSS-module class
names, so the button copies a neighbor's `className` rather than
hardcoding them:

* The full-page map's pill menu is a `react-horizontal-scrolling-menu`;
  items are `div.react-horizontal-scrolling-menu--item[data-key]`. The
  button is a new item after the `segments` item's separator, styled like
  the "My Routes" link (`[data-testid="my-routes-link"]`).
* The activity page's map has a control strip; the button goes before
  `[data-testid="fullscreen-toggle-button"]`, styled like the GPX link
  (`[data-testid="gpx-download-button"]`).

A debounced `MutationObserver` re-runs the insertion whenever the button
is missing — that covers SPA navigation on Strava's map page and React
re-renders that drop the button. Segment pages on Strava use a third map
component with no control strip; they're not handled.

### What we assume stays stable

* Trailforks: `window.map` with Mapbox GL's `getCenter`/`getZoom`;
  `#tfmapctl .tf-mapctl__bar` with its `.tf-mapctl__spacer` child;
  `ul.bartop > li#mapViewMenu`; `#tfMapFloatbar .tf-map-floatbtns-row`
  with `.tf-map-floatbtn` children.
* Strava: the React context property named `terrainEngine` with a
  `getCamera()` whose camera has `getTarget()` and
  `getScaleMetersPerPixel()`; the `data-key="segments"` menu item;
  the `my-routes-link`, `gpx-download-button` and
  `fullscreen-toggle-button` test ids.
