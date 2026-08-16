// Opt-in `GM_*` fakes for Playwright specs.
//
// The `loadUserscript` fixture runs a userscript's raw body in the
// page's own world with no userscript manager present (see CLAUDE.md →
// Testing), so every `@grant`ed `GM_*` name is undefined. A script that
// touches GM storage on a path the test executes throws a
// ReferenceError, which aborts the whole IIFE and shows up as "element
// not found" in every test in the file.
//
// This installs a minimal fake so such a script can run. Call it
// BEFORE `loadUserscript` — the stubs must exist when the body runs.
//
//     const { injectGmStubs } = require('../../test/gm-stubs');
//     await injectGmStubs(page, { values: { seenActivityIds: ['123'] } });
//     await loadUserscript(SCRIPT_PATH);
//
// WHAT THIS DOES NOT PROVE. The store is a plain object: synchronous,
// same-page, instant, and gone when the page goes. It models none of a
// real manager's semantics — no write debounce, no persistence across
// loads, and above all no delivery to other tabs. A stubbed test tells
// you the script's own logic is right and nothing about whether the
// manager actually carries a value anywhere. Anything cross-tab or
// cross-origin has to be checked by hand in a browser with the real
// manager installed.
//
// Deliberately kept out of `loadUserscript`: a spec should have to say
// it is faking the manager, so nobody mistakes a green suite for
// end-to-end coverage.

// Recorded calls are readable from the test via
// `page.evaluate(() => window.__gmStubs.openedTabs)`.
async function injectGmStubs(page, options = {}) {
  const initial = options.values || {};
  await page.addInitScript((seed) => {
    const store = Object.assign({}, seed);
    const listeners = [];
    let nextId = 0;
    const record = { openedTabs: [], menuCommands: [], notifications: [] };

    const fire = (key, oldValue, newValue) => {
      // `remote` is false: a same-page write is a local one. Nothing
      // here can produce a remote change — that needs a real manager.
      for (const entry of listeners) {
        if (entry && entry.key === key) entry.callback(key, oldValue, newValue, false);
      }
    };

    window.GM_getValue = (key, fallback) => (key in store ? store[key] : fallback);
    window.GM_setValue = (key, value) => {
      const old = store[key];
      store[key] = value;
      fire(key, old, value);
    };
    window.GM_deleteValue = (key) => {
      const old = store[key];
      delete store[key];
      fire(key, old, undefined);
    };
    window.GM_listValues = () => Object.keys(store);
    window.GM_addValueChangeListener = (key, callback) => {
      listeners.push({ id: ++nextId, key, callback });
      return nextId;
    };
    window.GM_removeValueChangeListener = (id) => {
      const i = listeners.findIndex((entry) => entry && entry.id === id);
      if (i >= 0) listeners[i] = null;
    };
    // Recording no-ops: opening a tab or registering a menu command in
    // a test would be a side effect, so capture the intent instead.
    window.GM_openInTab = (url, opts) => { record.openedTabs.push({ url, opts }); };
    window.GM_registerMenuCommand = (label, fn) => {
      record.menuCommands.push(label);
      record[label] = fn;
      return label;
    };
    window.GM_unregisterMenuCommand = () => {};
    window.GM_notification = (opts) => { record.notifications.push(opts); };

    record.store = store;
    window.__gmStubs = record;
  }, initial);
}

module.exports = { injectGmStubs };
