// ==UserScript==
// @name         Chrome Image Viewer: Simple zoom and pan
// @namespace    https://github.com/jshute96/userscripts
// @version      0.1.1
// @description  Enhance Chrome's standalone image viewer (for links to PNG, JPG, etc. files) with zoom and pan, controlled by mouse, keyboard or trackpad.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @include      /^(https?|file):\/\/[^?#]*\.(png|jpe?g|webp|gif|avif|bmp|ico)([?#].*)?$/
// @include      /^https:\/\/encrypted-tbn\d+\.gstatic\.com\/images\?/
// @include      /^https:\/\/(lh\d+|play-lh|yt3|blogger)\.googleusercontent\.com\//
// @match        https://pbs.twimg.com/media/*
// @match        *://*/_next/image?*
// @require      https://raw.githubusercontent.com/jshute96/userscripts/main/lib/image-zoom-pan.js
// @grant        none
// @noframes
// @run-at       document-start
// ==/UserScript==

// Where it runs (the @include / @match rules above, in order):
//   1. Links to image files: the path ends in an image extension (any
//      case), optionally followed by a query or fragment.
//   2. Google Images thumbnails: encrypted-tbn0.gstatic.com/images?q=tbn:...
//   3. Google's image hosts on googleusercontent.com: lh3 (Google Photos,
//      profile pictures), play-lh (Google Play), yt3 (YouTube avatars),
//      blogger (Blogger images). Not all of *.googleusercontent.com,
//      which also hosts Colab, Google Sites and Drive downloads.
//   4. X (Twitter) photos: pbs.twimg.com/media/<id>?format=jpg
//   5. The Next.js image resizer, on any site: /_next/image?url=...
// Rules 2-5 cover image hosts whose URLs have no extension. A matched URL
// can still serve a web page; the library does nothing then.

(function () {
  'use strict';

  ImageZoomPan.create({
    tag: '[image-zoom]',
  });
})();
