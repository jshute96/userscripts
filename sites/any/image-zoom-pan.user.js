// ==UserScript==
// @name         Image Viewer: Simple zoom and pan
// @namespace    https://github.com/jshute96/userscripts
// @version      0.1.0
// @description  Replace Chrome's standalone image viewer with mouse-wheel, trackpad, drag, Shift+drag box, and keyboard zoom and pan.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        *://*/*.png
// @match        *://*/*.jpg
// @match        *://*/*.jpeg
// @match        *://*/*.webp
// @match        *://*/*.gif
// @require      https://raw.githubusercontent.com/jshute96/userscripts/main/lib/image-zoom-pan.js
// @grant        none
// @noframes
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  ImageZoomPan.create({
    tag: '[image-zoom]',
  });
})();
