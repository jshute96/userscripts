// ==UserScript==
// @name         GitHub: Link to github.io pages
// @namespace    https://github.com/jshute96/userscripts
// @version      1.0.0
// @description  Adds a github.io button next to Raw on file pages, opening the file on the repo's GitHub Pages site. Shown only when the site has that file.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://github.com/*
// @noframes
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      github.io
// ==/UserScript==

(function () {
  'use strict';

  const log = (...args) => console.log('[pages link]', ...args);
  const BUTTON_ID = 'gh-pages-link-button';
  // How long we trust "this repo has no Pages site" before checking again.
  const NO_SITE_MS = 12 * 60 * 60 * 1000;

  // A file page: /<owner>/<repo>/blob/<ref>/<path>. A ref can have
  // slashes, but the branches Pages sites use (main, gh-pages) don't, so
  // the ref is taken as one segment.
  const fileRoute = () => location.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/(([^/]+)\/(.+))$/);

  // Where the file would be on the Pages site: <owner>.github.io/<repo>/,
  // or just <owner>.github.io/ for the owner's own <owner>.github.io repo.
  function siteUrl(owner, repo, path) {
    const host = `${owner.toLowerCase()}.github.io`;
    return repo.toLowerCase() === host ? `https://${host}/${path}` : `https://${host}/${repo}/${path}`;
  }

  function request(method, url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method, url, timeout: 15000,
        onload: resolve,
        onerror: () => reject(new Error(`${method} ${url} failed`)),
        ontimeout: () => reject(new Error(`${method} ${url} timed out`)),
      });
    });
  }

  // The file's URL on the Pages site, or null if it isn't there. We send
  // a HEAD request, so a large file isn't downloaded. A 404 can mean the
  // repo has no Pages site ("Site not found") or the site lacks this file
  // ("Page not found"), and only the page's title tells which, so we GET
  // it to read that. We remember "Site not found", so the repo's other
  // files send no requests.
  async function findOnSite(owner, repo, path) {
    const key = `noSite:${owner}/${repo}`.toLowerCase();
    const noSite = GM_getValue(key);
    if (noSite && Date.now() - noSite < NO_SITE_MS) return null;
    const url = siteUrl(owner, repo, path);
    const head = await request('HEAD', url);
    if (head.status === 200) return head.finalUrl || url; // a custom domain redirects
    if (head.status !== 404) throw new Error(`HEAD ${url}: HTTP ${head.status}`);
    const get = await request('GET', url);
    if (/<title>Site not found/.test(get.responseText)) {
      log(`no Pages site for ${owner}/${repo}`);
      GM_setValue(key, Date.now());
    }
    return null;
  }

  let decidedFor = null; // path we've looked up (or are looking up)
  let shown = null; // our button's group item, for decidedFor

  async function update() {
    const route = fileRoute();
    const path = location.pathname;
    if (decidedFor !== path) {
      // GitHub keeps the header across in-page navigation.
      shown?.remove();
      shown = null;
    }
    if (!route) {
      decidedFor = null;
      return;
    }
    const raw = document.querySelector('[data-testid="raw-button"]');
    // During in-page navigation the header can still be the previous file's.
    if (!raw || !new URL(raw.href).pathname.endsWith(`/${route[3]}`)) return;
    // React redrawing the header takes our button out; put it back.
    if (decidedFor === path) {
      if (shown && !shown.isConnected) raw.parentElement.before(shown);
      return;
    }
    decidedFor = path;

    let href;
    try {
      href = await findOnSite(route[1], route[2], route[5]);
    } catch (e) {
      log('Pages check failed:', e.message);
      return;
    }
    if (location.pathname !== path) return; // navigated away meanwhile
    if (!href) return;
    if (!raw.isConnected) {
      decidedFor = null; // try again on the new header
      return;
    }
    // Raw is a link in an item of a Primer ButtonGroup. Ours gets an item
    // of its own, so the group draws the borders and corners.
    const button = raw.cloneNode(true);
    button.id = BUTTON_ID;
    button.removeAttribute('data-testid');
    button.href = href;
    button.title = 'Open this file on the GitHub Pages site';
    const label = button.querySelector('[data-component="text"]') ?? button;
    label.textContent = 'github.io';
    const item = raw.parentElement.cloneNode(false);
    item.append(button);
    raw.parentElement.before(item);
    shown = item;
    log('added github.io link:', button.href);
  }

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; update(); });
  }).observe(document.documentElement, { childList: true, subtree: true });

  log('init');
  update();
})();
