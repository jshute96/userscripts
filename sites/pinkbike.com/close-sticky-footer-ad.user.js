// ==UserScript==
// @name         Pinkbike: auto-close sticky footer ad
// @namespace    https://github.com/jshute/userscripts
// @version      1.0.2
// @description  Automatically clicks the X on the sticky footer ad popup on Pinkbike.
// @match        https://www.pinkbike.com/*
// @grant        none
// @updateURL    https://github.com/jshute96/userscripts/raw/refs/heads/main/sites/pinkbike.com/close-sticky-footer-ad.user.js
// @downloadURL  https://github.com/jshute96/userscripts/raw/refs/heads/main/sites/pinkbike.com/close-sticky-footer-ad.user.js
// ==/UserScript==

(function () {
    'use strict';

    const TAG = '[pinkbike ad]';
    const FOOTER_ID = 'nfs_footer';
    const CLOSE_ID = 'sticky-footer-pb-close';

    console.log(TAG, 'initializing');

    function isVisible(el) {
        if (!el) return false;
        if (el.style && el.style.display === 'none') return false;
        return el.offsetParent !== null || getComputedStyle(el).display !== 'none';
    }

    function tryClose() {
        const footer = document.getElementById(FOOTER_ID);
        if (!footer || !isVisible(footer)) return;
        const btn = document.getElementById(CLOSE_ID);
        if (!btn) {
            console.warn(TAG, 'footer is visible but close button not found');
            return;
        }
        console.log(TAG, 'sticky footer ad detected — clicking close');
        btn.click();
        if (isVisible(footer)) {
            console.warn(TAG, 'click did not hide the footer');
        } else {
            console.log(TAG, 'sticky footer ad closed');
        }
    }

    function watchFooter(footer) {
        console.log(TAG, 'found #' + FOOTER_ID + ', attaching observer');
        tryClose();
        new MutationObserver(tryClose).observe(footer, {
            attributes: true,
            attributeFilter: ['style', 'class'],
        });
    }

    function waitForFooter() {
        const existing = document.getElementById(FOOTER_ID);
        if (existing) {
            watchFooter(existing);
            return;
        }
        console.log(TAG, '#' + FOOTER_ID + ' not present yet, waiting');
        const bodyObserver = new MutationObserver(() => {
            const footer = document.getElementById(FOOTER_ID);
            if (footer) {
                bodyObserver.disconnect();
                watchFooter(footer);
            }
        });
        bodyObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    waitForFooter();
})();
