// ==UserScript==
// @name         Google APIs Explorer: Save, copy, and fullscreen response buttons
// @namespace    https://github.com/jshute96/userscripts
// @version      0.1.0
// @description  Break out of the tiny "Try this method" response pane by expanding JSON results to fill the tab, or copying and downloading them with one click.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://developers.google.com/*
// @match        https://explorer.apis.google.com/*
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
  const ACTIONS_CLASS = 'jshute-apix-response-actions';

  const log = (...args) => console.log(TAG, ...args);

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
        top: 0 !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
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
      div.devsite-apix.${FULLTAB_CLASS} > .devsite-apix-controls {
        display: none !important;
      }
      div.devsite-apix.${FULLTAB_CLASS} .apis-explorer,
      div.devsite-apix.${FULLTAB_CLASS} .apis-explorer iframe,
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
      }
      if (!want) {
        for (const el of document.querySelectorAll(`.${FULLTAB_CLASS}`)) {
          el.classList.remove(FULLTAB_CLASS);
        }
      }
      document.documentElement.classList.toggle(FULLTAB_CLASS, want);
      document.documentElement.dataset.jshuteApixFullscreen = String(want);
      log(want ? 'host container expanded to full tab' : 'host container restored');
    }

    window.addEventListener('message', (event) => {
      if (event.origin !== 'https://explorer.apis.google.com') return;
      const data = event.data;
      if (!data || data.type !== MSG_TYPE || data.ack) return;
      setHostFullscreen(data.fullscreen, event.source);
      requestAnimationFrame(() => {
        try {
          event.source?.postMessage(
            { type: MSG_TYPE, fullscreen: Boolean(data.fullscreen), ack: true },
            'https://explorer.apis.google.com'
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
                'https://explorer.apis.google.com'
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
        border: 1px solid rgba(32, 33, 36, 0.35);
        border-radius: 4px;
        background: rgba(255, 255, 255, 0.28);
        color: #202124;
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
        background: rgba(255, 255, 255, 0.48);
        border-color: rgba(32, 33, 36, 0.55);
      }
      .jshute-apix-btn:active {
        background: rgba(0, 0, 0, 0.12);
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
      body.${FULLTAB_CLASS} api-response .single-tab-response,
      body.${FULLTAB_CLASS} api-response .multi-tab-response {
        position: fixed !important;
        inset: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        max-width: none !important;
        max-height: none !important;
        margin: 0 !important;
        border: 0 !important;
        border-radius: 0 !important;
        z-index: 9999 !important;
        background: var(--apix-background-1, #fff) !important;
        box-sizing: border-box !important;
      }
      body.dark-theme.${FULLTAB_CLASS} api-response .single-tab-response,
      body.dark-theme.${FULLTAB_CLASS} api-response .multi-tab-response {
        background: var(--apix-background-1, #202124) !important;
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
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: MSG_TYPE, fullscreen: isFullscreen }, '*');
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
        (btn) => {
          const text = getResponseText(statusBar);
          if (!text) {
            log('save clicked, but response text was empty');
            return;
          }
          const filename = getSuggestedFilename();
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
          lastSavedFilename = filename;
          log(`saved response (${text.length} chars) as ${filename}`);
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

    // While in full-tab mode, clicking the 'X' (.close) button in the top-right
    // corner exits full-tab mode back to the normal view instead of clearing
    // the response.
    document.addEventListener(
      'click',
      (e) => {
        if (!isFullscreen) return;
        const closeBtn = e.target.closest && e.target.closest('api-response .close');
        if (closeBtn) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation();
          setFullscreen(false);
        }
      },
      true
    );

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
      const data = event.data;
      if (!data || data.type !== MSG_TYPE) return;
      if (data.ack) {
        refreshCodeMirror();
      } else if (typeof data.fullscreen === 'boolean') {
        setFullscreen(data.fullscreen);
      }
    });

    const observer = new MutationObserver(() => scan());
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
