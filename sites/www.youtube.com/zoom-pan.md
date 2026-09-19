# YouTube: Simple zoom and pan

## Summary

This adds simple zooming and panning in the video player, similar to maps.

### Controls

| Action | Mouse | Trackpad | Keyboard |
| --- | --- | --- | --- |
| **Zoom** in / out | <kbd>Ctrl</kbd> + wheel | Pinch-zoom, or<br><kbd>Ctrl</kbd> + two-finger drag up/down | <kbd>+</kbd> / <kbd>-</kbd> |
| **Pan** | <kbd>Ctrl</kbd> + drag | <kbd>Ctrl</kbd> + drag | <kbd>Ctrl</kbd> + arrow keys |
| **Zoom** to a region | <kbd>Shift</kbd> + draw a box | <kbd>Shift</kbd> + draw a box | |
| **Toggle** between default and zoomed view | | | <kbd>x</kbd> |

Controls are inactive on 360° videos. YouTube supports zooming and panning inside spherical video content natively.

## Visible changes

* Ctrl+wheel anywhere on the page zooms the video instead of zooming
  the page. Browser page zoom via the wheel is unavailable on YouTube
  while a video is on the page (the keyboard's Ctrl+plus/minus still
  works).
* Ctrl+drag and shift+drag on the video no longer toggle play/pause
  (or fullscreen on a double-click); they pan and draw a zoom box.
  Ctrl+shift+drag also draws a box.
* The `x` key is taken over while a video is on the page (YouTube
  itself doesn't use it), as are `+`/`-`, which YouTube uses for
  caption text size. Ctrl+arrows likewise (plain arrows still seek and
  adjust volume).
* A dashed rectangle while drawing a zoom box, and a transient "2.5×"
  badge in the player's top-left corner after each zoom change.

## Implementation

The core is one inline style on the `<video>`:

```
transform-origin: 0 0;
transform: translate(ox%, oy%) scale(s);
```

The player root (`.html5-video-player`) is `overflow: hidden`, so the
scaled video is clipped to the player. Percentages in `translate()` refer to the element's own
box, so the view survives resizes (theater mode, fullscreen) without
recomputation. `ox`/`oy` are kept in `[1 − s, 0]`, meaning the zoomed
video always covers its own unzoomed box — no gaps at the edges. (For
letterboxed videos this box is the video, not the player, so a modest
zoom fills the player's black bars.)

Zoom-about-a-point math: the transformed rect comes from
`getBoundingClientRect()`, the untransformed size from
`offsetWidth`/`offsetHeight` (which ignore transforms). The pointer's
position as a fraction of the unzoomed video is
`u = (clientX − rect.left) / (s·w)`; the new offset that keeps `u`
under the pointer is `ox' = (clientX − x0)/w − u·s'`, where `x0` is the
untransformed origin `rect.left − ox·w`.

Event handling is all document-level capture listeners registered once
at init, which self-gate by walking from `event.target` up to
the player root. That sidesteps waiting for the player to exist and
YouTube's single-page navigation (the same `<video>` element is reused
from video to video). Because nothing needs the DOM at init, the script
runs at `document-start`: YouTube's watch page is heavy enough that the
video is often playing long before `document-idle`, and a ctrl+wheel in
that window would otherwise zoom the whole page. The one navigation hook is `urlchange` (via
`@grant window.onurlchange`): when the video identity in the URL
changes (`?v=` on the watch page, the path on Shorts), the view is
reset so a zoom doesn't carry over.

Gestures:

* **Wheel**: Ctrl (or Cmd) + wheel anywhere → `preventDefault` (this
  is what stops the browser's page zoom) and scale by
  `exp(−deltaPixels × k)`. Exponential, so a gesture multiplies the
  zoom by the same factor at every level, with no step ladder to
  overshoot. `k = 0.0025` per pixel: one 100 px mouse detent ≈ 1.28×,
  ~2.8 detents per doubling. `deltaMode` line/page deltas are
  normalized to pixels first (40 px per line, 200 px per page —
  Firefox sends lines). Over the player it anchors on the pointer;
  elsewhere, on the player's center.
  - **Trackpad pinch** arrives from Chrome as a wheel event with
    `ctrlKey` set, with deltas ~8× smaller per unit of finger travel,
    so it gets `k = 0.02`. A pinch is recognized as "ctrlKey reported
    but no Ctrl/Cmd physically held", tracked from keydown/keyup,
    re-synced from `mousemove` (Chrome fabricates the modifier only on
    the pinch's wheel event) and cleared on blur. Magnitude can't
    substitute: high-resolution wheels emit pinch-sized deltas.
  - These constants and the pinch scheme were tuned on real hardware
    in the SeeWhatISee project (`src/capture-page/zoom.ts` and its
    `docs/capture-page.md`, "Wheel + keyboard zoom"); its
    `tests/manual/mouse-wheel-zoom-lab.html` is the harness to re-tune
    with. It's claimed page-wide because during the long
  watch-page load the video plays before the layout settles, and a
  player-only gate let some events through to the browser's page zoom.
  Page zoom is unusable with YouTube's layout anyway.
* **Drags** use pointer events with `setPointerCapture` on the player.
  `preventDefault` on `pointerdown` suppresses the compatibility
  `mousedown`, which is what would otherwise start middle-button
  autoscroll. The browser still synthesizes a `click` (and possibly
  `dblclick`) when the drag ends; YouTube toggles play/pause and
  fullscreen on those, so for 500 ms after a drag ends, clicks inside
  the player are swallowed in the capture phase. A ctrl+drag at 1×
  isn't claimed at all, so ctrl+click stays a normal click.
* **Zoom box**: an absolutely positioned `div` appended to
  the player root (which is `position: relative`), `pointer-events:
  none`, sized in player-relative pixels on each move. A box under
  8 px in either dimension is ignored as an accidental click.
* **Keys**: `x` and plus/minus with no modifiers (`+`, `=`, `-`, `_`,
  and the numpad keys; a doubling per press — the wheel is the fine
  control), and Ctrl+arrows (20% of the frame per press). All on `keydown`
  in the capture phase with `stopImmediatePropagation` so YouTube's
  own key handling doesn't also react. Ignored when focus is in a
  text field.

A `MutationObserver` on the video's `style` attribute reapplies the
transform if the page ever clears it. YouTube currently sets
`width`/`height`/`left`/`top` individually on resize, which leaves
`transform` alone, so this is insurance only.

**Spherical (360°) videos.** The player root carries
`ytp-webgl-spherical`, the picture is rendered into a `<canvas>` under
`.webgl`, and the `<video>` is only the hidden source — so a transform
on it does nothing visible, and the player already has its own drag
look-around and field-of-view zoom on `+`/`-` and `[`/`]`
(`getSphericalProperties()` shows yaw/pitch/roll/fov). When the class
is present every gesture stands down, passing events through
untouched, and one console line per video says so.

### What we assume stays stable

* `.html5-video-player` is the player root (`#movie_player` on the
  watch page, `#shorts-player` on Shorts), `position: relative` and
  `overflow: hidden`, and contains `video.html5-main-video`. After
  in-page navigation between the two page types both roots stay in the
  DOM; the inactive one is empty and zero-sized, which is how the
  script picks the live one.
* Pointer events over the picture land on the `<video>` (or another
  descendant of the player root), not on some overlay outside it.
* `ytp-webgl-spherical` on the player root marks a 360° video.
* YouTube doesn't bind `x` or Ctrl+arrows. It does bind `+`/`-` (caption
  size), which we deliberately take over. Ctrl+plus/minus was tried and
  dropped: it interacted awkwardly with the browser's own page zoom.

### Known limitations

* Ambient mode's blurred glow (the `#cinematics` canvas behind the
  player) keeps showing the unzoomed frame. Cosmetic; the original
  script this replaces mirrored the transform onto it, and that's an
  easy addition if it bothers anyone.
* Captions, the progress-bar preview, and other player chrome are not
  scaled, by design.
