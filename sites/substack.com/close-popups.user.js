// ==UserScript==
// @name         Substack: Auto-close the subscribe, referral, and sign-in popups
// @namespace    https://github.com/jshute96/userscripts
// @version      1.1.1
// @description  Closes the "Discover more from" subscribe popup and the "shared this with you" referral popup that cover a post, and stops the browser's sign-in bubble from appearing at all.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://*.substack.com/*
// @match        https://*/p/*
// @match        https://*/cp/*
// @exclude      https://*.instagram.com/*
// @grant        none
// @run-at       document-start
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[substack popups]';

  console.log(TAG, 'init');

  // ---------------------------------------------------------------------
  // 1. The browser's sign-in bubble.
  //
  // It's Chrome's own FedCM (Federated Credential Management) UI — browser
  // chrome, not page DOM, so nothing in the document can dismiss it. What we
  // can do is intercept the page's request for it: Substack calls
  // navigator.credentials.get({identity: {providers: [...]}}) on load, and
  // that call is what makes the browser show the bubble. Patch it before any
  // page script runs, hence @run-at document-start.
  // ---------------------------------------------------------------------

  const SUBSTACK_HOST = 'substack.com';

  function isSubstackHost(host) {
    return host === SUBSTACK_HOST || host.endsWith('.' + SUBSTACK_HOST);
  }

  // We also run on unrelated sites that happen to use /p/ paths, so decline
  // only the requests that are actually Substack's — anything else (another
  // site's sign-in bubble, a passkey the user deliberately asked for) has to
  // pass through untouched.
  function substackProvider(options) {
    const providers = (options.identity && options.identity.providers) || [];
    for (const p of providers) {
      if (!p || !p.configURL) continue;
      let host;
      try {
        // configURL may be relative, and bare `new URL` throws on those.
        host = new URL(p.configURL, location.href).hostname;
      } catch (e) {
        continue;
      }
      if (isSubstackHost(host)) return p.configURL;
    }
    return null;
  }

  try {
    const creds = navigator.credentials;
    if (!creds || typeof creds.get !== 'function') {
      console.warn(TAG, 'navigator.credentials.get missing; sign-in prompts',
                   'will not be blocked');
    } else {
      const original = creds.get.bind(creds);
      creds.get = function (options) {
        const configURL =
          options && options.identity && substackProvider(options);
        if (configURL) {
          console.log(TAG, 'declining federated sign-in request:', configURL);
          // Reject the way the browser does when the user dismisses the
          // prompt, so the page's own error handling takes the normal path.
          return Promise.reject(new DOMException(
            'User declined the sign-in prompt.', 'NetworkError'));
        }
        return original(options);
      };
    }
  } catch (e) {
    // Keep going: the subscribe-modal half below is independent, and a throw
    // out here would take it down with us.
    console.error(TAG, 'could not patch navigator.credentials.get:', e);
  }

  // ---------------------------------------------------------------------
  // 2. The in-page popups.
  //
  // Substack's CSS-module class names carry build-hash suffixes that rotate on
  // every deploy, so anchor on role/aria attributes and nothing else.
  // ---------------------------------------------------------------------

  // Substack shows several of these, all built from the same dialog
  // component, and names them differently: the "Discover more from" subscribe
  // interstitial is labelled inline, while the referral popup ("<name> shared
  // this with you", from a ?r= share link) is a Radix dialog whose name lives
  // in a visually-hidden <h2> pointed at by aria-labelledby. So match on the
  // accessible name rather than on one attribute.
  const DIALOG_SELECTOR = 'div[role="dialog"]';
  const CLOSE_SELECTOR = 'button[aria-label="close"]';
  const POPUP_NAMES = ['subscribe modal', 'follow on substack'];

  function accessibleName(el) {
    const label = el.getAttribute('aria-label');
    if (label) return label.trim().toLowerCase();
    const id = el.getAttribute('aria-labelledby');
    if (id) {
      // aria-labelledby may list several ids; the name is their text joined.
      const text = id.split(/\s+/)
        .map((i) => document.getElementById(i))
        .filter(Boolean)
        .map((n) => n.textContent)
        .join(' ');
      return text.trim().toLowerCase();
    }
    return '';
  }

  // Returns the first visible popup we recognize, or null. Deliberately
  // name-based: closing every dialog on the page would also dismiss ones the
  // user opened on purpose (share sheets, the comment composer).
  function findPopup() {
    for (const el of document.querySelectorAll(DIALOG_SELECTOR)) {
      if (!isVisible(el)) continue;
      if (POPUP_NAMES.includes(accessibleName(el))) return el;
    }
    return null;
  }

  function isVisible(el) {
    if (!el) return false;
    if (el.offsetParent !== null) return true;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  let closedCount = 0;
  let clickPending = false;
  let failedAttempts = 0;
  // Stop clicking after this many clicks that didn't close anything, so a
  // broken close button can't turn every page mutation into another attempt.
  const MAX_FAILED_ATTEMPTS = 3;
  // React tears the modal down on a later render, not synchronously on the
  // click, and the overlay fades out first — so poll for its removal instead
  // of checking once, and don't re-click while a close is still settling.
  const SETTLE_POLL_MS = 200;
  const SETTLE_TIMEOUT_MS = 3000;

  function confirmClosed(waited) {
    if (!findPopup()) {
      clickPending = false;
      failedAttempts = 0;
      closedCount += 1;
      console.log(TAG, 'popup closed (count:', closedCount + ')');
      return;
    }
    if (waited >= SETTLE_TIMEOUT_MS) {
      clickPending = false;
      failedAttempts += 1;
      if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
        console.error(TAG, 'close button did not work', failedAttempts,
                      'times; giving up on this page');
      } else {
        console.warn(TAG, 'click did not hide the popup after',
                     SETTLE_TIMEOUT_MS, 'ms');
      }
      return;
    }
    setTimeout(() => confirmClosed(waited + SETTLE_POLL_MS), SETTLE_POLL_MS);
  }

  function tryClose() {
    if (clickPending || failedAttempts >= MAX_FAILED_ATTEMPTS) return;
    const popup = findPopup();
    if (!popup) return;
    const btn = popup.querySelector(CLOSE_SELECTOR);
    if (!btn) {
      console.warn(TAG, 'popup visible but close button not found:',
                   accessibleName(popup));
      return;
    }
    console.log(TAG, 'popup detected — clicking close:',
                accessibleName(popup));
    clickPending = true;
    btn.click();
    setTimeout(() => confirmClosed(SETTLE_POLL_MS), SETTLE_POLL_MS);
  }

  // The dimming overlay animates its inline opacity, so mutations arrive once
  // per frame while it fades in; coalesce them into one check per tick.
  // `setTimeout` rather than `requestAnimationFrame`: rAF doesn't run at all
  // in a background tab, so a modal that appears while the tab is hidden would
  // never be looked at.
  const COALESCE_MS = 100;
  let scheduled = false;
  function scheduleTryClose() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      tryClose();
    }, COALESCE_MS);
  }

  // Only Substack's own domains are certain from the URL; a custom-domain blog
  // is identified by its markup — `pencraft` is Substack's design-system class
  // prefix, on every page they render. Without this the script would attach a
  // document-wide observer to the unrelated sites that also use /p/ paths.
  const SUBSTACK_MARKUP_SELECTOR =
    '[class*="pencraft"], link[href*="substackcdn.com"]';

  function onSubstackPage() {
    return isSubstackHost(location.hostname) ||
           !!document.querySelector(SUBSTACK_MARKUP_SELECTOR);
  }

  function watchForPopups() {
    if (!onSubstackPage()) {
      console.log(TAG, 'not a Substack page; not watching for popups');
      return;
    }
    // The subscribe popup is server-rendered, so it's often here already.
    tryClose();
    // Substack can show more than one per page (the referral popup arrives
    // after hydration, later than the subscribe one), and it navigates between
    // posts client-side, so keep watching rather than disconnecting after the
    // first close.
    const observer = new MutationObserver(scheduleTryClose);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    });
  }

  // At @run-at document-start there's no DOM to check yet; if the manager
  // injected us later than that, the document is ready and we start now.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', watchForPopups);
  } else {
    watchForPopups();
  }
})();
