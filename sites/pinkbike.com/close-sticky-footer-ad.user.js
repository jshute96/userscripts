// ==UserScript==
// @name         Pinkbike: auto-close sticky footer ad
// @namespace    https://github.com/jshute96/userscripts
// @version      1.0.4
// @description  Automatically clicks the X on the sticky footer ad popup on Pinkbike.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://www.pinkbike.com/*
// @grant        none
// @run-at       document-idle
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

  let dismissed = false;
  let footerObserver = null;

  function tryClose() {
    if (dismissed) return;
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
      return;
    }
    console.log(TAG, 'sticky footer ad closed');
    dismissed = true;
    if (footerObserver) {
      footerObserver.disconnect();
      footerObserver = null;
    }
  }

  function watchFooter(footer) {
    console.log(TAG, 'found #' + FOOTER_ID + ', attaching observer');
    tryClose();
    if (dismissed) return;
    footerObserver = new MutationObserver(tryClose);
    footerObserver.observe(footer, {
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
