// ==UserScript==
// @name         example.com: error on load
// @namespace    https://github.com/jshute96/userscripts
// @version      1.0.0
// @description  Test fixture: throws an unhandled error during initial injection.
// @author       Jeff Shute <jshute@gmail.com>
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

  const TAG = '[error load]';
  console.log(TAG, 'init');

  jshuteAddInstalledScript('error-on-load.user.js', 'throws during init');

  throw new Error('error-on-load: intentional failure during init');
})();
