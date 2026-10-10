// ==UserScript==
// @name         Google APIs Explorer: Save / copy / fullscreen buttons for JSON response
// @namespace    https://github.com/jshute96/userscripts
// @version      0.1.1
// @description  The API explorer shows a huge JSON response in a tiny box. This makes it easier to see or get the content.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://developers.google.com/*
// @match        https://explorer.apis.google.com/embedded.html*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

// No @noframes: the "Try this method" APIs Explorer UI runs inside an
// https://explorer.apis.google.com/embedded.html iframe embedded on
// https://developers.google.com/* reference pages.

(function () {
  'use strict';

  const TAG = '[apix-response]';
  const MSG_TYPE = 'jshute-apix-fullscreen';
  const FULLTAB_CLASS = 'jshute-apix-fulltab';
  const STYLE_ATTR = 'data-jshute-apix-response-styles';
  const ANCESTOR_CLASS = 'jshute-apix-fulltab-ancestor';
  const ACTIONS_CLASS = 'jshute-apix-response-actions';

  const SAVE_MSG = 'jshute-apix-save';
  const HOST_ORIGIN = 'https://developers.google.com';
  const EXPLORER_ORIGIN = 'https://explorer.apis.google.com';

  const log = (...args) => console.log(TAG, ...args);

  // Shows a save dialog and writes the text. Resolves to 'saved',
  // 'cancelled', or 'failed' (no picker API, or it threw).
  async function saveWithPicker(text, filename) {
    if (typeof window.showSaveFilePicker !== 'function') {
      log('showSaveFilePicker is not available');
      return 'failed';
    }
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      log(`saved response (${text.length} chars) as ${handle.name}`);
      return 'saved';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
      log('save dialog failed:', e);
      return 'failed';
    }
  }

  // Plain download with the suggested name, no dialog. Fallback for
  // browsers without showSaveFilePicker.
  function downloadText(text, filename) {
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    log(`downloaded response (${text.length} chars) as ${filename}`);
  }

  function ensureStyles(cssText) {
    if (document.querySelector(`style[${STYLE_ATTR}]`)) return;
    const style = document.createElement('style');
    style.setAttribute(STYLE_ATTR, '');
    style.textContent = cssText;
    (document.head || document.documentElement).appendChild(style);
  }

  // ---------------------------------------------------------------------------
  // Parent documentation page (developers.google.com)
  // ---------------------------------------------------------------------------
  function initHostPage() {
    if (window !== window.top) return;
    log('init (host page)');

    ensureStyles(`
      html.${FULLTAB_CLASS},
      html.${FULLTAB_CLASS} body {
        overflow: hidden !important;
      }
      div.devsite-apix.${FULLTAB_CLASS},
      .apis-explorer.${FULLTAB_CLASS} {
        position: fixed !important;
        inset: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        max-width: none !important;
        max-height: none !important;
        transform: none !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        border-radius: 0 !important;
        overflow: hidden !important;
        z-index: 100000 !important;
      }
      .${ANCESTOR_CLASS} {
        z-index: 100000 !important;
      }
      div.devsite-apix.${FULLTAB_CLASS} > .devsite-apix-controls {
        display: none !important;
      }
      div.devsite-apix.${FULLTAB_CLASS} .apis-explorer,
      div.devsite-apix.${FULLTAB_CLASS} iframe,
      .apis-explorer.${FULLTAB_CLASS} iframe {
        width: 100vw !important;
        height: 100vh !important;
        max-width: none !important;
        max-height: none !important;
      }
    `);

    function findApixContainer(sourceWindow) {
      for (const iframe of document.querySelectorAll(
        'div.devsite-apix iframe, devsite-apix iframe, .apis-explorer iframe'
      )) {
        if (iframe.contentWindow === sourceWindow) {
          return iframe.closest('div.devsite-apix') || iframe.closest('.apis-explorer');
        }
      }
      return (
        document.querySelector('div.devsite-apix') ||
        document.querySelector('devsite-apix .apis-explorer, .apis-explorer')
      );
    }

    function setHostFullscreen(fullscreen, sourceWindow) {
      const want = Boolean(fullscreen);
      const container = findApixContainer(sourceWindow);
      if (container) {
        container.classList.toggle(FULLTAB_CLASS, want);
        // The container can sit inside a positioned wrapper with its own
        // z-index (e.g. the devsite-concierge side panel, z-index 1006),
        // which caps it below the site header. Raise those wrappers too.
        if (want) {
          for (let el = container.parentElement; el && el !== document.body; el = el.parentElement) {
            if (getComputedStyle(el).zIndex !== 'auto') el.classList.add(ANCESTOR_CLASS);
          }
        }
      }
      if (!want) {
        for (const el of document.querySelectorAll(`.${FULLTAB_CLASS}, .${ANCESTOR_CLASS}`)) {
          el.classList.remove(FULLTAB_CLASS, ANCESTOR_CLASS);
        }
      }
      document.documentElement.classList.toggle(FULLTAB_CLASS, want);
      document.documentElement.dataset.jshuteApixFullscreen = String(want);
      log(want ? 'host container expanded to full tab' : 'host container restored');
    }

    window.addEventListener('message', async (event) => {
      if (event.origin !== EXPLORER_ORIGIN) return;
      const data = event.data;
      if (data?.type === SAVE_MSG && typeof data.text === 'string') {
        // The explorer frame can't open a file picker itself (cross-origin
        // subframes aren't allowed), so it hands the text to us. The click's
        // user activation also applies to ancestor frames.
        event.source?.postMessage(
          { type: SAVE_MSG, id: data.id, status: 'received' },
          EXPLORER_ORIGIN
        );
        const status = await saveWithPicker(data.text, data.filename);
        event.source?.postMessage(
          { type: SAVE_MSG, id: data.id, status },
          EXPLORER_ORIGIN
        );
        return;
      }
      if (!data || data.type !== MSG_TYPE || data.ack) return;
      setHostFullscreen(data.fullscreen, event.source);
      requestAnimationFrame(() => {
        try {
          event.source?.postMessage(
            { type: MSG_TYPE, fullscreen: Boolean(data.fullscreen), ack: true },
            EXPLORER_ORIGIN
          );
        } catch {
          // Ignore if frame navigated away.
        }
      });
    });

    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape' && document.documentElement.classList.contains(FULLTAB_CLASS)) {
          e.preventDefault();
          e.stopPropagation();
          setHostFullscreen(false, null);
          for (const iframe of document.querySelectorAll(
            'div.devsite-apix iframe, devsite-apix iframe, .apis-explorer iframe'
          )) {
            try {
              iframe.contentWindow?.postMessage(
                { type: MSG_TYPE, fullscreen: false },
                EXPLORER_ORIGIN
              );
            } catch {
              // Ignore cross-origin postMessage errors if any.
            }
          }
        }
      },
      true
    );
  }

  // ---------------------------------------------------------------------------
  // Embedded APIs Explorer iframe (explorer.apis.google.com)
  // ---------------------------------------------------------------------------
  function initExplorerFrame() {
    log('init (explorer frame)');

    ensureStyles(`
      api-response .status-bar {
        display: flex !important;
        align-items: center !important;
        gap: 6px;
        box-sizing: content-box;
      }
      api-response .status-bar .response-code {
        margin-right: auto;
      }
      api-response .status-bar .close {
        float: none !important;
        display: inline-flex;
        align-items: center;
        margin-left: 2px;
      }
      .${ACTIONS_CLASS} {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        margin-left: auto;
      }
      .jshute-apix-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: 22px;
        padding: 0 8px;
        /* Tints of the status bar's own text color, so the buttons work in
           both light and dark themes. */
        border: 1px solid color-mix(in srgb, currentColor 35%, transparent);
        border-radius: 4px;
        background: color-mix(in srgb, currentColor 4%, transparent);
        color: inherit;
        font-family: Roboto, Arial, sans-serif;
        font-size: 12px;
        font-weight: 500;
        line-height: 1;
        text-transform: none !important;
        cursor: pointer;
        user-select: none;
        box-sizing: border-box;
        white-space: nowrap;
      }
      .jshute-apix-btn:hover {
        background: color-mix(in srgb, currentColor 12%, transparent);
        border-color: color-mix(in srgb, currentColor 55%, transparent);
      }
      .jshute-apix-btn:active {
        background: color-mix(in srgb, currentColor 20%, transparent);
      }
      .jshute-apix-btn .material-icons {
        font-size: 15px;
        width: 15px;
        height: 15px;
        line-height: 15px;
      }
      body.${FULLTAB_CLASS} {
        overflow: hidden !important;
      }
      body:not(.${FULLTAB_CLASS}) api-response .single-tab-response .jshute-apix-btn {
        padding: 0 4px;
      }
      body:not(.${FULLTAB_CLASS}) api-response .single-tab-response .jshute-apix-btn-label {
        display: none;
      }
      body.${FULLTAB_CLASS} api-response .single-tab-response,
      body.${FULLTAB_CLASS} api-response .multi-tab-response {
        position: fixed !important;
        inset: 8px !important;
        width: auto !important;
        height: auto !important;
        max-width: none !important;
        max-height: none !important;
        margin: 0 !important;
        z-index: 9999 !important;
        box-sizing: border-box !important;
        display: flex !important;
        flex-direction: column !important;
        /* Covers the rest of the explorer, around the 8px margin. */
        box-shadow: 0 0 0 100vmax var(--apix-background-1, #fff) !important;
      }
      body.dark-theme.${FULLTAB_CLASS} api-response .single-tab-response,
      body.dark-theme.${FULLTAB_CLASS} api-response .multi-tab-response {
        box-shadow: 0 0 0 100vmax var(--apix-background-1, #202124) !important;
      }
      body.${FULLTAB_CLASS} api-response .single-tab-response > code-viewer {
        flex: 1 1 auto !important;
        min-height: 0 !important;
      }
      body.${FULLTAB_CLASS} api-response .single-tab-response > code-viewer .CodeMirror {
        height: 100% !important;
      }
      body.${FULLTAB_CLASS} api-response .multi-tab-response .mat-mdc-tab-body-wrapper {
        flex: 1 1 auto !important;
        height: calc(100% - 49px) !important;
      }
      body.${FULLTAB_CLASS} api-response .multi-tab-response #response-raw .CodeMirror {
        height: 100% !important;
      }
    `);

    let isFullscreen = false;
    let lastCopiedText = null;
    let lastSavedFilename = null;
    let saveInProgress = false;

    function refreshCodeMirror() {
      for (const cmEl of document.querySelectorAll('api-response .CodeMirror')) {
        if (cmEl.CodeMirror && typeof cmEl.CodeMirror.refresh === 'function') {
          cmEl.CodeMirror.refresh();
        }
      }
      window.dispatchEvent(new Event('resize'));
    }

    function updateFullscreenButtons() {
      for (const btn of document.querySelectorAll('.jshute-apix-btn[data-action="fullscreen"]')) {
        const icon = btn.querySelector('.material-icons');
        const label = btn.querySelector('.jshute-apix-btn-label');
        if (icon) icon.textContent = isFullscreen ? 'fullscreen_exit' : 'fullscreen';
        if (label) label.textContent = isFullscreen ? 'Exit fullscreen' : 'Fullscreen';
        btn.title = isFullscreen
          ? 'Return to normal API Explorer view (Esc)'
          : 'Expand JSON response to full tab';
        btn.setAttribute('aria-pressed', String(isFullscreen));
      }
    }

    function setFullscreen(next) {
      const want = Boolean(next);
      if (isFullscreen === want && document.body.classList.contains(FULLTAB_CLASS) === want) {
        return;
      }
      isFullscreen = want;
      document.body.classList.toggle(FULLTAB_CLASS, isFullscreen);
      document.documentElement.dataset.jshuteApixFullscreen = String(isFullscreen);
      updateFullscreenButtons();
      if (location.ancestorOrigins?.[0] === HOST_ORIGIN) {
        window.parent.postMessage({ type: MSG_TYPE, fullscreen: isFullscreen }, HOST_ORIGIN);
      }
      refreshCodeMirror();
      requestAnimationFrame(() => refreshCodeMirror());
      setTimeout(refreshCodeMirror, 60);
      log(isFullscreen ? 'expanded response to full tab' : 'restored response from full tab');
    }

    function getResponseText(statusBar) {
      const container = statusBar?.parentElement || document.querySelector('api-response');
      const codeViewer =
        container?.querySelector('code-viewer#response-body, code-viewer') ||
        document.querySelector('api-response code-viewer#response-body, api-response code-viewer');
      const textarea = codeViewer?.querySelector('textarea#code-viewer-response-body, textarea');
      if (textarea && typeof textarea.value === 'string' && textarea.value.length > 0) {
        return textarea.value;
      }
      const cmEl = codeViewer?.querySelector('.CodeMirror');
      if (cmEl?.CodeMirror && typeof cmEl.CodeMirror.getValue === 'function') {
        const val = cmEl.CodeMirror.getValue();
        if (val) return val;
      }
      const lines = codeViewer?.querySelectorAll('.CodeMirror-code .CodeMirror-line');
      if (lines && lines.length > 0) {
        return [...lines].map((l) => l.textContent).join('\n');
      }
      return '';
    }

    // Asks the host page to show the save dialog, since this cross-origin
    // frame can't. Resolves to the host's status ('saved', 'cancelled',
    // 'failed'). The host acks with 'received' first; without that ack
    // (the host half isn't running), resolves 'failed' after a second.
    let nextSaveId = 1;
    function saveViaHost(text, filename) {
      const id = nextSaveId++;
      return new Promise((resolve) => {
        function finish(status) {
          clearTimeout(ackTimer);
          window.removeEventListener('message', onMessage);
          resolve(status);
        }
        function onMessage(event) {
          if (event.origin !== HOST_ORIGIN) return;
          if (event.data?.type !== SAVE_MSG || event.data.id !== id) return;
          if (event.data.status === 'received') clearTimeout(ackTimer);
          else finish(event.data.status);
        }
        const ackTimer = setTimeout(() => {
          log('host page did not answer the save request');
          finish('failed');
        }, 1000);
        window.addEventListener('message', onMessage);
        window.parent.postMessage({ type: SAVE_MSG, id, text, filename }, HOST_ORIGIN);
      });
    }

    function getSuggestedFilename() {
      const params = new URLSearchParams(location.search);
      const methodId = (params.get('methodId') || '').replace(/[^a-zA-Z0-9._-]+/g, '_');
      return `${methodId || 'api-response'}.json`;
    }

    async function copyTextToClipboard(text) {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch {
          // Fall back to execCommand below.
        }
      }
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } finally {
        ta.remove();
      }
      return ok;
    }

    function flashButtonFeedback(btn, iconName, message) {
      const icon = btn.querySelector('.material-icons');
      const label = btn.querySelector('.jshute-apix-btn-label');
      const origIcon = icon ? icon.textContent : '';
      const origLabel = label ? label.textContent : '';
      if (btn._flashTimer) clearTimeout(btn._flashTimer);
      if (icon) icon.textContent = iconName;
      if (label) label.textContent = message;
      btn._flashTimer = setTimeout(() => {
        if (icon) icon.textContent = origIcon;
        if (label) label.textContent = origLabel;
        btn._flashTimer = null;
      }, 1500);
    }

    function makeButton(action, iconName, text, title, onClick) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'jshute-apix-btn';
      btn.dataset.action = action;
      btn.title = title;

      const icon = document.createElement('span');
      icon.className = 'material-icons notranslate';
      icon.setAttribute('aria-hidden', 'true');
      icon.textContent = iconName;

      const label = document.createElement('span');
      label.className = 'jshute-apix-btn-label';
      label.textContent = text;

      btn.append(icon, label);
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick(btn);
      });
      return btn;
    }

    function enhanceStatusBar(statusBar) {
      if (statusBar.querySelector(`.${ACTIONS_CLASS}`)) return;

      const actions = document.createElement('div');
      actions.className = ACTIONS_CLASS;

      const saveBtn = makeButton(
        'save',
        'download',
        'Save',
        'Save JSON response to disk',
        async (btn) => {
          if (saveInProgress) return;
          const text = getResponseText(statusBar);
          if (!text) {
            log('save clicked, but response text was empty');
            return;
          }
          const filename = getSuggestedFilename();
          saveInProgress = true;
          let status;
          try {
            status =
              location.ancestorOrigins?.[0] === HOST_ORIGIN
                ? await saveViaHost(text, filename)
                : await saveWithPicker(text, filename);
          } finally {
            saveInProgress = false;
          }
          if (status === 'cancelled') return;
          if (status !== 'saved') downloadText(text, filename);
          lastSavedFilename = filename;
          flashButtonFeedback(btn, 'check', 'Saved');
        }
      );

      const copyBtn = makeButton(
        'copy',
        'content_copy',
        'Copy',
        'Copy JSON response to clipboard',
        async (btn) => {
          const text = getResponseText(statusBar);
          if (!text) {
            log('copy clicked, but response text was empty');
            return;
          }
          const ok = await copyTextToClipboard(text);
          if (ok) {
            lastCopiedText = text;
            log(`copied response to clipboard (${text.length} chars)`);
            flashButtonFeedback(btn, 'check', 'Copied');
          } else {
            log('failed to copy response to clipboard');
          }
        }
      );

      const fullscreenBtn = makeButton(
        'fullscreen',
        isFullscreen ? 'fullscreen_exit' : 'fullscreen',
        isFullscreen ? 'Exit fullscreen' : 'Fullscreen',
        'Expand JSON response to full tab',
        () => {
          setFullscreen(!isFullscreen);
        }
      );

      actions.append(saveBtn, copyBtn, fullscreenBtn);

      const closeEl = statusBar.querySelector('.close');
      if (closeEl) {
        statusBar.insertBefore(actions, closeEl);
      } else {
        statusBar.appendChild(actions);
      }
      updateFullscreenButtons();
      log('added Save, Copy, Fullscreen buttons to response status bar');
    }

    let warnedMissingStatusBar = false;

    function scan() {
      const bars = document.querySelectorAll('api-response .status-bar');
      for (const bar of bars) {
        enhanceStatusBar(bar);
      }
      if (
        bars.length === 0 &&
        !warnedMissingStatusBar &&
        document.querySelector('api-response code-viewer#response-body')
      ) {
        warnedMissingStatusBar = true;
        log('found code-viewer#response-body without .status-bar — status bar selector may have changed');
      }
      if (
        isFullscreen &&
        !document.querySelector('api-response .single-tab-response, api-response .multi-tab-response')
      ) {
        setFullscreen(false);
      }
    }

    document.addEventListener(
      'keydown',
      (e) => {
        if (isFullscreen && e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setFullscreen(false);
        }
      },
      true
    );

    window.addEventListener('message', (event) => {
      if (event.origin !== HOST_ORIGIN) return;
      const data = event.data;
      if (!data || data.type !== MSG_TYPE) return;
      if (data.ack) {
        refreshCodeMirror();
      } else if (typeof data.fullscreen === 'boolean') {
        setFullscreen(data.fullscreen);
      }
    });

    let scanQueued = false;
    const observer = new MutationObserver(() => {
      if (scanQueued) return;
      scanQueued = true;
      requestAnimationFrame(() => {
        scanQueued = false;
        scan();
      });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    scan();

    setTimeout(() => {
      if (!document.querySelector('.explorer-container, api-method')) {
        log('still waiting for .explorer-container / api-method after 10000 ms');
      }
    }, 10000);

    window.__apixResponseControls = {
      get isFullscreen() {
        return isFullscreen;
      },
      get lastCopiedText() {
        return lastCopiedText;
      },
      get lastSavedFilename() {
        return lastSavedFilename;
      },
      setFullscreen,
      getResponseText,
    };
  }

  if (location.hostname === 'developers.google.com') {
    initHostPage();
  } else if (location.hostname === 'explorer.apis.google.com') {
    initExplorerFrame();
  }
})();
