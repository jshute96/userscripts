// ==UserScript==
// @name         Feedly: Add Oldest/Newest buttons for single-click order toggle
// @namespace    https://github.com/jshute96/userscripts
// @version      1.2.2
// @description  Adds Oldest and Newest buttons to a feed's toolbar, applying sort order and unread-only filters in one click instead of four.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://feedly.com/*
// @grant        none
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[feedly presets]';

  if (window.__feedlyPresetsLoaded) {
    console.log(TAG, 'already loaded; skipping duplicate run');
    return;
  }
  window.__feedlyPresetsLoaded = true;

  console.log(TAG, 'init on', location.pathname);

  // Attribute that flags buttons we've added so we can detect re-renders.
  const MARK = 'data-jshute-preset';

  // Feedly is a SPA: clicking between My Feedly, a feed, a board,
  // etc. pushState's without a document reload. We broaden @match to
  // the site root and gate work on the pathname instead. Subscription
  // feed pages look like /i/subscription/content/feed%2F<url-encoded>.
  const FEED_PATH_RE = /^\/i\/subscription\/content\/feed/;
  const isFeedPage = () => FEED_PATH_RE.test(location.pathname);

  // Main menu items live in role="menuitem" elements with a child
  // <span> holding the visible label ("Sort by", "Filter by", etc).
  // Submenu options are matched separately by findOption() below
  // since Feedly uses a mix of role values for them.
  function findMainMenuItem(label) {
    const wanted = label.trim().toLowerCase();
    return [...document.querySelectorAll('[role="menuitem"]')].find(el => {
      // Match strictly on the first-level label span. The same menuitem
      // also contains a <p> with the current value (e.g. "Oldest"), and
      // we don't want to confuse those.
      //
      // Case-insensitive: Feedly re-cases UI strings between deploys (it
      // did exactly that to the back-button's aria-label, which broke
      // every preset that had to change the sort). If "Sort by" ever
      // becomes "Sort By", an exact match here would break the script
      // outright, since openMoreMenu() waits on this.
      const span = el.querySelector('span');
      return span && span.textContent.trim().toLowerCase() === wanted;
    });
  }

  function findOption(label) {
    // Sort/Filter submenu options use role="radio" or role="checkbox"
    // (Feedly does not use the ARIA menuitemradio/menuitemcheckbox
    // variants here). We accept a broader set as a safety net and match
    // case-insensitively because Feedly capitalizes inconsistently
    // (e.g. submenu shows "Unread Only" while the main-menu summary
    // text says "1 enabled").
    const candidates = document.querySelectorAll(
      '[role="radio"], [role="checkbox"], [role="menuitemradio"],' +
      ' [role="menuitemcheckbox"], [role="option"]'
    );
    const wanted = label.trim().toLowerCase();
    return [...candidates].find(el => {
      // Some <li> options have an SVG icon child whose textContent is
      // empty — trim() suffices to ignore whitespace. We exclude the
      // back-to-main-menu button by requiring the role be option-like
      // (selected above) and matching on the visible label text.
      return el.textContent.trim().toLowerCase() === wanted;
    });
  }

  function waitFor(predicate, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        let result;
        try { result = predicate(); } catch (e) { result = null; }
        if (result) return resolve(result);
        if (Date.now() - start > timeoutMs) {
          return reject(new Error('waitFor timeout'));
        }
        requestAnimationFrame(tick);
      };
      tick();
    });
  }

  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  function getFeedHeader() {
    // The feed page wrapper has gone through at least one rename
    // (.StreamPage → .FeedPage), so try the current name first then
    // fall back to the semantic `Header` class on the <header> itself.
    // Both are PascalCase React component names, not hash-suffixed.
    return document.querySelector('.FeedPage header')
      || document.querySelector('header.Header');
  }

  function getMoreButton() {
    // The three-dots button in the header is a <button> with
    // aria-haspopup="listbox". Mark-as-read also has that attribute
    // but on its wrapping <div role="combobox"> (not the inner
    // button), so scoping to <button> uniquely targets the
    // three-dots trigger. We must NOT require aria-controls here
    // because Feedly only sets it while the menu is open — when
    // closed the attribute is absent.
    const header = getFeedHeader();
    if (!header) return null;
    return header.querySelector('button[aria-haspopup="listbox"]');
  }

  async function openMoreMenu() {
    const btn = getMoreButton();
    if (!btn) throw new Error('no more-menu button');
    // Three possible states to handle:
    //   1. Main menu already showing → done.
    //   2. A submenu is showing (Feedly does not auto-return to the
    //      main menu after a selection, and toggling the trigger
    //      from the submenu state doesn't reliably land us back on
    //      the main menu either) → click the breadcrumb's
    //      "Back to main menu" button.
    //   3. Menu closed → click the trigger to open.
    if (findMainMenuItem('Sort by')) return;
    // Matched case-insensitively (the `i` flag): Feedly shipped this as
    // "Back to Main Menu" and later re-cased it to "Back to main menu",
    // which silently broke every preset that had to change the sort —
    // openMoreMenu() fell through to the "menu is closed" branch and
    // clicking the trigger doesn't restore the main menu from a submenu.
    const back = document.querySelector('button[aria-label="back to main menu" i]');
    if (back) {
      console.log(TAG, 'returning from submenu to main');
      back.click();
      await waitFor(() => findMainMenuItem('Sort by'));
      return;
    }
    btn.click();
    await waitFor(() => findMainMenuItem('Sort by'));
  }

  async function closeMoreMenu() {
    const btn = getMoreButton();
    if (!btn) return;
    // Clicking the trigger from a submenu state often does NOT
    // dismiss the popup (it may navigate back one level instead).
    // Escape closes reliably from any state. Loop a few times in
    // case the first Escape only closes the submenu.
    for (let i = 0; i < 5 && btn.getAttribute('aria-expanded') === 'true'; i++) {
      document.body.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape', code: 'Escape', bubbles: true, cancelable: true,
      }));
      await sleep(80);
    }
  }

  async function chooseSort(value /* 'Oldest' | 'Newest' */) {
    await openMoreMenu();
    const sortBy = findMainMenuItem('Sort by');
    if (!sortBy) throw new Error('no Sort by item');
    // Already in the chosen state? The current value is shown in the <p>
    // sibling of the label span; skip the click if it already matches.
    // Compared case-insensitively for the same reason as findMainMenuItem:
    // a re-cased summary would silently defeat this state check, and
    // re-selecting the sort that's already active can have side effects
    // (scroll jumps, refetches).
    const currentValue = sortBy.querySelector('p')?.textContent.trim();
    if (currentValue && currentValue.toLowerCase() === value.toLowerCase()) {
      console.log(TAG, 'sort already', value);
      return;
    }
    sortBy.click();
    // Submenu may take a frame to render. Hover sometimes also works,
    // but click() is the most reliable trigger across React versions.
    const option = await waitFor(() => findOption(value));
    console.log(TAG, 'clicking sort option', value);
    option.click();
    // Feedly typically closes the menu after a sort selection. Give the
    // DOM a moment to settle before the next step re-opens it.
    await sleep(150);
  }

  async function setUnreadOnly(wantChecked) {
    await openMoreMenu();
    const filterBy = findMainMenuItem('Filter by');
    if (!filterBy) throw new Error('no Filter by item');
    filterBy.click();
    const option = await waitFor(() => findOption('Unread only'));
    const checked = option.getAttribute('aria-checked') === 'true';
    if (checked === wantChecked) {
      console.log(TAG, 'unread-only already', wantChecked);
    } else {
      console.log(TAG, 'toggling unread-only ->', wantChecked);
      option.click();
    }
    await sleep(150);
    await closeMoreMenu();
  }

  // Failures used to be console-only. When Feedly re-cased an aria-label,
  // presets half-applied (sort changed, filter didn't) with nothing to see
  // unless DevTools was open. Flash the button so a failure is visible.
  function flashFailure(btn) {
    if (!btn) return;
    const original = btn.style.borderColor;
    btn.style.borderColor = '#d33';
    setTimeout(() => { btn.style.borderColor = original; }, 1500);
  }

  async function applyPreset(preset, btn) {
    try {
      console.log(TAG, 'applying preset', preset);
      if (preset === 'oldest') {
        await chooseSort('Oldest');
        await setUnreadOnly(true);
      } else {
        await chooseSort('Newest');
        await setUnreadOnly(false);
      }
      console.log(TAG, 'preset applied:', preset);
    } catch (err) {
      console.log(TAG, 'failed to apply preset', preset, err);
      flashFailure(btn);
      // Try to leave the menu closed even on error.
      try { await closeMoreMenu(); } catch (_) { /* ignore */ }
    }
  }

  function makeButton(label, preset) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.setAttribute(MARK, preset);
    btn.title = preset === 'oldest'
      ? 'Sort by Oldest, show Unread only'
      : 'Sort by Newest, show all articles';
    // Match Feedly's neutral button look without depending on its
    // (obfuscated) class names. Inline styles keep this self-contained.
    Object.assign(btn.style, {
      margin: '0 4px',
      padding: '4px 10px',
      fontSize: '13px',
      fontWeight: '500',
      background: 'transparent',
      border: '1px solid var(--color-border, #d0d0d0)',
      borderRadius: '6px',
      cursor: 'pointer',
      color: 'inherit',
    });
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      applyPreset(preset, btn);
    });
    return btn;
  }

  function findToolbarContainer() {
    // The smallest header descendant that contains both the rightmost
    // toolbar button (three-dots) and the Mark-as-read button is the
    // toolbar's flex row. We inject our buttons as its first children
    // so they appear to the left of the existing icons.
    const header = getFeedHeader();
    if (!header) return null;
    const more = getMoreButton();
    // Case-insensitive for the same reason as the back button above:
    // Feedly re-cases these labels between deploys.
    const markAsRead = header.querySelector('button[aria-label="mark as read" i]');
    if (!more || !markAsRead) return null;
    let container = more.parentElement;
    while (container && container !== header) {
      if (container.contains(markAsRead) && container.contains(more)) {
        return container;
      }
      container = container.parentElement;
    }
    return null;
  }

  // The MutationObserver below is also the normal startup path: on first
  // paint the header genuinely isn't there yet, so "container not found"
  // is expected for a while. Without a deadline log, a renamed selector
  // looks exactly like a slow SPA — which is how a broken version of this
  // script went unnoticed. Log once if we're still empty-handed after
  // MISSING_WARN_MS on a feed page.
  const MISSING_WARN_MS = 10000;
  let missingSince = 0;
  let warnedMissing = false;

  function warnIfStillMissing() {
    if (warnedMissing || !isFeedPage() || findToolbarContainer()) return;
    warnedMissing = true;
    console.log(
      TAG, 'still no toolbar container after', MISSING_WARN_MS, 'ms —',
      'header:', !!getFeedHeader(),
      'three-dots button:', !!getMoreButton(),
      'mark-as-read button:',
      !!(getFeedHeader() || document).querySelector('button[aria-label="mark as read" i]'),
      '— the first false is the selector that broke.'
    );
  }

  function injectButtons() {
    if (!isFeedPage()) return false;
    const container = findToolbarContainer();
    if (!container) {
      if (!missingSince) {
        missingSince = Date.now();
        // Timer as well as the observer: if the DOM goes quiet the
        // observer stops firing and we'd never reach the deadline.
        setTimeout(warnIfStillMissing, MISSING_WARN_MS);
      }
      return false;
    }
    missingSince = 0;
    // Already injected for this header instance?
    if (container.querySelector(`[${MARK}]`)) return true;

    console.log(TAG, 'injecting preset buttons');
    const wrap = document.createElement('span');
    wrap.setAttribute(MARK, 'wrap');
    wrap.style.display = 'inline-flex';
    wrap.style.alignItems = 'center';
    wrap.style.marginRight = '6px';
    wrap.appendChild(makeButton('Oldest', 'oldest'));
    wrap.appendChild(makeButton('Newest', 'newest'));
    container.insertBefore(wrap, container.firstChild);
    return true;
  }

  // Feedly is an SPA: navigating between feeds re-renders the header.
  // Re-inject whenever the DOM changes and our buttons aren't present.
  let pending = false;
  function scheduleInject() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      injectButtons();
    });
  }

  const observer = new MutationObserver(scheduleInject);
  observer.observe(document.body, { childList: true, subtree: true });

  // SPA navigation hooks. popstate covers back/forward; the
  // pushState/replaceState wrapper covers programmatic navigation
  // (which is how Feedly switches between feeds/boards/home). Event
  // name is script-scoped so we don't collide with any other
  // userscript that uses the same idiom on this origin.
  const URL_CHANGE_EVENT = 'feedly-presets:urlchange';
  for (const m of ['pushState', 'replaceState']) {
    const orig = history[m];
    history[m] = function (...a) {
      const r = orig.apply(this, a);
      window.dispatchEvent(new Event(URL_CHANGE_EVENT));
      return r;
    };
  }
  window.addEventListener('popstate', scheduleInject);
  window.addEventListener(URL_CHANGE_EVENT, scheduleInject);

  // Initial attempt — header may not yet exist at document-idle.
  scheduleInject();
})();
