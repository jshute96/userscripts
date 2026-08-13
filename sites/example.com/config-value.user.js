// ==UserScript==
// @name         example.com: Config value with context-menu update
// @namespace    https://github.com/jshute96/userscripts
// @version      1.0.2
// @description  Test fixture: adds a "the message_value is: <value>" bullet whose value is set via the userscript context menu and saved in GM storage.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        *://example.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @noframes
// @icon         example-icon.png
// @require      installed-list.js
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[config value]';
  const STORAGE_KEY = 'jshute-config-message_value';
  const SENTINEL = Symbol('unset');

  console.log(TAG, 'init');

  function readValue() {
    const v = GM_getValue(STORAGE_KEY, undefined);
    return v === undefined ? SENTINEL : v;
  }

  const valueSpan = document.createElement('span');

  function renderValue() {
    valueSpan.textContent = '';
    const v = readValue();
    if (v === SENTINEL) {
      const em = document.createElement('em');
      em.textContent = 'unset';
      valueSpan.appendChild(em);
    } else {
      valueSpan.appendChild(document.createTextNode(String(v)));
    }
  }

  renderValue();

  function promptForValue() {
    const current = readValue();
    let initial = current === SENTINEL ? '' : String(current);
    while (true) {
      const entered = window.prompt(
        'New message_value (at least four characters)\n'+
        '(For config-value.user.js userscript)',
        initial,
      );
      if (entered === null) {
        console.log(TAG, 'set canceled');
        return;
      }
      if (entered.length < 4) {
        console.log(TAG, 'rejected value (too short):', JSON.stringify(entered));
        window.alert('message_value must be at least four characters long.');
        initial = entered;
        continue;
      }
      GM_setValue(STORAGE_KEY, entered);
      console.log(TAG, 'value set to', JSON.stringify(entered));
      renderValue();
      refreshMenu();
      return;
    }
  }

  function clearValue() {
    GM_deleteValue(STORAGE_KEY);
    console.log(TAG, 'value cleared');
    renderValue();
    refreshMenu();
  }

  let menuIds = [];
  function refreshMenu() {
    for (const id of menuIds) GM_unregisterMenuCommand(id);
    menuIds = [];
    menuIds.push(GM_registerMenuCommand('Set message_value', promptForValue));
    if (readValue() !== SENTINEL) {
      menuIds.push(GM_registerMenuCommand('Clear message_value', clearValue));
    }
  }
  refreshMenu();

  jshuteAddInstalledScript(
    'config-value.user.js',
    'the message_value is: ', valueSpan,
  );

  console.log(TAG, 'ready');
})();
