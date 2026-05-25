# Peloton Player: Hide cinematic-vignette video overlay

## Summary

Fixes a bug in Peloton's video player where, on large
high-res monitors, a fixed-size overlay is painted on top of the
video and creates an ugly horizontal seam across it.

The overlay is `cf_video_overlay_with_timeline.<hash>.png` ([example](https://members.onepeloton.com/_next/static/media/cf_video_overlay_with_timeline.6c8a2f88.png)),
a 1920×1080 cinematic-vignette image applied at its natural size. On any
player taller than 1080 pixels (common on tall or 4K monitors),
the PNG only covers the top 1080 px and its dark perimeter leaves
a hard-edged horizontal seam where the image ends. We remove the
overlay so the video renders edge-to-edge at full brightness.

## Visible changes

- The cinematic-vignette dimming over the top of the player is
  gone — the video shows through at full brightness, edge to edge.
- The visible horizontal seam mid-video disappears with it.
- Everything else stays: JW Player's own controls, Peloton's song
  widget, the bottom controlbar dimming gradient, the metrics
  overlay, the side toolbar. Only the cinematic vignette is gone.

## Implementation

### What we observed

- The Peloton class player at `/classes/player/<classId>` renders
  JW Player inside a Peloton React wrapper. Peloton paints a
  page-sized `<div>` over the JW Player with a CSS background
  pointing at `/_next/static/media/cf_video_overlay_with_timeline.<hash>.png`.
- The element is one of a pair of styled-components divs (group
  hash `sc-b919e837-*`):
  - `-0` (e.g. `dfDvYD`): bottom 240px, `linear-gradient(rgba(0,0,0,0), rgba(0,0,0,0.6))` —
    the dim region behind the bottom control bar. We leave this alone.
  - `-1` (e.g. `jzUDu`): full player size, `background-image:
    url('.../cf_video_overlay_with_timeline.<hash>.png')` — the
    cinematic vignette. This is what we remove.
- The PNG is a vignette: dark perimeter, transparent oval in the
  middle. Natural size **1920×1080**, applied with `background-size:
  auto` (i.e. natural) and `background-position: 0 0`.
- The player wrapper's size depends on the browser viewport. On a
  wide-and-tall window (e.g. 1660 × 1459), the 1920×1080 PNG sits
  in the top-left at natural size, so:
  - It only covers player y=0..1080. Below y=1080: no overlay, full
    brightness.
  - The bottom edge of the PNG paints the **dark perimeter** part
    of the vignette, producing a hard horizontal seam between
    "dimmed by perimeter dark" (above y=1080) and "no overlay"
    (below). That seam is the artifact the user originally
    reported.
- On a player matching 1920×1080 exactly, the vignette fits and the
  seam isn't visible (it lines up with the edge of the player).
- On a smaller player, the PNG overflows beyond the player edges,
  the dim-perimeter region clips, and the seam is hidden by the
  natural framing — which is why this only appears at certain
  sizes.

The intent of the PNG is presumably a cinematic look — darkened
corners with the instructor in the bright middle. It's implemented
as a single fixed-resolution asset with no responsive sizing, so
it falls apart on any non-1080p viewing.

### What we assume stays stable

- The PNG's source filename `cf_video_overlay_with_timeline` stays
  the same across deploys. Only the content-hash suffix
  (`.6c8a2f88.png` at time of writing) changes when Peloton rebuilds.
  Identifying by filename substring is therefore stable across
  deploys but breaks if Peloton renames or splits the asset.
- The PNG continues to be applied as a `background-image` on a
  regular `<div>` (not as an `<img>` element, an inline SVG, or
  a CSS pseudo-element). `getComputedStyle(...).backgroundImage`
  on `div`s will find it.
- The player is a SPA route under `members.onepeloton.com/*` —
  history-API navigation, not document reloads — so the script
  must re-scan on URL change.

### How we modify the page

- Walk every `<div>` in the document, read its computed
  `backgroundImage`, and if the URL contains
  `cf_video_overlay_with_timeline`, set
  `background-image: none !important` inline on that element. We
  also stamp it with `data-jshute-overlay-hidden` so the next sweep
  can skip it cheaply.
- The element is rendered after route navigation completes, so the
  initial `document-idle` sweep usually misses it. We instead poll
  every 250ms for up to 10s, stopping as soon as the element is
  found and marked. If the user navigates to a non-player page,
  the poll harmlessly finds nothing and gives up.
- Peloton is a SPA; we hook `pushState`/`replaceState` and
  `popstate` to detect URL changes, clear the marker on previously
  hidden elements (the div is re-mounted across navigation), and
  re-arm the poll.
- We deliberately *don't* hide `cf_metrics_overlay_v_2.png` — a
  smaller (960×178) gradient PNG used as the backdrop for the
  metrics widget. The user only flagged the main vignette.
- Identifying by URL substring (rather than by class hash) is more
  resilient than `[class*="sc-b919e837"]`: the styled-components
  group ID rotates whenever Peloton rebuilds the component, but
  the source-asset filename only rotates if Peloton renames the
  file.

### Trade-off

- The vignette PNG is also the only carrier for the *cinematic*
  feel; once removed the player looks like a plain video pane.
  Given that the same PNG creates the bug on every non-1080p
  monitor, that's an acceptable trade.
- If Peloton later splits the timeline graphic out of this PNG
  into a separate element (which the filename `_with_timeline`
  suggests they sometimes need), this script will still work and
  the split-out timeline will keep rendering.
