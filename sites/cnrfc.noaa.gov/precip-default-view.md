# NOAA CNRFC: Default precipitation map view (Bay Area, 24-hour)

## Summary

Opens the precipitation map on NOAA's California Nevada River Forecast
Center site (CNRFC) with a default mode and location.

The map always loads zoomed out over the whole forecast region, with
no mode (e.g. precipitation layer) selected, so every visit starts several
clicks to get to a useful view.

This script opens a default view, currently hardcoded to the San
Francisco Bay Area, with 24-hour observed precipitation.

The map position is set by constants at the top of the script
(`CENTER_LAT`, `CENTER_LON`, `TARGET_ZOOM`); edit them for a different
default view.

## Visible changes

- Map view recenters near the south-bay shoreline (just west of San Jose)
  and zooms in three steps from the page default.
- The "24" checkbox under "Most Recent Hours (Raw)" is checked, which
  loads the 24-hour observed precipitation overlay.
- If the 24-hour layer is already enabled when the script runs, it is
  left alone (no toggling off).

## Implementation

The page (`https://www.cnrfc.noaa.gov/ol.php?type=precip`) embeds an
OpenLayers map and exposes the map instance and the `ol` namespace as
globals (`window.map`, `window.ol`). It defaults to zoom level 6 centered
on California/Nevada.

We poll briefly for `window.map`, `window.ol`, and a usable `getView()`,
then:

- Reproject our chosen lon/lat (`-122.0, 37.4`, the south-bay shoreline
  west of the San Jose dot) from EPSG:4326 to EPSG:3857 — the page itself
  uses the same `ol.proj.transform(..., 'EPSG:4326', 'EPSG:3857')` call,
  so our reprojection will continue to match whatever projection the
  view uses.
- Call `view.setCenter(...)` and `view.setZoom(9)` (page default 6 plus
  three zoom-in steps; one wheel tick = one zoom level in OpenLayers'
  default mouse-wheel zoom interaction).

For the 24-hour layer, the checkbox has `id="twentyfourhourP"` and an
inline `onclick="toggleKML1(...)"` handler that loads the KML overlay.
We call `.click()` on the element so the page's own handler runs (rather
than calling `toggleKML1` directly with hard-coded args, which would
break if the page changes the parameters). We skip the click if the box
is already checked, so reloading the script doesn't toggle the layer
back off.

### Assumptions that could break the script

- The map global stays named `map` and OpenLayers stays exposed as `ol`.
- The 24-hour checkbox keeps the id `twentyfourhourP` and its inline
  `onclick` handler.
- The map view continues to use Web Mercator (EPSG:3857) as its
  projection.
- The URL pattern stays `?type=precip` (the `@match` rule expects this).
