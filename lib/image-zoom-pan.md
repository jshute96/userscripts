# image-zoom-pan.js

A shared `@require` helper for userscripts that add mouse-wheel, trackpad, drag, Shift+drag box, and keyboard zoom and pan to standalone images and framed web image viewers.

```js
// @require https://raw.githubusercontent.com/jshute96/userscripts/main/lib/image-zoom-pan.js
```

## Summary

Provides a single `ImageZoomPan.create(options)` entry point that supports two viewer modes with the same transform, clamping, and input handling:

1. **Chrome's standalone image viewer (`ImageDocument`)**: detected automatically whenever `document.contentType` starts with `image/` (excluding `image/svg+xml`). See [`sites/any/image-zoom-pan.md`](../sites/any/image-zoom-pan.md) for how that page is restyled and what it depends on.
2. **Framed web-app image viewer**: an image inside a site's own viewer, located with CSS selectors (`viewport`, `content`, `img`).

`create()` returns `null` without registering anything when there's nothing to do (no `viewport` and not an image document), or when another script already called it on this page.

### Usage

Standalone image viewer only (`sites/any/image-zoom-pan.user.js`):

```js
ImageZoomPan.create({
  tag: '[image-zoom]',
});
```

Simple framed viewer (the first `<img>` in `.viewer` is the image):

```js
ImageZoomPan.create({
  tag: '[example-zoom]',
  viewport: '.viewer',
});
```

Framed viewer with an annotation layer drawn over the image, whose app
also uses plain drags for drawing:

```js
ImageZoomPan.create({
  tag: '[example-zoom]',
  viewport: '.viewer',
  content: '.viewer .stage', // wraps the <img> and the annotation layer
  img: '.viewer .stage img',
  fitToScreenClass: 'fit',
  // Plain drags pan only while no drawing tool is selected.
  canPlainDrag: () => !document.querySelector('.toolbar .tool.selected'),
  grabCursor: '.stage',
});
```

### Options

| Option | Meaning |
| --- | --- |
| `tag` | Console log prefix (default: `'[image-zoom]'`). |
| `viewport` | CSS selector for a framed viewer's viewport element. When omitted, only standalone `ImageDocument` pages are handled. |
| `content` | CSS selector for the element that receives the CSS `transform` (defaults to the `img`). Set it when other elements, such as an annotation layer, must move with the image. |
| `img` | CSS selector for the `<img>` (defaults to the first `<img>` in `viewport`). |
| `fitToScreenClass` | Optional class name on `content` meaning the app is scaling the image to fit (`object-fit: contain`). When the app toggles it, zoom resets to `1×`. |
| `canPlainDrag` | Optional `(target, eventTarget) => boolean`, for framed viewers where the app uses plain drags itself. Plain drag and Shift+drag only pan / box-zoom when it returns true; Ctrl+drag and middle-drag always pan. `target` is `{ kind, viewport, content, img }`. |
| `grabCursor` | Selector (inside `viewport`) for elements that show a grab cursor while zoomed (default: `img`). |
| `textField` | Extra selector for the app's own text inputs, added to the standard `input, textarea, select, [contenteditable]`. Keys typed in these are left alone. |
| `scrollableOverlay` | Selector for drawers, dialogs, or menus where a plain mouse wheel scrolls instead of zooming (default: `[role="dialog"], [role="listbox"], [role="menu"]`). |

### SPA viewers

On a single-page app, the view resets to `1×` when the URL path or query changes. That relies on the `urlchange` event, which the userscript manager only fires for a script with `@grant window.onurlchange`; add it to a framed-viewer script whose image changes with the URL.

## Controls

| Input | Action |
| --- | --- |
| • Mouse wheel<br>• `Ctrl` + wheel<br>• Two-finger scroll<br>• Trackpad pinch | Zoom in / out at the cursor |
| • Drag<br>• `Ctrl` + drag<br>• Middle-button drag | Pan (when zoomed, or when the image is larger than the viewport) |
| `Shift` + drag | Draw a dashed box and zoom to fit it |
| `+` / `-` | Zoom in / out by 2× at the viewport center |
| • Arrow keys<br>• `Ctrl` + arrow keys | Pan by 20% of the content size per press |
| `x` | Toggle between fit-to-viewport and original size (or the last zoom, once the user has zoomed) |

## Implementation

* **Cross-script deduplication**: when two scripts call `create()` on the same page (a site-specific viewer script and `sites/any/image-zoom-pan.user.js` on the same image URL), the first sets `data-jshute-image-zoom-pan-active` on `<html>` and the second stands down.
* **View state**: `{ s, ox, oy }`, applied to `content` as `transform-origin: 0 0; transform: translate(ox * 100%, oy * 100%) scale(s)`, with `ox`/`oy` as fractions of `content`'s untransformed size.
* **Wheel zoom** is exponential (`scale *= exp(-deltaPixels * k)`), with `WHEEL_ZOOM_K = 0.0025` for a mouse wheel and `PINCH_ZOOM_K = 0.02` for a trackpad pinch. Chrome delivers a pinch as a `ctrlKey` wheel event with no Ctrl key held, so we track the physical Ctrl/Cmd state from key and mouse events to tell the two apart.
* **Zoom range**: `s` runs from `MIN_SCALE` (1, the unzoomed view) to `maxScale()`, which is `MAX_SCALE` (32) or the scale of original size, whichever is bigger, so a huge image can always reach one image pixel per CSS pixel.
* **Margin and letterbox clamping**: `pictureBox()` computes the visible bitmap bounds inside `content`. While `s * picSize <= viewport`, `clampAxis()` requires the zoomed picture to cover its `1×` footprint while staying inside the viewport, so cursor-anchored zoom from `1×` stays under the cursor across margins and letterbox bars, and returns smoothly to `ox = 0, oy = 0` at `1×`.
* **Native scroll**: if the user scrolled a framed viewport natively (fit-to-screen off), the scroll offset is folded into `ox`/`oy` before zooming or panning, so switching the viewport to `overflow: hidden` doesn't jump.
* **Page resets**: a `MutationObserver` reapplies the transform if the app clears `content`'s `style`, and another resets zoom when `fitToScreenClass` toggles.
