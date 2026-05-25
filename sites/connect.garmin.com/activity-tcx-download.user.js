// ==UserScript==
// @name         Garmin Connect: One-click TCX download on activity page
// @namespace    https://github.com/jshute96/userscripts
// @version      0.2.0
// @description  On a Garmin Connect activity page, adds a Download button next to the gear ("More...") menu that triggers Export to TCX in one click.
// @author       Jeff Shute <jshute@gmail.com>
// @match        https://connect.garmin.com/app/*
// @grant        none
// @noframes
// @run-at       document-idle
// @updateURL    https://github.com/jshute96/userscripts/raw/refs/heads/main/sites/connect.garmin.com/activity-tcx-download.user.js
// @downloadURL  https://github.com/jshute96/userscripts/raw/refs/heads/main/sites/connect.garmin.com/activity-tcx-download.user.js
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[garmin-tcx]';
  const BUTTON_ID = 'jshute-garmin-tcx-download-btn';
  // The activity toolbar contains three visually-similar Menu_menuBtn
  // buttons (Share / Privacy / Gear). The gear's outer container is
  // tagged with a semantic CSS-module prefix `ActivitySettingsMenu_menuContainer`
  // and `title="More..."` — much more stable than identifying by SVG
  // path geometry. We match by class prefix.
  const GEAR_CONTAINER_SELECTOR = '[class*="ActivitySettingsMenu_menuContainer"]';
  const TCX_LABEL = /^export to tcx$/i;

  // Garmin Connect is a SPA: navigating between Activities, Home, and
  // an activity page does pushState only, no document reload. We
  // broaden @match to /app/* and gate on the pathname instead.
  const ACTIVITY_PATH_RE = /^\/app\/activity\//;
  const isActivityPage = () => ACTIVITY_PATH_RE.test(location.pathname);

  console.log(TAG, 'init on', location.pathname);

  function findGearButton() {
    const container = document.querySelector(GEAR_CONTAINER_SELECTOR);
    return container ? container.querySelector('button[class*="Menu_menuBtn"]') : null;
  }

  function findGearContainer(gearBtn) {
    // gearBtn → Menu_menuWrapper → outer wrapper div → ActivitySettingsMenu_menuContainer
    // We want the row that's a flex container — that's
    // ActivityToolbar_activitySettings (one level up from the
    // gear container). We'll insert as a child of that row, after
    // the gear container.
    let el = gearBtn;
    for (let i = 0; i < 6 && el; i++) {
      if (el.parentElement && el.parentElement.className &&
        /ActivityToolbar_activitySettings/.test(el.parentElement.className.toString())) {
        return { row: el.parentElement, lastChildOfRow: el };
      }
      el = el.parentElement;
    }
    return null;
  }

  function clickElement(el) {
    // .click() on an HTMLElement dispatches a real click event tree
    // (mousedown / mouseup / click), which React picks up reliably.
    // Verified in the page console that this opens the gear menu.
    el.click();
  }

  function triggerExportTcx() {
    const gear = findGearButton();
    if (!gear) {
      console.log(TAG, 'gear button not found at click time');
      return;
    }
    const wrapper = gear.parentElement;
    // Open the menu.
    clickElement(gear);
    // Garmin renders menu items synchronously after the click, but
    // we still defer one tick so React's state update has flushed.
    setTimeout(() => {
      const items = wrapper.querySelectorAll('[class*="Menu_menuItems"]');
      let target = null;
      for (const it of items) {
        if (TCX_LABEL.test((it.textContent || '').trim())) { target = it; break; }
      }
      if (!target) {
        console.log(TAG, 'Export to TCX item not found in opened menu');
        // Close the menu we opened.
        clickElement(gear);
        return;
      }
      console.log(TAG, 'clicking Export to TCX');
      clickElement(target);
    }, 50);
  }

  function makeButton() {
    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.title = 'Download (TCX)';
    btn.setAttribute('aria-label', 'Download (TCX)');
    // Inline SVG download arrow, sized to match neighbouring 14px icons.
    btn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ' +
      'width="14" height="14" fill="currentColor" aria-hidden="true">' +
      '<path d="M11 3h2v9.586l3.293-3.293 1.414 1.414L12 16.414l-5.707-5.707 ' +
      '1.414-1.414L11 12.586V3zM5 19h14v2H5v-2z"/></svg>';
    Object.assign(btn.style, {
      marginLeft: '4px',
      padding: '6px',
      border: '1px solid var(--border-default, #c8c8c8)',
      borderRadius: '4px',
      background: 'var(--background-alt, #fff)',
      color: 'var(--text-default, #222)',
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      lineHeight: '0',
    });
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      triggerExportTcx();
    });
    return btn;
  }

  function ensureButton() {
    if (!isActivityPage()) return false;
    if (document.getElementById(BUTTON_ID)) return false;
    const gear = findGearButton();
    if (!gear) return false;
    const placement = findGearContainer(gear);
    if (!placement) return false;
    // Insert as the last child of the activity-settings row, i.e.
    // immediately after the gear's container.
    placement.row.appendChild(makeButton());
    console.log(TAG, 'download button inserted next to gear');
    return true;
  }

  function onUrlChange() {
    // ensureButton() self-gates on isActivityPage(). If the toolbar
    // isn't in the DOM yet, the MutationObserver below will pick it
    // up as Garmin renders the activity view.
    ensureButton();
  }

  // Wrap pushState/replaceState so we get notified of SPA navigations
  // (popstate alone misses programmatic navigation). The event name is
  // script-scoped so other userscripts on the same origin can use the
  // same pattern without colliding on a shared event.
  const URL_CHANGE_EVENT = 'garmin-tcx:urlchange';
  for (const m of ['pushState', 'replaceState']) {
    const orig = history[m];
    history[m] = function (...a) {
      const r = orig.apply(this, a);
      window.dispatchEvent(new Event(URL_CHANGE_EVENT));
      return r;
    };
  }
  window.addEventListener('popstate', onUrlChange);
  window.addEventListener(URL_CHANGE_EVENT, onUrlChange);

  if (isActivityPage() && !ensureButton()) {
    console.log(TAG, 'gear not found yet; watching for it');
  }

  // The activity page is inside a SPA — switching to a different
  // activity rebuilds the toolbar, which would drop our button.
  // ensureButton() self-gates on the current pathname, so this is a
  // no-op on non-activity pages.
  const observer = new MutationObserver(() => {
    if (isActivityPage() && !document.getElementById(BUTTON_ID)) {
      ensureButton();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
