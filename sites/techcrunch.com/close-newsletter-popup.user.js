// ==UserScript==
// @name         TechCrunch: Auto-close the newsletter popup
// @namespace    https://github.com/jshute96/userscripts
// @version      1.0.4
// @description  Closes the annoying "TechCrunch in your inbox" newsletter popup as soon as it appears.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://techcrunch.com/*
// @grant        none
// @run-at       document-idle
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
