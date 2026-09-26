# Chrome Image Viewer: Simple zoom and pan

## Summary

When you open a link directly to an image (JPG, PNG, etc), or use Chrome's
"Open image in new tab" menu item, Chrome's built-in image viewer is very
limited. Clicking toggles between 100% size and "fit to window". While zoomed,
it's difficult to scroll around. The mouse wheel scrolls vertically only.

This adds a better image viewer. You can **zoom smoothly using natural
gestures**, and then **pan the image by dragging**. Both have keyboard
controls too.

This works on any URL ending with `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`,
`.avif` or `.bmp` that serves an image.

### Controls

| Input | Action |
| --- | --- |
| • Mouse wheel<br>• `Ctrl` + wheel<br>• Two-finger scroll<br>• Trackpad pinch | Zoom in / out at the cursor |
| • Drag<br>• `Ctrl` + drag<br>• Middle-button drag<br>• Arrow keys | Pan when zoomed |
| `Shift` + drag | Draw a box and zoom to fit it |
| `+` / `-` | Zoom in / out by 2× at the center |
| `x` | Toggle between fit-to-window and original size<br>(or your last zoom, once you've zoomed) |

Zoom goes from fit-to-window (or original size, for a small image) up
to 32× that, and always far enough to reach original size.

## Visible changes

* Images opened directly in a tab are centered on a dark background,
  scaled to fit the window.
* Clicking the image no longer toggles Chrome's 100% view.
* The controls above zoom and pan the image, with a brief badge in the
  top left showing the zoom level, where `1.0×` is original size.

## Implementation

All the behavior is in [`lib/image-zoom-pan.js`](../../lib/image-zoom-pan.md);
this script just calls `ImageZoomPan.create()` with no framed-viewer
options, so only standalone image documents are handled.

### Targeting

A regex `@include` targets URLs whose path ends in an image extension
(`png`, `jpg`, `jpeg`, `webp`, `gif`, `avif`, `bmp`, in any case),
with or without a query string or fragment, over `http`, `https` and
`file`. Plain `@match` patterns can't do this in a few lines: they
can't ignore case, and `*.png` misses `foo.png?w=800`. A regex
`@include` ignores case in Tampermonkey, Violentmonkey and
SourceMonkey, so the regex needs no uppercase copies (and no `/i`
flag, which no manager accepts). Images served from URLs with no
extension aren't covered.

A matching URL can still serve HTML, so `create()` also checks
`document.contentType` and returns with no listeners unless it starts
with `image/` (SVG excluded: Chrome renders it as a normal document).
It runs at `document-start` so the restyle lands before the
first paint.

### What we assume stays stable

* Chrome shows a directly opened raster image as an `ImageDocument`:
  `document.contentType` is the image's MIME type, and the DOM is a
  synthetic `<html><head>…</head><body><img src="…"></body></html>`.
* **The `<img>` must stay in place.** Blink feeds the document's
  network stream straight into that `<img>`'s decoded image, so a
  replaced or cloned `<img>` has no bitmap (`naturalWidth === 0`).
  We only restyle and transform it.
* Chrome's click-to-zoom is a `click` handler on the image, which a
  capture-phase `click` listener on `document` (`preventDefault` +
  `stopImmediatePropagation`) suppresses.
* Chrome sets HTML `width`/`height` attributes on the `<img>`; our
  `width: auto; height: auto; max-width: 100vw; max-height: 100vh`
  (all `!important`) override them.
* On a window resize, Chrome rewrites the `<img>`'s inline style,
  clearing our transform before our `resize` handler runs. The library
  measures against whatever transform is actually on the element, and
  a `MutationObserver` puts ours back.

### How we modify the page

* A `data-jshute-image-zoom-pan-standalone` attribute on `<html>` turns
  on the injected styles: `body` becomes a `100vw × 100vh` flex box.
  The `<img>` keeps Chrome's own `margin: auto`, which is what centers
  it; `justify-content` / `align-items` on `body` don't (checked in
  Chrome 153). Overriding the margin makes a small image jump from
  centered to the top-left corner as the styles load.
* Zoom and pan are a `transform: translate(…) scale(…)` on the `<img>`
  itself, with `transform-origin: 0 0`.
* While the zoomed image still fits the window in one direction, it
  stays centered in that direction; zoom only anchors at the cursor in
  a direction where the image is bigger than the window.
