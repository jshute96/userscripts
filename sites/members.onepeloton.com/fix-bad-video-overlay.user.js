// ==UserScript==
// @name         Peloton Player: Fix bad video overlay on tall screens
// @namespace    https://github.com/jshute96/userscripts
// @version      2.0.5
// @description  Fixes a bug in Peloton's video player where, on large monitors, a fixed-size overlay is added over the video, creating an ugly horizontal seam.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://members.onepeloton.com/*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[peloton overlay]';
  const URL_PART = 'cf_video_overlay_with_timeline';
  const MARKER = 'data-jshute-overlay-hidden';

  console.log(TAG, 'init', location.pathname);

  // The overlay is a styled-components <div> whose class rule sets a
  // background-image of /_next/static/media/cf_video_overlay_with_timeline.<hash>.png.
  // Class names are hashed and change with the element's props and with
  // each deploy, so we identify the overlay by the PNG's source filename
  // (only its content-hash suffix changes).

  // Main fix: turn off the background in the CSS rule itself. That covers
  // every element using the rule, including ones mounted later.
  // styled-components adds rules with insertRule as components render (a
  // new one when props change the class), so we patch rules already there
  // and wrap insertRule to catch the rest.
  let rulesFixed = 0;
  function fixRules(rules) {
    for (const rule of rules) {
      if (rule.cssRules) fixRules(rule.cssRules);
      if (!rule.style || !rule.style.backgroundImage.includes(URL_PART)) continue;
      rule.style.setProperty('background-image', 'none', 'important');
      rulesFixed++;
      console.log(TAG, 'hid overlay in style rule', rule.selectorText);
    }
  }
  function fixSheet(sheet) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch (e) {
      return; // cross-origin sheet; the element scan below covers it
    }
    fixRules(rules);
  }
  function fixAllSheets() {
    for (const sheet of document.styleSheets) fixSheet(sheet);
  }

  const origInsertRule = CSSStyleSheet.prototype.insertRule;
  CSSStyleSheet.prototype.insertRule = function (text, ...rest) {
    const index = origInsertRule.call(this, text, ...rest);
    if (String(text).includes(URL_PART)) fixRules([this.cssRules[index]]);
    return index;
  };

  // Rules can also arrive as text in a new <style> or <link>, e.g. if
  // styled-components isn't in its insertRule mode.
  new MutationObserver(muts => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        const el = n.nodeType === Node.TEXT_NODE ? n.parentElement : n;
        if (el?.sheet) fixSheet(el.sheet);
        if (el?.tagName === 'LINK') el.addEventListener('load', () => fixSheet(el.sheet), { once: true });
      }
    }
  }).observe(document.head, { childList: true, subtree: true });

  fixAllSheets();

  // Fallback: an element still showing the PNG (from a sheet we couldn't
  // read, or an inline style) gets it removed inline.
  function clearOverlay() {
    for (const el of document.querySelectorAll('div')) {
      if (el.hasAttribute(MARKER)) continue;
      const bg = getComputedStyle(el).backgroundImage;
      if (!bg.includes(URL_PART)) continue;
      el.style.setProperty('background-image', 'none', 'important');
      el.setAttribute(MARKER, '');
      console.log(TAG, 'hid overlay on', el);
    }
  }

  // The player div is rendered after route navigation finishes, so a single
  // sweep at document-idle usually misses it. Poll briefly until found,
  // then stop. URL-change re-arms the poll. Once a rule is fixed this only
  // finds elements the rule fix missed.
  let pollId = null;
  let polls = 0;
  function startPolling() {
    if (pollId) return;
    polls = 0;
    pollId = setInterval(() => {
      fixAllSheets();
      clearOverlay();
      polls++;
      const found = rulesFixed > 0 || document.querySelector(`[${MARKER}]`);
      if (found || polls > 40) {
        clearInterval(pollId);
        pollId = null;
        if (!found && location.pathname.startsWith('/classes/player/')) {
          console.log(TAG, 'gave up after 10s without finding the overlay rule or element');
        }
      }
    }, 250);
  }

  // SPA: hook history mutations and re-arm on URL changes.
  const URL_CHANGE_EVENT = 'peloton-fix-bad-video-overlay:urlchange';
  for (const m of ['pushState', 'replaceState']) {
    const orig = history[m];
    history[m] = function (...a) {
      const r = orig.apply(this, a);
      window.dispatchEvent(new Event(URL_CHANGE_EVENT));
      return r;
    };
  }
  // The player div is re-mounted on player navigation, and the new one
  // has no marker, so the poll picks it up.
  window.addEventListener('popstate', startPolling);
  window.addEventListener(URL_CHANGE_EVENT, startPolling);

  startPolling();
})();
