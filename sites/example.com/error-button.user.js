// ==UserScript==
// @name         example.com: error button
// @namespace    https://github.com/jshute96/userscripts
// @version      1.0.0
// @description  Test fixture: adds an "Error" button that throws when clicked.
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

  const TAG = '[error button]';
  const BUTTON_ID = 'jshute-error-button';

  console.log(TAG, 'init');

  if (document.getElementById(BUTTON_ID)) {
    console.log(TAG, 'button already present, skipping');
    return;
  }

  const button = document.createElement('button');
  button.id = BUTTON_ID;
  button.type = 'button';
  button.textContent = 'Error';
  button.addEventListener('click', () => {
    console.log(TAG, 'clicked — about to throw');
    throw new Error('error-button: intentional failure on click');
  });

  jshuteAddInstalledScript(
    'error-button.user.js',
    'adds ', button, ' button that throws when clicked',
  );

  console.log(TAG, 'ready');
})();
