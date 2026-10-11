// ==UserScript==
// @name         GitHub: View HTML files inline
// @namespace    https://github.com/jshute96/userscripts
// @version      1.0.0
// @description  Adds a Preview view to .html files, next to Code and Blame, just like Markdown files have. The HTML is sandboxed and doesn't run scripts.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://github.com/*
// @noframes
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const log = (...args) => console.log('[html preview]', ...args);
  const TAB_ID = 'gh-html-preview-tab';
  const PANE_ID = 'gh-html-preview-pane';

  // A sandbox with no allow-scripts, so the file's scripts and forms are
  // off. With no scripts, only a real click can follow a link, which the
  // popup and top-navigation permissions let through: into the GitHub tab,
  // or a new tab when the link asks for one. allow-same-origin (safe
  // without scripts) lets us size the frame to its content and handle its
  // #links, and sends cookies with its image requests, which private repos
  // need. The frame also inherits github.com's CSP, which blocks scripts
  // and most third-party loads on its own.
  const SANDBOX = 'allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation';

  // CSS-module class names come in two forms depending on GitHub's build
  // (Module__name__hash and Module_hash_name), so match the parts.
  const SECTION = 'section[class*="BlobContent-module"][class*="blobContentSection"]';

  // The file's page (/blob/) or its Blame view (/blame/), which share the
  // Preview / Code / Blame switch.
  const isHtmlFile = () => /^\/[^/]+\/[^/]+\/(?:blob|blame)\/.+\.html?$/i.test(location.pathname);
  const isBlame = () => /^\/[^/]+\/[^/]+\/blame\//.test(location.pathname);
  const blobPath = () => location.pathname.replace(/^(\/[^/]+\/[^/]+)\/blame\//, '$1/blob/');

  // The file as GitHub shows it: the code view keeps the whole text in a
  // hidden textarea. Very large files have none; fetch Raw for those.
  async function getSource(raw) {
    const ta = document.querySelector('#read-only-cursor-text-area');
    if (ta && ta.value) return ta.value;
    const r = await fetch(raw.href);
    if (!r.ok) throw new Error(`Raw fetch: HTTP ${r.status}`);
    return r.text();
  }

  const MAX_STYLESHEETS = 20;
  const XLINK = 'http://www.w3.org/1999/xlink';
  const SAFE_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

  // Point relative url()s in an inlined stylesheet at its own directory,
  // which they're relative to, not the page's.
  function rebaseCss(css, cssUrl) {
    // No whitespace in the URL part: overlapping with the \s* around it, it
    // made matching take cubic time on a crafted stylesheet.
    return css.replace(/url\(\s*(['"]?)([^'")\s]*)\1\s*\)/g, (whole, quote, url) => {
      if (!url || /^(?:[a-z][a-z0-9+.-]*:|#)/i.test(url)) return whole;
      try {
        return `url("${new URL(url, cssUrl).href}")`;
      } catch {
        return whole;
      }
    });
  }

  // Rewrite the file so it works away from its repo directory, and so it
  // can do nothing but show itself and follow clicked links:
  // - Scripts, http-equiv metas (refresh, CSP) and the file's own <base>
  //   are dropped, and declarative shadow roots stay inert templates.
  //   Scripts couldn't run anyway; this doesn't lean on that alone.
  // - Relative URLs resolve against the raw file's directory, so images
  //   load.
  // - The repo's own stylesheets are inlined, since github.com's CSP allows
  //   only inline styles.
  // - Relative links resolve against the file's GitHub page, so they open
  //   GitHub's view of the file they name, in the whole tab (the frame
  //   can't load github.com pages), or a new one when they ask for it.
  //   Links other than http(s), mailto and #links are disabled.
  async function prepare(source, rawHref) {
    const rawDir = new URL('.', rawHref).href;
    const pageDir = new URL('.', location.origin + blobPath()).href;
    const doc = new DOMParser().parseFromString(source, 'text/html');
    for (const el of doc.querySelectorAll('script, meta[http-equiv], base')) el.remove();
    for (const t of doc.querySelectorAll('template[shadowrootmode], template[shadowroot]')) {
      t.removeAttribute('shadowrootmode');
      t.removeAttribute('shadowroot');
    }
    const base = doc.createElement('base');
    base.href = rawDir;
    doc.head.prepend(base);

    // One at a time, and only so many: each is a request with the user's
    // cookies, made just by viewing the file.
    const repoRaw = new URL(rawHref).origin + rawHref.match(/^https:\/\/[^/]+(\/[^/]+\/[^/]+\/raw\/)/)?.[1];
    const links = [...doc.querySelectorAll('link[rel~="stylesheet"][href]')];
    for (const link of links.slice(0, MAX_STYLESHEETS)) {
      let url;
      try {
        url = new URL(link.getAttribute('href'), rawDir).href;
      } catch {
        continue;
      }
      if (!url.startsWith(repoRaw)) continue; // other sites' styles stay blocked
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const style = doc.createElement('style');
        style.textContent = rebaseCss(await r.text(), url);
        link.replaceWith(style);
      } catch (e) {
        log(`couldn't inline ${url}:`, e.message);
      }
    }
    if (links.length > MAX_STYLESHEETS) log(`inlined only the first ${MAX_STYLESHEETS} of ${links.length} stylesheets`);

    // HTML <a> and <area>, and SVG <a> (whose href may be xlink:href, and
    // whose href/target properties are read-only, hence setAttribute).
    for (const a of doc.querySelectorAll('a, area')) {
      const href = a.getAttribute('href') ?? a.getAttributeNS(XLINK, 'href');
      if (href === null) continue;
      a.removeAttributeNS(XLINK, 'href');
      a.removeAttribute('ping'); // a POST with the user's cookies on click
      if (href.startsWith('#')) {
        a.setAttribute('href', href);
        a.removeAttribute('target');
        continue;
      }
      let url = null;
      try {
        url = new URL(href, pageDir);
      } catch {}
      if (!url || !SAFE_SCHEMES.has(url.protocol)) {
        a.removeAttribute('href');
        continue;
      }
      a.setAttribute('href', url.href);
      a.setAttribute('target', a.getAttribute('target') === '_blank' ? '_blank' : '_top');
      a.setAttribute('rel', 'noopener');
    }
    const doctype = doc.doctype ? '<!DOCTYPE html>\n' : '';
    return doctype + doc.documentElement.outerHTML;
  }

  function makeFrame(html) {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', SANDBOX);
    // Sized to its content, so it never needs to scroll; this also stops
    // it being left scrolled part-way down.
    frame.setAttribute('scrolling', 'no');
    frame.srcdoc = html;
    return frame;
  }

  const MAX_HEIGHT = 50000;
  const MAX_GROWS = 30; // in GROW_WINDOW_MS, before we stop resizing
  const GROW_WINDOW_MS = 2000;

  // Size the frame to its content, and make in-page #links scroll the
  // GitHub page, since the frame itself never scrolls.
  function fitFrame(frame) {
    frame.addEventListener('load', () => {
      const doc = frame.contentDocument;
      if (!doc) return;
      // Content sized by the viewport (min-height: 100vh plus a margin)
      // grows each time the frame does. Stop when growth keeps feeding
      // itself, and never go past MAX_HEIGHT.
      // grows: [time, height before] for each recent growth.
      let grows = [];
      const observer = new ResizeObserver(() => fit());
      const fit = () => {
        const root = doc.documentElement;
        const height = Math.min(MAX_HEIGHT, Math.max(root.scrollHeight, Math.ceil(root.getBoundingClientRect().height)));
        if (height > frame.offsetHeight) {
          const now = performance.now();
          grows = grows.filter(([t]) => now - t < GROW_WINDOW_MS);
          grows.push([now, frame.offsetHeight]);
          if (grows.length > MAX_GROWS) {
            // Back to the height before the runaway started.
            observer.disconnect();
            frame.style.height = `${grows[0][1]}px`;
            log('stopped resizing: the page grows with the frame (viewport-sized content)');
            return;
          }
        }
        frame.style.height = `${height}px`;
        doc.scrollingElement.scrollTop = 0;
      };
      fit();
      observer.observe(doc.documentElement);
      doc.addEventListener('click', (e) => {
        const a = e.target.closest && e.target.closest('a[href^="#"]');
        if (!a) return;
        e.preventDefault();
        const raw = a.getAttribute('href').slice(1);
        let id = raw;
        try {
          id = decodeURIComponent(raw);
        } catch {}
        const target = doc.getElementById(id) || doc.getElementsByName(id)[0];
        if (!target) return;
        const top = frame.getBoundingClientRect().top + target.getBoundingClientRect().top;
        window.scrollBy({ top: top - 80, behavior: 'smooth' });
      });
    });
  }

  let shownFor = null; // path the preview pane was built for
  let previewOn = false;
  let defaultedFor = null; // path we last turned the preview on by default
  let wantPreview = false; // Preview was clicked on the Blame view

  // In some GitHub builds the file header (Preview / Code / Blame, Raw)
  // is position: absolute inside a sticky container of no height, and the
  // code section leaves room for it. With the section hidden, the pane
  // has to leave that room itself.
  function clearHeader(pane) {
    const sticky = document.querySelector('.react-blob-view-header-sticky');
    if (!sticky) return;
    const header = Math.max(0, ...[...sticky.children].map((c) => c.offsetHeight));
    const overlap = Math.max(0, header - sticky.offsetHeight);
    pane.style.marginTop = overlap ? `${overlap}px` : '';
  }

  async function showPreview() {
    const section = document.querySelector(SECTION);
    if (!section) return;
    let pane = document.getElementById(PANE_ID);
    if (pane) clearHeader(pane);
    const path = location.pathname;
    if (pane && shownFor === path) return;
    // Wait (for a later scan) until the Raw link is for this file: during
    // in-page navigation the header can still be the previous file's.
    const raw = document.querySelector('[data-testid="raw-button"]');
    const rest = blobPath().split('/blob/')[1].split('/').slice(1).join('/');
    if (!raw || !new URL(raw.href).pathname.endsWith(`/${rest}`)) return;
    if (pane) pane.remove();
    pane = document.createElement('div');
    pane.id = PANE_ID;
    section.after(pane);
    clearHeader(pane);
    shownFor = path;
    try {
      const html = await prepare(await getSource(raw), raw.href);
      // Navigated away, or the pane was replaced, while we waited.
      if (location.pathname !== path || !pane.isConnected) return;
      const frame = makeFrame(html);
      fitFrame(frame);
      pane.append(frame);
      log('preview shown for', path);
    } catch (e) {
      pane.textContent = `Couldn't preview this file: ${e.message}`;
      log('preview failed:', e);
    }
  }

  function setPreview(on) {
    previewOn = on;
    previewStyle.media = on ? 'all' : 'not all';
    syncTabs();
    if (on) showPreview();
  }

  // Our Preview button is the first item of GitHub's Code/Blame control.
  // We only change our own item: while previewing, CSS (below) makes
  // GitHub's selected item look unselected. Changing React's attributes
  // instead goes wrong when React reuses the items on another file.
  function syncTabs() {
    const tab = document.getElementById(TAB_ID);
    if (!tab) return;
    tab.toggleAttribute('data-selected', previewOn);
    tab.querySelector('button').setAttribute('aria-pressed', String(previewOn));
  }

  function addTab(control) {
    const model = control.querySelector('li:not([data-selected])') || control.querySelector('li');
    const tab = model.cloneNode(true);
    tab.id = TAB_ID;
    tab.removeAttribute('data-selected');
    const text = tab.querySelector('[data-text]');
    text.dataset.text = 'Preview';
    text.textContent = 'Preview';
    control.prepend(tab);
  }

  document.addEventListener('click', (e) => {
    if (!isHtmlFile() || !e.target.closest) return;
    const li = e.target.closest('ul[aria-label="File view"] > li');
    if (!li) return;
    // For Code, GitHub's handler sees no change (it was selected all
    // along), so turning the preview off is all that happens.
    if (li.id === TAB_ID && isBlame()) {
      // Go to the file's page through GitHub's own Code item, then turn
      // the preview on there.
      wantPreview = true;
      li.parentElement.querySelector('[data-text="Code"]')?.closest('button')?.click();
    } else if (li.id === TAB_ID) setPreview(true);
    else if (previewOn) setPreview(false);
  }, true);

  function scan() {
    if (!isHtmlFile()) {
      // GitHub keeps the header across in-page navigation, so take our
      // additions out.
      if (previewOn) setPreview(false);
      for (const id of [TAB_ID, PANE_ID]) document.getElementById(id)?.remove();
      shownFor = null;
      defaultedFor = null;
      return;
    }
    const control = document.querySelector('ul[aria-label="File view"]');
    if (control && !document.getElementById(TAB_ID)) {
      addTab(control);
      log('added Preview tab');
    }
    if (isBlame()) {
      if (previewOn) setPreview(false);
      document.getElementById(PANE_ID)?.remove();
      shownFor = null;
      // Code from here should show the code, not default to the preview.
      defaultedFor = blobPath();
      return;
    }
    if (control && wantPreview) {
      wantPreview = false;
      defaultedFor = location.pathname;
      setPreview(true);
    } else if (control && defaultedFor !== location.pathname) {
      defaultedFor = location.pathname;
      setPreview(true);
    } else if (previewOn) {
      syncTabs();
      showPreview();
    }
  }

  const style = document.createElement('style');
  style.textContent = `
    #${PANE_ID} { display: none; padding: 16px; }
    #${PANE_ID} iframe { display: block; width: 100%; border: 0; min-height: 200px; background: #fff; }
  `;
  // The rules for while previewing, switched with its media attribute
  // (not its disabled flag, which does nothing before the element is in
  // the document). Not an attribute on <html>: GitHub's React drops those
  // when it takes over the server-rendered page, which put a reloaded page
  // back on Code.
  const previewStyle = document.createElement('style');
  previewStyle.textContent = `
    ${SECTION} { display: none; }
    #${PANE_ID} { display: block; }
    /* GitHub's selected item, drawn as unselected (Primer's small
       SegmentedControl). The white knob follows anchor-name. */
    ul[aria-label="File view"] > li[data-selected]:not(#${TAB_ID}) { margin-right: -1px !important; }
    ul[aria-label="File view"] > li[data-selected]:not(#${TAB_ID}) button {
      font-weight: 400 !important; padding: 4px !important; outline-offset: 0 !important;
    }
    ul[aria-label="File view"] > li[data-selected]:not(#${TAB_ID}) .segmentedControl-content {
      anchor-name: none !important; font-weight: 400 !important; padding-inline: 8px !important;
    }
    ul[aria-label="File view"] > li[data-selected]:not(#${TAB_ID}) [data-text] { font-weight: 400 !important; }
  `;
  previewStyle.media = 'not all'; // off until previewing
  // On <html>, where they survive GitHub replacing <head> or <body>.
  document.documentElement.append(style, previewStyle);

  let pending = false;
  new MutationObserver(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; scan(); });
  }).observe(document.documentElement, { childList: true, subtree: true });

  log('init');
  scan();
})();
