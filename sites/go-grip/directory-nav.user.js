// ==UserScript==
// @name         go-grip: Add path box and Up button
// @namespace    https://github.com/jshute96/userscripts
// @version      0.1.4
// @description  Add a bar with an editable path and an Up button to the go-grip markdown preview's pages and directory listings, and list directories before files.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        http://localhost:6419/*
// @match        http://localhost:6420/*
// @match        http://localhost:6421/*
// @match        http://localhost:6422/*
// @grant        none
// @noframes
// ==/UserScript==

// 6419 is go-grip's default port. The next three are for running more
// servers at once (e.g. from a wrapper script) with -p.

// go-grip renders .md files itself, and hands every other path to Go's
// http.FileServer. For a directory, that writes a bare listing: a <pre>
// of <a> links, one per entry (plus go-grip's reload <script> after it).
// The bar goes on listings, Go's 404 page, and go-grip's markdown pages.

(function () {
  'use strict';

  const log = (...args) => console.log('[go-grip dirnav]', ...args);
  const BAR_ID = 'go-grip-dirnav';

  function isListing() {
    // An empty directory is an empty <pre>; a plain-text page shows as
    // a <pre> of text, which the content type rules out.
    if (!location.pathname.endsWith('/') || document.contentType !== 'text/html') return false;
    const pre = document.body?.firstElementChild;
    return pre?.tagName === 'PRE' && [...pre.children].every((el) => el.tagName === 'A');
  }

  // Go's plain-text 404, for a mistyped path. The bar helps there too.
  function isNotFound() {
    return document.contentType === 'text/plain' &&
      document.body?.textContent.trim() === '404 page not found';
  }

  // go-grip's rendered markdown page, with its theme toggle fixed top
  // right.
  function isMarkdownPage() {
    return document.title.startsWith('go-grip') &&
      document.body?.classList.contains('markdown-body') &&
      !!document.getElementById('theme-toggle');
  }

  // The path relative to go-grip's root, decoded for display:
  // "/a%20b/docs/" -> "a b/docs/".
  function relativePath() {
    return decodeURIComponent(location.pathname).replace(/^\/+/, '');
  }

  function urlFor(relative) {
    const segments = relative.trim().replace(/^\/+/, '').split('/');
    return '/' + segments.map(encodeURIComponent).join('/');
  }

  function parentUrl() {
    // "/a/b/" -> "/a/", and "/a/missing" (a 404) -> "/a/".
    return location.pathname.replace(/[^/]+\/?$/, '');
  }

  // A full-width strip, kept at the top while scrolling. Controls are
  // 32px tall, matching go-grip's toggle buttons.
  const CSS = `
    #${BAR_ID} {
      position: sticky; top: 0; z-index: 999;
      display: flex; align-items: center; gap: 6px; padding: 8px 10px;
      border-bottom: 1px solid #d0d7de; background: #f6f8fa; color: #1f2328;
      font: 14px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    #${BAR_ID} input, #${BAR_ID} a {
      height: 32px; box-sizing: border-box; color: inherit;
      border: 1px solid #d0d7de; border-radius: 6px; background: #fff;
    }
    #${BAR_ID} input {
      flex: 1; min-width: 0; padding: 4px 6px;
      font: 14px ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    /* Go and Up are links styled as buttons, so middle-click and the
       context menu can open them in a new tab. */
    #${BAR_ID} a {
      padding: 4px 12px; font: inherit; line-height: 22px;
      text-decoration: none; cursor: pointer;
    }
    #${BAR_ID} a:not([href]) { cursor: default; opacity: 0.5; }

    /* Listing and 404: over the body's default 8px margin. */
    #${BAR_ID}.listing { margin: -8px -8px 8px; }

    /* Markdown page: go-grip's fixed toggles (top 20px) move up into the
       strip's right end, and in-page links scroll clear of it. */
    #${BAR_ID}.markdown { padding-right: 104px; }
    body.markdown-body .theme-toggle { top: 8px; }
    html:has(#${BAR_ID}) { scroll-padding-top: 56px; }
    [data-theme="dark"] #${BAR_ID} {
      border-color: #30363d; background: #151b23; color: #f0f6fc;
    }
    [data-theme="dark"] #${BAR_ID} input, [data-theme="dark"] #${BAR_ID} a {
      border-color: #30363d; background: #0d1117;
    }
  `;

  // where: 'listing' (also the 404 page) or 'markdown'.
  function addBar(where) {
    if (document.getElementById(BAR_ID)) return;

    const style = document.createElement('style');
    style.dataset.goGripDirnav = '';
    style.textContent = CSS;
    document.head.appendChild(style);

    const form = document.createElement('form');
    form.id = BAR_ID;
    form.className = where;

    const label = document.createElement('label');
    label.textContent = 'Path:';
    label.htmlFor = `${BAR_ID}-path`;

    const input = document.createElement('input');
    input.id = `${BAR_ID}-path`;
    input.value = relativePath();
    input.placeholder = '(top directory)';
    input.spellcheck = false;

    const go = document.createElement('a');
    go.textContent = 'Go';
    go.title = 'Go to this path';
    const syncGo = () => { go.href = urlFor(input.value); };
    syncGo();
    input.addEventListener('input', syncGo);

    const up = document.createElement('a');
    up.textContent = 'Up';
    up.title = 'Go to the parent directory';
    if (location.pathname !== '/') up.href = parentUrl();

    // Enter in the box submits the form; Go and Up are plain links.
    form.append(label, input, go, up);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      log('going to', go.href);
      location.assign(go.href);
    });

    document.body.prepend(form);
    log('bar added for', location.pathname);
  }

  // Rebuild the listing as directories (names ending in "/"), a blank
  // line, then files, keeping Go's order within each. Outside the top
  // directory, a ".." entry comes first.
  function regroupListing(pre) {
    if (pre.dataset.goGripDirnav) return;
    pre.dataset.goGripDirnav = 'regrouped';
    const links = [...pre.children];
    const dirs = links.filter((a) => a.getAttribute('href').endsWith('/'));
    const files = links.filter((a) => !a.getAttribute('href').endsWith('/'));
    if (location.pathname !== '/') {
      const up = document.createElement('a');
      up.href = '../';
      up.textContent = '..';
      dirs.unshift(up);
    }
    const lines = dirs.length && files.length ? [...dirs, null, ...files] : [...dirs, ...files];
    pre.replaceChildren(...lines.flatMap((a) => (a ? [a, '\n'] : ['\n'])));
    log('listing regrouped:', links.length - files.length, 'directories,', files.length, 'files');
  }

  log('init');
  if (isListing()) {
    regroupListing(document.body.firstElementChild);
    addBar('listing');
  } else if (isNotFound()) {
    addBar('listing');
  } else if (isMarkdownPage()) {
    addBar('markdown');
  } else {
    log('not a go-grip listing or markdown page');
  }
})();
