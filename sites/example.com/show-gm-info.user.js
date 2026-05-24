// ==UserScript==
// @name         example.com: show GM_info
// @namespace    https://github.com/jshute96/userscripts
// @version      1.0.0
// @description  Test fixture: adds a "Show GM_info" button that prints the GM_info payload under the bullet.
// @author       Jeff Shute <jshute@gmail.com>
// @match        https://example.com/*
// @match        http://example.com/*
// @run-at       document-idle
// @grant        GM_info
// @noframes
// @icon         example-icon.png
// @require      installed-list.js
// @updateURL    https://github.com/jshute96/userscripts/raw/refs/heads/main/sites/example.com/show-gm-info.user.js
// @downloadURL  https://github.com/jshute96/userscripts/raw/refs/heads/main/sites/example.com/show-gm-info.user.js
// ==/UserScript==

(function () {
    'use strict';

    const TAG = '[gm info]';
    const BUTTON_ID = 'jshute-show-gm-info-button';
    const OUTPUT_ID = 'jshute-show-gm-info-output';

    console.log(TAG, 'init');

    if (document.getElementById(BUTTON_ID)) {
        console.log(TAG, 'button already present, skipping');
        return;
    }

    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.textContent = 'Show GM_info';
    button.addEventListener('click', () => {
        const li = button.closest('li');
        if (!li) {
            console.log(TAG, 'no enclosing <li>, cannot render output');
            return;
        }
        const existing = document.getElementById(OUTPUT_ID);
        if (existing) {
            existing.remove();
            console.log(TAG, 'output hidden');
            return;
        }
        const pre = document.createElement('pre');
        pre.id = OUTPUT_ID;
        pre.style.marginLeft = '2em';
        pre.style.whiteSpace = 'pre-wrap';
        pre.style.wordBreak = 'break-word';
        pre.textContent = JSON.stringify(GM_info, null, 2);
        li.appendChild(pre);
        console.log(TAG, 'output shown');
    });

    jshuteAddInstalledScript(
        'show-gm-info.user.js',
        'adds ', button, ' button',
    );

    console.log(TAG, 'ready');
})();
