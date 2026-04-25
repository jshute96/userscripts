// ==UserScript==
// @name         TechCrunch: auto-close newsletter popup
// @namespace    https://github.com/jshute/userscripts
// @version      1.0.0
// @description  Automatically clicks the X on the "Save your valuable time with TechCrunch in your inbox" newsletter popup.
// @match        https://techcrunch.com/*
// @grant        none
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
        if (!document.querySelector(MODAL_SELECTOR) || !isVisible(document.querySelector(MODAL_SELECTOR))) {
            console.log(TAG, 'newsletter popup closed');
            dismissed = true;
        } else {
            console.warn(TAG, 'click did not hide the popup');
        }
    }

    tryClose();
    new MutationObserver(tryClose).observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['style', 'class'],
    });
})();
