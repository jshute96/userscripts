// ==UserScript==
// @name         example.com: error button
// @namespace    https://github.com/jshute96/userscripts
// @version      1.1.1
// @description  Test fixture: adds "Error" buttons that throw when clicked — one from the script body, one from @require'd code.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://example.com/*
// @match        http://example.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// @icon         example-icon.png
// @require      installed-list.js
// @require      error-thrower.js
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[error button]';
  const BUTTON_ID = 'jshute-error-button';
  const REQUIRE_BUTTON_ID = 'jshute-error-from-require-button';

  console.log(TAG, 'init');

  if (document.getElementById(BUTTON_ID)) {
    console.log(TAG, 'buttons already present, skipping');
    return;
  }

  // Throws from the script body — the top stack frames should name
  // this .user.js file. One function deep on purpose: throwing
  // straight from the handler gives a single frame, which doesn't
  // show whether intra-script frames survive the way
  // error-thrower.js does for @require'd code.
  function throwFromScriptBody(detail) {
    throw new Error(`error-button.user.js: intentional failure from the script body (${detail})`);
  }

  const button = document.createElement('button');
  button.id = BUTTON_ID;
  button.type = 'button';
  button.textContent = 'Error';
  button.addEventListener('click', () => {
    console.log(TAG, 'clicked — about to throw from the script body');
    throwFromScriptBody('clicked');
  });

  // Throws from @require'd library code instead — the interesting
  // case for stack traces. If the manager concatenates requires into
  // the script's own injected source, the top frames should still name
  // error-thrower.js at its own line numbers rather than an offset
  // into the combined source. See error-thrower.js.
  const requireButton = document.createElement('button');
  requireButton.id = REQUIRE_BUTTON_ID;
  requireButton.type = 'button';
  requireButton.textContent = 'Error from @require';
  requireButton.addEventListener('click', () => {
    console.log(TAG, 'clicked — about to throw from @require\'d code');
    jshuteThrowFromRequire('clicked');
  });

  jshuteAddInstalledScript(
    'error-button.user.js',
    'adds ', button, ' and ', requireButton,
    ' buttons that throw when clicked (the second from @require\'d code)',
  );

  console.log(TAG, 'ready');
})();
