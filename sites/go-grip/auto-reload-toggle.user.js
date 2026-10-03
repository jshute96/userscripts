// ==UserScript==
// @name         go-grip: Add toggle to pause auto-reload
// @namespace    https://github.com/jshute96/userscripts
// @version      0.1.7
// @description  Add a button to the go-grip markdown preview to pause auto-reload while you read, and skip reloads when this page's file didn't change.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        http://localhost:6419/*
// @match        http://localhost:6420/*
// @match        http://localhost:6421/*
// @match        http://localhost:6422/*
// @grant        none
// @noframes
// @run-at       document-start
// ==/UserScript==

// 6419 is go-grip's default port. The next three are for running more
// servers at once (e.g. from a wrapper script) with -p.

// go-grip's page ends with an inline script that opens a WebSocket to
// /reload_ws and calls location.reload() when it gets a "reload"
// message, or when it reconnects after the server restarts.
// location.reload can't be overridden, so we wrap the WebSocket
// constructor before that script runs, and gate the handlers it sets
// on our reload_ws socket.
//
// go-grip signals a reload when any file in its directory changes, so
// we also refetch this page and skip the reload when its HTML is the
// same as what's shown, and none of its images changed since it loaded.

(function () {
  'use strict';

  const log = (...args) => console.log('[go-grip reload]', ...args);
  const STORAGE_KEY = 'go-grip-auto-reload';
  const BUTTON_ID = 'go-grip-reload-toggle';

  function readEnabled() {
    try {
      return localStorage.getItem(STORAGE_KEY) !== 'off';
    } catch (e) {
      return true;
    }
  }

  function writeEnabled(on) {
    try {
      localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
    } catch (e) {}
  }

  let enabled = readEnabled();
  // Set when a reload was blocked while disabled: the page is stale.
  let pending = false;
  // This page's HTML as served when it loaded (a promise; null if the
  // fetch failed), to compare against when go-grip signals a reload.
  let baseline = null;
  // Set when the page opens its reload socket. go-grip --no-reload
  // leaves out the reload script, and then we add no button.
  let sawReloadSocket = false;

  log('init, auto-reload', enabled ? 'on' : 'off');

  // --- Gate the reload socket ---

  const NativeWebSocket = window.WebSocket;

  async function fetchPage() {
    try {
      const resp = await fetch(location.href, { cache: 'no-store' });
      return resp.ok ? await resp.text() : null;
    } catch (e) {
      return null;
    }
  }

  // Whether this page's HTML differs from what's shown. Counts as
  // changed when either fetch failed, so we fall back to reloading.
  async function htmlChanged() {
    const [before, now] = await Promise.all([baseline, fetchPage()]);
    return before === null || now === null || before !== now;
  }

  // Whether any of the page's local images changed since it loaded,
  // by their Last-Modified (whole seconds). go-grip's file server sends
  // it, and runs on this machine, so its clock is ours. A file saved in
  // the second the page loaded counts as changed: at worst one extra
  // reload.
  const loadSecond = Math.floor(performance.timeOrigin / 1000) * 1000;

  async function imageChanged(url, wasLoaded) {
    try {
      const resp = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      // Missing now: changed only if it was there before.
      if (!resp.ok) return wasLoaded;
      const modified = Date.parse(resp.headers.get('Last-Modified'));
      return isNaN(modified) || modified >= loadSecond;
    } catch (e) {
      return true;
    }
  }

  async function imagesChanged() {
    const images = new Map();  // url -> whether it loaded
    for (const img of document.images) {
      let url;
      try {
        url = new URL(img.currentSrc || img.src, location.href);
      } catch (e) {
        continue;
      }
      // Skip other sites, and go-grip's own assets (not from the
      // directory it watches).
      if (url.origin !== location.origin || url.pathname.startsWith('/static/')) continue;
      url.hash = '';
      const loaded = !(img.complete && img.naturalWidth === 0);
      images.set(url.href, images.get(url.href) || loaded);
    }
    const urls = [...images.keys()];
    const results = await Promise.all(urls.map((url) => imageChanged(url, images.get(url))));
    const changed = urls.filter((url, i) => results[i]);
    if (changed.length) log('images changed:', changed.join(' '));
    return changed.length > 0;
  }

  async function pageChanged() {
    const [html, images] = await Promise.all([htmlChanged(), imagesChanged()]);
    return html || images;
  }

  function gate(prop, fn) {
    return async function (ev) {
      const isReload = prop === 'onopen' || ev.data === 'reload';
      if (!isReload) return fn.call(this, ev);
      const why = prop === 'onopen' ? '(server reconnected)' : '(file changed)';
      const changed = await pageChanged();
      if (!changed) {
        log('page unchanged, skipping reload', why);
      } else if (enabled) {
        log('page changed, reloading', why);
        return fn.call(this, ev);
      } else {
        log('blocked reload', why);
      }
      // Recomputed each time, so a file changed back clears the dot.
      pending = changed;
      updateButton();
    };
  }

  class GatedWebSocket extends NativeWebSocket {
    constructor(url, protocols) {
      super(url, protocols);
      if (!String(url).includes('/reload_ws')) return;
      if (!sawReloadSocket) baseline = fetchPage();
      sawReloadSocket = true;
      log('gating reload socket');
      for (const prop of ['onmessage', 'onopen']) {
        const desc = Object.getOwnPropertyDescriptor(NativeWebSocket.prototype, prop);
        let handler = null;
        Object.defineProperty(this, prop, {
          configurable: true,
          get: () => handler,
          set: (fn) => {
            handler = fn;
            desc.set.call(this, typeof fn === 'function' ? gate(prop, fn) : fn);
          },
        });
      }
    }
  }
  window.WebSocket = GatedWebSocket;

  // --- Toggle button, next to go-grip's theme toggle ---

  const CSS = `
    #${BUTTON_ID} { right: 60px; }
    /* On: drawn as a pressed-in toggle. */
    #${BUTTON_ID}[aria-pressed="true"] {
      opacity: 1; background: #eaeef2;
      box-shadow: inset 0 1px 3px rgba(31, 35, 40, 0.25);
    }
    [data-theme="dark"] #${BUTTON_ID}[aria-pressed="true"] {
      background: #30363d; box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.6);
    }
    #${BUTTON_ID}.pending { opacity: 1; }
    #${BUTTON_ID}.pending::after {
      content: ''; position: absolute; top: -4px; right: -4px;
      width: 8px; height: 8px; border-radius: 50%; background: #1f6feb;
    }
  `;

  function updateButton() {
    const btn = document.getElementById(BUTTON_ID);
    if (!btn) return;
    btn.setAttribute('aria-pressed', String(enabled));
    btn.classList.toggle('pending', !enabled && pending);
    btn.title = enabled ? 'Auto-reload: On'
      : pending ? 'Reload updated page\nAuto-reload: Off'
        : 'Auto-reload: Off';
  }

  // With a change waiting, a click just reloads, leaving auto-reload
  // off. Otherwise it toggles auto-reload.
  function onClick() {
    if (!enabled && pending) {
      log('reloading for blocked change');
      location.reload();
      return;
    }
    enabled = !enabled;
    writeEnabled(enabled);
    log('auto-reload', enabled ? 'on' : 'off');
    updateButton();
  }

  function addButton() {
    const themeToggle = document.getElementById('theme-toggle');
    if (!themeToggle || !document.title.startsWith('go-grip')) {
      log('not a go-grip page, no button');
      return;
    }
    // The reload script is inline at the end of <body>, so it has
    // run by DOMContentLoaded.
    if (!sawReloadSocket) {
      log('no reload socket (go-grip --no-reload?), no button');
      return;
    }
    if (document.getElementById(BUTTON_ID)) return;

    const style = document.createElement('style');
    style.dataset.goGripReload = '';
    style.textContent = CSS;
    document.head.appendChild(style);

    const btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.className = themeToggle.className;
    const icon = document.createElement('span');
    icon.className = 'theme-toggle-icon';
    icon.textContent = '↻';
    btn.appendChild(icon);
    btn.addEventListener('click', onClick);
    themeToggle.after(btn);
    updateButton();
    log('button added');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addButton);
  } else {
    addButton();
  }
})();
