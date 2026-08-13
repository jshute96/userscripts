// ==UserScript==
// @name         example.com: Updated script
// @namespace    https://github.com/jshute96/userscripts
// @version      1.0.2
// @description  Test fixture: bullet text includes a version constant so manual edits to the source file are visible on reload.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://example.com/*
// @match        http://example.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// @icon         example-icon.png
// @require      installed-list.js
// ==/UserScript==

(function () {
  'use strict';

  // Edit this and reload the page. If the bullet under "Installed
  // userscripts" updates to match, the new script body is being
  // picked up. If it doesn't, the install is stale (raw install
  // instead of pointer install, or browser cache, etc.).
  const VERSION_LABEL = 'version 10';

  const TAG = '[updated]';
  console.log(TAG, 'init —', VERSION_LABEL);

  jshuteAddInstalledScript('updated-script.user.js', `change-detection probe — ${VERSION_LABEL}`);

  console.log(TAG, 'ready');
})();
