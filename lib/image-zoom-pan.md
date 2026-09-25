# image-zoom-pan.js

A shared `@require` helper for userscripts that add mouse-wheel, trackpad, drag, Shift+drag box, and keyboard zoom and pan to standalone images and framed web image viewers.

```js
// @require https://raw.githubusercontent.com/jshute96/userscripts/main/lib/image-zoom-pan.js
```

## Summary

Provides a single `ImageZoomPan.create(options)` entry point that supports two viewer modes with the same transform, clamping, and input-handling state machine:

1. **Chrome standalone image viewer (`ImageDocument`)**: automatically detected whenever `document.contentType` starts with `image/` (excluding `image/svg+xml`). Keeps `body > img` in place, suppresses Chrome's built-in click-to-zoom toggle, fits the image into a dark `100vw × 100vh` flex viewport, and applies `transform-origin: 0 0; transform: translate(...) scale(...)` directly to `body > img`.
2. **Framed web-app image viewer**: configured via CSS selectors (`viewport`, `content`, `img`, plus optional `svg` annotation layer and `fitToScreenClass`).

### Usage

Standalone image viewer only (`sites/any/image-zoom-pan.user.js`):

```js
ImageZoomPan.create({
  tag: '[image-zoom]',
});
```

Framed image viewer + standalone fallback (`sites-google/screenshot-v2.corp.google.com/zoom-pan.user.js`):

```js
ImageZoomPan.create({
  tag: '[snipit-zoom]',
  viewport: 'image-container',
  content: 'image-container .image-container',
  img: 'image-container .image-container img.image',
  svg: 'image-container .image-container svg.canvas',
  fitToScreenClass: 'fit-to-screen',
  scrollableOverlay:
    'material-drawer, material-dialog, material-popup, [role="dialog"], [role="listbox"], [role="menu"]',
  editableOverlay: '.annotation-wrapper, .text-input-wrapper',
});
```

### Options

| Option | Meaning |
| --- | --- |
| `tag` | Console log prefix (default: `'[image-zoom]'`). |
| `viewport` | CSS selector for a framed viewer's viewport element. When omitted, only standalone `ImageDocument` pages are handled. |
| `content` | CSS selector for the framed element that receives the CSS `transform` (defaults to `viewport`). |
| `img` | CSS selector for the `<img>` inside `content` (defaults to `${viewport} img`). |
| `svg` | Optional CSS selector for an SVG annotation layer inside `content`. When present, plain drag and Shift+drag only activate when the SVG has `.readonly` or `.no-tool-active`. |
| `fitToScreenClass` | Optional class name on `content` indicating `object-fit: contain` scaling. When toggled by the host app, zoom resets cleanly to `1×`. |
| `scrollableOverlay` | CSS selector for drawers, dialogs, or menus where plain mouse-wheel scrolling should pass through untouched. |
| `editableOverlay` | Optional CSS selector for editable annotation/text overlays where plain drag should not start a pan. |
| `canPlainDrag` | Optional `(target, eventTarget) => boolean` predicate overriding the default plain-drag check on framed viewers. |

## Controls

| Input | Action |
| --- | --- |
| Mouse wheel / Two-finger scroll | Smooth zoom in / out anchored at cursor (`WHEEL_ZOOM_K = 0.0025`) |
| Trackpad pinch / `Ctrl` + wheel | Smooth zoom in / out anchored at cursor (`PINCH_ZOOM_K = 0.02` for pinch) |
| Drag / `Ctrl` + drag / Middle-drag | Pan image |
| `Shift` + drag | Draw dashed rectangle and zoom to fit |
| `+` / `=` or `-` / `_` | Zoom in / out by 2× around viewport center |
| Arrow keys / `Ctrl` + arrow keys | Pan by 20% of content size per press |
| `x` | Toggle between `1×` and the previous zoomed view (or zoom a pillarboxed image to fill the viewport width) |

## Implementation Notes

* **Cross-script deduplication**: When both a site-specific script and `sites/any/image-zoom-pan.user.js` match the same standalone image URL, the first `ImageZoomPan.create()` call sets `data-jshute-image-zoom-pan-active` on `<html>` and the second instance stands down.
* **Fast bailout on HTML pages**: When called without `viewport` on a URL that happens to end in `.png`/`.jpg` but serves `text/html`, `create()` checks `document.contentType` and returns immediately without registering listeners.
* **Margin and letterbox clamping**: `pictureBox()` computes the visible bitmap bounds inside `content`. While `s * picSize <= viewport`, `clampAxis()` requires the zoomed picture to cover its `1×` footprint while staying inside the viewport, so cursor-anchored zoom from `1×` stays locked under the cursor across margins and letterbox bars and returns smoothly to `ox = 0, oy = 0` at `1×`.
