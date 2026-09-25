# Image Viewer: Simple zoom and pan

Replaces Chrome's built-in standalone image viewer (`*.png`, `*.jpg`, `*.jpeg`, `*.webp`, `*.gif`) with smooth cursor-anchored mouse-wheel/trackpad zoom, drag-to-pan, Shift+drag box-zoom, and keyboard zoom/pan via [`lib/image-zoom-pan.js`](../../lib/image-zoom-pan.md).

## Controls

| Input | Action |
| --- | --- |
| Mouse wheel / Two-finger scroll | Zoom in / out anchored at the cursor |
| Trackpad pinch / `Ctrl` + wheel | Zoom in / out anchored at the cursor |
| Drag / `Ctrl` + drag / Middle-button drag | Pan image when zoomed |
| `Shift` + drag | Draw a box and zoom to fit |
| `+` / `=` or `-` / `_` | Zoom in / out by 2× at the viewport center |
| Arrow keys / `Ctrl` + arrow keys | Pan when zoomed |
| `x` | Toggle between `1×` and the previous zoomed view (or zoom a pillarboxed image to fill the viewport width) |

## What we assume stays stable

* Chrome renders standalone raster images inside an `ImageDocument` (`document.contentType` starting with `image/`) whose DOM is `<html><head>…</head><body><img src="…"></body></html>`.
* Keeping `body > img` in place (rather than replacing or cloning the element) preserves Blink's decoded image stream (`ImageResourceContent`), while a capture-phase `click` listener suppresses Chrome's built-in click-to-zoom toggle.
