// ==UserScript==
// @name         Chrome Image Viewer: Simple zoom and pan
// @namespace    https://github.com/jshute96/userscripts
// @version      0.1.1
// @description  Enhance Chrome's standalone image viewer (for links to PNG, JPG, etc. files) with zoom and pan, controlled by mouse, keyboard or trackpad.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @include      /^(https?|file):\/\/[^?#]*\.(png|jpe?g|webp|gif|avif|bmp|ico)([?#].*)?$/
// @require      https://raw.githubusercontent.com/jshute96/userscripts/main/lib/image-zoom-pan.js
// @grant        none
// @noframes
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  // Does nothing if the page isn't actually an image, e.g. a URL ending
  // in .png that serves an HTML page.
  ImageZoomPan.create({
    tag: '[image-zoom]',
  });
})();
