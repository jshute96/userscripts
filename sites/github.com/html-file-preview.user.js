// ==UserScript==
// @name         GitHub: View HTML files inline
// @namespace    https://github.com/jshute96/userscripts
// @version      2.0.1
// @description  Adds a Preview view to .html files, next to Code and Blame, just like Markdown files have. The HTML is sandboxed and doesn't run scripts.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://github.com/*
// @noframes
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const log = (...args) => console.log('[html preview]', ...args);
  const TAB_ID = 'gh-html-preview-tab';
  const PANE_ID = 'gh-html-preview-pane';

  // The frame's sandbox. Left out, and so off: scripts, forms, dialogs,
  // downloads, and allow-same-origin (the frame gets an origin of its
  // own, so even a sandbox bug couldn't reach the GitHub page or the
  // user's cookies; its requests go without them, so private repos'
  // images don't load). With no scripts, only a real click can follow a
  // link. Allowed:
  // - allow-popups: links can open a new tab (middle-click, or a link
  //   with target="_blank").
  // - allow-popups-to-escape-sandbox: that tab is a normal page, not
  //   sandboxed like this frame, so other sites work there. Our links
  //   are http(s) or mailto only, with rel="noopener".
  // - allow-top-navigation-by-user-activation: a clicked link can load in
  //   the GitHub tab, as on any page. The frame can't show github.com
  //   pages itself.
  // The frame also inherits github.com's CSP, which blocks scripts and
  // most third-party loads on its own.
  const SANDBOX = 'allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation';

  // CSS-module class names vary with GitHub's build (Module__name__hash,
  // Module_hash_name, name__hash), so match just the name.
  const SECTION = 'section[class*="blobContentSection"]';

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
  //   GitHub's view of the file they name. Links open in the whole tab,
  //   as on any page (the frame can't load github.com pages itself), or
  //   a new one when they ask for it or are middle-clicked.
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
        // A </style> in the text would end our tag when the page is written
        // out, and what follows would be markup our rewrite never saw. In
        // CSS, \/ is just /.
        style.textContent = rebaseCss(await r.text(), url).replace(/<\/(style)/gi, '<\\/$1');
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
        // Against our <base>, #x would load the raw file; this stays in
        // the frame's own document.
        a.setAttribute('href', `about:srcdoc${href}`);
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

  // Empty until we set its srcdoc. The sandbox is set first, so it
  // applies to everything the frame loads.
  function makeFrame() {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', SANDBOX);
    return frame;
  }

  let shownFor = null; // path the preview pane was built for
  let paneEl = null; // that pane, which React may detach when it redraws

  function dropPane() {
    paneEl?.remove();
    paneEl = null;
    shownFor = null;
  }
  let previewOn = false;
  let defaultedFor = null; // path we last turned the preview on by default
  let wantPreview = false; // Preview was clicked on the Blame view
  let autoPreview = false; // the preview is on by default, not by a click

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

  // Why the file would show nothing, or null if it shows something: no
  // text, images or controls in its body, once scripts, styles and
  // templates are left out. (A <canvas> stays blank with no script to
  // draw it.)
  function blankReason(source) {
    const doc = new DOMParser().parseFromString(source, 'text/html');
    const hasScripts = !!doc.querySelector('script');
    const body = doc.body;
    for (const el of body.querySelectorAll('script, style, template')) el.remove();
    if (body.textContent.trim()
      || body.querySelector('img, svg, picture, video, audio, iframe, object, embed, input, button, select, textarea, hr')) return null;
    return hasScripts ? 'No visible content to preview without running scripts.' : 'No visible content to preview.';
  }

  // GitHub's Raw link, once it's for the current file: during in-page
  // navigation the header can still be the previous file's.
  function currentRaw() {
    const raw = document.querySelector('[data-testid="raw-button"]');
    const rest = blobPath().split('/blob/')[1].split('/').slice(1).join('/');
    return raw && new URL(raw.href).pathname.endsWith(`/${rest}`) ? raw : null;
  }

  async function showPreview() {
    const section = document.querySelector(SECTION);
    if (!section) return;
    const path = location.pathname;
    let pane = paneEl;
    if (pane && shownFor === path) {
      // React redrawing the file area takes our pane out with it. Put the
      // same one back, rather than building it again.
      if (pane.previousElementSibling !== section) section.after(pane);
      clearHeader(pane);
      return;
    }
    const raw = currentRaw();
    if (!raw) return; // a later scan tries again
    dropPane();
    pane = paneEl = document.createElement('div');
    pane.id = PANE_ID;
    section.after(pane);
    clearHeader(pane);
    shownFor = path;
    // The frame goes in now, at its full height, so the box doesn't start
    // short and grow once the page is ready.
    const frame = makeFrame();
    pane.append(frame);
    fillWindow();
    try {
      // While the page is still loading, the file's textarea may be only
      // partly parsed.
      if (document.readyState === 'loading') {
        await new Promise((resolve) => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
      }
      const source = await getSource(raw);
      const blank = blankReason(source);
      if (blank && autoPreview) {
        // Turned on by default, for a file that shows nothing (usually
        // all script): show the code instead.
        log('nothing to show, showing the code');
        dropPane();
        setPreview(false);
        return;
      }
      if (blank) {
        frame.remove();
        const note = document.createElement('p');
        note.className = 'gh-html-preview-note';
        note.textContent = blank;
        pane.append(note);
        log('nothing to show for', path);
        return;
      }
      const html = await prepare(source, raw.href);
      // Navigated away, or the pane was replaced, while we waited.
      if (location.pathname !== path || paneEl !== pane) return;
      frame.srcdoc = html;
      log('preview shown for', path);
    } catch (e) {
      frame.remove();
      pane.textContent = `Couldn't preview this file: ${e.message}`;
      log('preview failed:', e);
    }
  }

  // auto: turned on by default, not by the user.
  function setPreview(on, auto = false) {
    previewOn = on;
    autoPreview = on && auto;
    previewStyle.media = on ? 'all' : 'not all';
    syncTabs();
    if (on) showPreview();
    fillWindow();
  }

  const MIN_FRAME = 400;
  const MARGIN = 8; // between the file's box and the window's bottom

  // While previewing, the frame fills the window below its top, and the
  // GitHub page itself doesn't scroll (the frame does). If that would
  // leave it under MIN_FRAME, it gets MIN_FRAME and the page scrolls as
  // usual. Below the frame are the pane's padding and the bottom of
  // GitHub's box around the file, which we keep in view.
  function fillWindow() {
    const frame = previewOn && document.querySelector(`#${PANE_ID} iframe`);
    if (!frame) {
      fitStyle.media = 'not all';
      return;
    }
    const rect = frame.getBoundingClientRect();
    const box = frame.closest(`#${PANE_ID}`).parentElement.getBoundingClientRect();
    const below = box.bottom - rect.bottom + MARGIN;
    const room = Math.floor(window.innerHeight - (rect.top + window.scrollY) - below);
    const fits = room >= MIN_FRAME;
    const height = `${fits ? room : MIN_FRAME}px`;
    if (frame.style.height !== height) frame.style.height = height;
    fitStyle.media = fits ? 'all' : 'not all';
    if (fits && window.scrollY) window.scrollTo(0, 0);
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
      document.getElementById(TAB_ID)?.remove();
      dropPane();
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
      dropPane();
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
      setPreview(true, true);
    } else if (previewOn) {
      syncTabs();
      showPreview();
    }
  }

  const style = document.createElement('style');
  style.textContent = `
    #${PANE_ID} { display: none; padding: 16px; }
    #${PANE_ID} .gh-html-preview-note { margin: 0; font-style: italic; color: var(--fgColor-muted, #59636e); }
    #${PANE_ID} iframe { display: block; width: 100%; height: 80vh; border: 0; background: #fff; }
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
  // While the frame fills the window (see fillWindow).
  const fitStyle = document.createElement('style');
  fitStyle.textContent = 'html { overflow: hidden !important; }';
  fitStyle.media = 'not all';
  // On <html>, where they survive GitHub replacing <head> or <body>.
  document.documentElement.append(style, previewStyle, fitStyle);

  let pending = false;
  new MutationObserver(() => {
    // Previewing with no pane in the page (not built yet, or React took it
    // out), and it can go in now: do it before the page is drawn without
    // it. Otherwise wait for the frame below, so this doesn't run on every
    // change.
    if (previewOn && !paneEl?.isConnected && document.querySelector(SECTION)
      && ((paneEl && shownFor === location.pathname) || currentRaw())) {
      scan();
      fillWindow();
    }
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; scan(); fillWindow(); });
  }).observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener('resize', fillWindow);
  document.addEventListener('DOMContentLoaded', () => { scan(); fillWindow(); });

  log('init');
  // We start before GitHub draws the page, so an .html file's code is
  // hidden from the start rather than shown and then swapped out.
  if (isHtmlFile() && !isBlame()) {
    defaultedFor = location.pathname;
    setPreview(true, true);
  }
  scan();
})();
