// ==UserScript==
// @name         Garmin Connect: One-click TCX download
// @namespace    https://github.com/jshute96/userscripts
// @version      0.2.3
// @description  Adds a Download button to the activity page toolbar that exports the activity as a TCX file in one click, instead of three clicks inside the More… menu.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://connect.garmin.com/app/*
// @grant        none
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[garmin-tcx]';
  const BUTTON_ID = 'jshute-garmin-tcx-download-btn';
  // The activity toolbar contains three visually-identical icon
  // buttons (Share / Privacy / Gear). The gear's container is
  // tagged with a semantic CSS-module prefix `ActivitySettingsMenu_menuContainer`
  // and `title="More..."` — much more stable than identifying by SVG
  // path geometry. We match by class prefix.
  const GEAR_CONTAINER_SELECTOR = '[class*="ActivitySettingsMenu_menuContainer"]';
  const MENU_SELECTOR = '[class*="ActionMenu_menu"]';
  const MENU_ITEM_SELECTOR = '[class*="ActionMenuItem_actionMenuItem"]';
  const TCX_LABEL = /^export to tcx$/i;

  // Garmin Connect is a SPA: navigating between Activities, Home, and
  // an activity page does pushState only, no document reload. We
  // broaden @match to /app/* and gate on the pathname instead.
  const ACTIVITY_PATH_RE = /^\/app\/activity\//;
  const isActivityPage = () => ACTIVITY_PATH_RE.test(location.pathname);

  console.log(TAG, 'init on', location.pathname);

  function findGearButton() {
    const container = document.querySelector(GEAR_CONTAINER_SELECTOR);
    return container ? container.querySelector(':scope > button') : null;
  }

  // The toolbar row we append to: the flex container holding the gear's
  // container (ActivityToolbar_activitySettings).
  function findToolbarRow(gearBtn) {
    return gearBtn.closest('[class*="ActivityToolbar_activitySettings"]');
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
    // The menu renders inside the gear's container, a few ms after
    // the click. Poll briefly for its items.
    const container = gear.parentElement;
    clickElement(gear);
    const started = Date.now();
    const poll = () => {
      const items = container.querySelectorAll(MENU_ITEM_SELECTOR);
      const target = [...items].find(it => TCX_LABEL.test((it.textContent || '').trim()));
      if (target) {
        console.log(TAG, 'clicking Export to TCX');
        clickElement(target);
        return;
      }
      if (Date.now() - started < 1000) {
        setTimeout(poll, 25);
        return;
      }
      if (!container.querySelector(MENU_SELECTOR)) {
        console.log(TAG, 'gear menu did not open');
        return;
      }
      console.log(TAG, 'Export to TCX item not found in opened menu');
      // Close the menu we opened.
      clickElement(gear);
    };
    setTimeout(poll, 25);
  }

  function makeButton(gear) {
    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    // Copy the gear's CSS-module classes (hash suffixes rotate per
    // deploy) so the button matches its icon-button neighbors.
    btn.className = gear.className;
    btn.title = 'Download (TCX)';
    btn.setAttribute('aria-label', 'Download (TCX)');
    // Inline SVG download arrow, sized and colored like the
    // neighboring 14px icons.
    btn.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" ' +
      'width="14" height="14" fill="var(--icon-default, currentColor)" aria-hidden="true">' +
      '<path d="M11 3h2v9.586l3.293-3.293 1.414 1.414L12 16.414l-5.707-5.707 ' +
      '1.414-1.414L11 12.586V3zM5 19h14v2H5v-2z"/></svg>';
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
    const row = findToolbarRow(gear);
    if (!row) return false;
    // Insert as the last child of the activity-settings row, i.e.
    // immediately after the gear's container.
    row.appendChild(makeButton(gear));
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
