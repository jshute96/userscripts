# YouTube: Simple zoom and pan

## Summary

This adds simple zooming and panning in the video player, similar to maps.

### Controls

| Action | Mouse | Trackpad | Keyboard |
| --- | --- | --- | --- |
| **Zoom** in / out | <kbd>Ctrl</kbd> + wheel | Pinch-zoom, or<br><kbd>Ctrl</kbd> + two-finger drag up/down | <kbd>+</kbd> / <kbd>-</kbd> |
| **Pan** | <kbd>Ctrl</kbd> + drag, or<br>middle-button drag | <kbd>Ctrl</kbd> + drag | <kbd>Ctrl</kbd> + arrow keys |
| **Zoom** to a region | <kbd>Shift</kbd> + draw a box | <kbd>Shift</kbd> + draw a box | |
| **Toggle** between default and zoomed view | | | <kbd>x</kbd> |

In Shorts, the player widens as you zoom in, so the zoomed vertical video can
spread to full-page or full-screen width.

For Shorts in their initial state, <kbd>x</kbd> zooms to the full width of
the window, vertically centered.

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
  adjust volume). On a Short with no remembered zoom, `x` goes to a
  full-width, vertically centered view instead of doing nothing.
* A dashed rectangle while drawing a zoom box, and a transient "2.5×"
  badge in the player's top-left corner after each zoom change.
* On Shorts, the player grows to the zoomed video's width (up to the
  up/down arrows at the right edge) while zoomed, and snaps back at 1×.
  The like/comment/share column moves right with it. If the full
  sidebar is in the way, it's collapsed to its icon strip — the same as
  clicking ☰ — and reopened at 1×.

## Implementation

The core is one inline style on the `<video>`:

```
transform-origin: 0 0;
transform: translate(ox%, oy%) scale(s);
```

The player root (`.html5-video-player`) is `overflow: hidden`, so the
scaled video is clipped to the player. Percentages in `translate()` refer to the element's own
box, so the view survives resizes (theater mode, fullscreen) without
recomputation. `ox`/`oy` are clamped against the *player's* box, per
axis: where the zoomed video is at least as big as the player it must
cover it (no gaps at the edges), and where it's smaller it's centered.
A video letterboxed at 1× (the `<video>` element is sized to the
picture and centered in the player) therefore spreads over the bars as
it zooms, and can be panned across the whole player once it's big
enough. One exception: while a Short is cued, YouTube parks its
`<video>` above the player; a video that doesn't overlap the player at
all is clamped to its own box instead, so it isn't dragged into view.

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
reset so a zoom doesn't carry over. On Shorts that's too late to look
right. The feed (`#shorts-container`, scroll-snapping) holds one
`.reel-video-in-sequence-new` item per Short, but there is only one
player: the neighbors, which peek in above and below, are just
thumbnail `div`s with a background image. Moving to the next or
previous Short scrolls the feed for ~300 ms, then moves the player
into the new item, and only then changes the URL — so the player would
arrive in the new item still transformed and widened, then snap. So
the widening override is scoped to the item holding the player
(`:has(.html5-video-player)`), which keeps the neighbors at their
normal size during the scroll, and a `MutationObserver` on `ytd-shorts`
(childList, subtree, only while zoomed) resets the view the moment
the player's item changes; that callback runs before the next paint.
The leaving item, by then almost scrolled out, shrinks at that moment.

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
  the player are swallowed in the capture phase. The middle button
  pans with or without Ctrl. A pan drag at 1× isn't claimed at all, so
  ctrl+click stays a normal click and a middle-button press still
  autoscrolls.
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
transform if the page clears it, and re-clamps the view if the page
moved or resized the video (a cued Short being placed in the player).
The watch page sets `width`/`height`/`left`/`top` individually on
resize, which leaves `transform` alone; the Shorts player replaces the
whole inline style (see below), so there it matters. Two guards keep
this from feeding on itself: the observer ignores mutations whose
`cssText` is exactly what the script last wrote (its own writes come
back through the same observer), and it only re-applies for a change
of more than half a pixel. Without the first, a re-clamp that differed
by floating-point noise re-wrote the style, which re-fired the
observer, in an unbroken microtask loop that hung the tab. Similarly,
the automatic re-fit stops (with a console line) if it runs more than
ten times in two seconds, in case the page and the script ever resize
the player back and forth.

**Shorts: widening the player.** YouTube sizes the Shorts player from
CSS custom properties: `--ytd-shorts-player-width` is
`min(height × --ytd-shorts-player-ratio, 100vw − --ytd-current-guide-width − 52px)`,
declared on `ytd-shorts`, `.reel-video-in-sequence-new` (which also
carries the per-video ratio inline) and `ytd-reel-video-renderer`. The
up/down navigation arrows sit in a 96px absolutely positioned column
at the right edge of `ytd-shorts`. The action bar (like/comment/share)
has two layouts: when `ytd-reel-video-renderer` has
`extract-action-bar` it's a 72px column to the player's right (the
overlay is `player width + 72px`); otherwise it's overlaid on the
player. YouTube switches between them by how much room the player
leaves, so widening the player flips it to the overlaid form.

While zoomed, `syncWide` sets `data-jshute-yt-zoom-wide` on `<html>`
plus `--jshute-yt-zoom-wide-width` = `min(natural width × s,
innerWidth − guide − 96px [− 72px if extracted])`, and a rule under
that attribute overrides `--ytd-shorts-player-width` on the same three
elements with it (`!important`). The reel stays centered by YouTube's
own layout, so zooming out narrows it in place with no jump at 1×;
YouTube moves the action bar to the overlaid form before the centered
reel would push it into the arrow column. The guide width is measured as `ytd-shorts`'s left edge:
`--ytd-current-guide-width` stays at 240px even when the guide is
collapsed to the icon strip, so it can't be used. The natural width
is derived, not measured: the player's height times
`--ytd-shorts-player-ratio`, which YouTube sets inline on the
`.reel-video-in-sequence-new` item per video. (Once widened, the
natural width is no longer on show, and while a Short is cued even
the `<video>` is sized to the player, so measuring either would feed
the widening back into itself.) The width tracks the zoom so no black
bars appear at modest zooms; at 1× the attribute comes off and the
layout is YouTube's own again.

Early in a page load the player exists and plays before `ytd-shorts`
exists to hold it; YouTube moves it in later. So "is this a Short" is
answered by the URL when the player has no `ytd-shorts` ancestor, the
wide attribute and width are set anyway (the player's own width is
still natural then, and serves as the base), and a `MutationObserver`
on the document waits for the player to be placed, then re-fits.

If the zoomed width wants more than the free width with the full guide
open (`ytd-app[guide-persistent-and-visible]`), the script clicks
`#guide-button` (☰), which collapses the guide to the 72px icon strip
(`ytd-app[mini-guide-visible]`), and remembers that it did so to click
it again at 1× — only if the guide is still collapsed then, so a user
who reopened it meanwhile isn't overridden. The collapse lands a task
after the click, not synchronously, and the action-bar flip and window
resizes also change the free width, so a `MutationObserver` on
`ytd-app` (attributes `guide-persistent-and-visible`,
`mini-guide-visible`, `extract-action-bar`, subtree) and a listener for
trusted `resize` events schedule a re-fit: recompute the width,
re-clamp the view, reapply.

`x` with nothing remembered on a Short (`zoomToFullWidth`) picks
`s = (innerWidth − min(guide, 72px) − 96px) / natural width` — the
width the player can reach once the guide is collapsed, plus 2px so
rounding can't leave a hairline bar — and centers the video on the
player's center in both axes; the clamp then holds it against the
player's edges horizontally.

YouTube only re-lays-out the `<video>` (its inline `width`/`left`,
centering the picture in the player) on a window `resize` event, so
the script dispatches a synthetic one after each width change. That
handler runs synchronously, and it rewrites the video's whole inline
style, dropping our transform; `syncWide` puts it straight back so the
anchor math that follows (which backs the current transform out of
the rect) stays consistent. Zoom anchors are read in video fractions
*before* the width change and re-resolved after it, since the video
moves when the player resizes; center zooms re-read the player's
center for the same reason.

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
* Shorts: the feed is `#shorts-container`, one `.reel-video-in-sequence-new`
  item per Short, and the single player is moved between items. The
  player is inside `ytd-shorts`; its width comes from
  `--ytd-shorts-player-width` on the three elements above; the action
  bar column is 72px and the navigation column 96px; a window `resize`
  event makes the player re-fit the video synchronously; `ytd-app`
  carries `guide-persistent-and-visible` while the full guide is open
  and `#guide-button` toggles it.
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
* If the tab is closed or reloaded while a Short is zoomed far enough
  to have collapsed the guide, the guide stays collapsed (YouTube
  remembers the ☰ state); one click on ☰ restores it.
