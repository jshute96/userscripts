// ==UserScript==
// @name         TechCrunch: auto-close newsletter popup
// @namespace    https://github.com/jshute96/userscripts
// @version      1.0.2
// @description  Automatically clicks the X on the "Save your valuable time with TechCrunch in your inbox" newsletter popup.
// @author       Jeff Shute <jshute@gmail.com>
// @match        https://techcrunch.com/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://github.com/jshute96/userscripts/raw/refs/heads/main/sites/techcrunch.com/close-newsletter-popup.user.js
// @downloadURL  https://github.com/jshute96/userscripts/raw/refs/heads/main/sites/techcrunch.com/close-newsletter-popup.user.js
// ==/UserScript==

(function () {
    'use strict';

    const TAG = '[techcrunch popup]';
    const MODAL_SELECTOR = '.hb-modal-wrp';
    const CLOSE_SELECTOR = '.hb-modal-wrp button[aria-label="close"]';

    console.log(TAG, 'initializing');

    function isVisible(el) {
        if (!el) return false;
        if (el.offsetParent !== null) return true;
        const cs = getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden';
    }

    let dismissed = false;
    let observer = null;

    function tryClose() {
        if (dismissed) return;
        const modal = document.querySelector(MODAL_SELECTOR);
        if (!modal || !isVisible(modal)) return;
        const btn = document.querySelector(CLOSE_SELECTOR);
        if (!btn) {
            console.warn(TAG, 'modal visible but close button not found');
            return;
        }
        console.log(TAG, 'newsletter popup detected — clicking close');
        btn.click();
        const after = document.querySelector(MODAL_SELECTOR);
        if (!after || !isVisible(after)) {
            console.log(TAG, 'newsletter popup closed');
            dismissed = true;
            if (observer) {
                observer.disconnect();
                observer = null;
            }
        } else {
            console.warn(TAG, 'click did not hide the popup');
        }
    }

    tryClose();
    if (!dismissed) {
        observer = new MutationObserver(tryClose);
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style', 'class'],
        });
    }
})();
