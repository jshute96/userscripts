// ==UserScript==
// @name         Chrome: Better JSON viewer
// @namespace    https://github.com/jshute96/userscripts
// @version      0.1.1
// @description  Replace Chrome's JSON viewer with one that pretty-prints by default, and has syntax highlighting.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @icon         https://www.google.com/chrome/static/images/favicons/favicon-96x96.png
// @include      /^(https?|file):\/\/[^?#]*\.json([?#].*)?$/
// @inject-into  content
// @noframes
// ==/UserScript==

// Chrome's viewer puts the raw JSON in the page's only <pre>, and its
// Pretty-print checkbox in a closed shadow root on
// div.json-formatter-container, which scripts can't reach. So we hide that
// container, toolbar and all, and add a bar of our own whose checkbox swaps
// the <pre> text between the original and our formatting.

(function () {
  'use strict';

  const log = (...args) => console.log('[json-viewer]', ...args);

  // The @include limits us to .json URLs (any case, optionally with a
  // query or fragment). Of those, act on JSON documents and on files
  // served as plain text (as raw.githubusercontent.com does), which
  // Chrome both shows as a lone <pre>, but not on an HTML page.
  const isJson = /^application\/([\w.+-]+\+)?json$/.test(document.contentType);
  if (!isJson && document.contentType !== 'text/plain') return;

  const pre = document.querySelector('body > pre');
  if (!pre) {
    log('JSON document, but no <pre> holding it; skipping');
    return;
  }
  if (document.querySelector('[data-json-viewer-bar]')) return;
  log('init');

  const original = pre.textContent;
  let pretty = null;
  let parseError = null;
  try {
    // Keep each number's source text: as doubles, large IDs would lose
    // digits, and 1.0 or 1e3 would be rewritten.
    const value = JSON.parse(original, (key, v, context) =>
      typeof v === 'number' ? JSON.rawJSON(context.source) : v);
    pretty = JSON.stringify(value, null, 2);
  } catch (e) {
    parseError = e.message;
  }
  const unchanged = pretty !== null && pretty === original.trim();

  // Syntax highlighting: wrap each token in a span, leaving the text (and
  // so textContent) unchanged. A plain tokenizer rather than the parse
  // tree, so it also works on JSON that failed to parse, like JSON with
  // comments. Very large files are left plain, to keep the page fast.
  const HIGHLIGHT_MAX_CHARS = 3_000_000;
  const TOKEN = new RegExp([
    /("(?:[^"\\\n]|\\.)*")(\s*:)?/,                   // 1: string, 2: colon after a key
    /(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/,             // 3: number
    /\b(true|false|null)\b/,                          // 4: literal
    /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)/,                  // 5: comment
  ].map((re) => re.source).join('|'), 'g');

  function highlight(text) {
    const fragment = document.createDocumentFragment();
    const span = (className, s) => {
      const el = document.createElement('span');
      el.className = className;
      el.textContent = s;
      fragment.append(el);
    };
    let last = 0;
    for (const m of text.matchAll(TOKEN)) {
      if (m.index > last) fragment.append(text.slice(last, m.index));
      if (m[1] !== undefined) {
        span(m[2] ? 'jv-key' : 'jv-string', m[1]);
        if (m[2]) fragment.append(m[2]);
      } else if (m[3] !== undefined) {
        span('jv-number', m[3]);
      } else if (m[4] !== undefined) {
        span('jv-literal', m[4]);
      } else {
        span('jv-comment', m[5]);
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) fragment.append(text.slice(last));
    return fragment;
  }

  function show(text) {
    if (text.length > HIGHLIGHT_MAX_CHARS) pre.textContent = text;
    else pre.replaceChildren(highlight(text));
  }

  // Chrome's own formatted view escapes < and > as \u003C and \u003E, so we
  // replace its toolbar rather than sit beside it. The <pre> gets 20px of
  // padding in the viewer to clear that toolbar; ours is in the flow.
  const style = document.createElement('style');
  style.dataset.jsonViewerBar = '';
  style.textContent = `
    .json-formatter-container { display: none !important; }
    body { margin: 0 !important; }
    body > pre { padding-top: 0 !important; }
    .json-viewer-bar {
      position: sticky; top: 0; z-index: 1;
      display: flex; align-items: center; gap: 4px;
      padding: 2px 6px;
      font: 13px monospace;
      background: #dbe8fb; color: #1a1a1a;
      border-bottom: 1px solid #9db8e0;
    }
    .json-viewer-bar label { display: flex; align-items: center; gap: 4px; cursor: pointer; }
    .json-viewer-bar.disabled label { color: #888; cursor: default; }
    .json-viewer-bar .note { color: #666; margin-left: 8px; }
    .json-viewer-bar .note.error { color: #b3261e; }
    .jv-key { color: #0451a5; }
    .jv-string { color: #a31515; }
    .jv-number { color: #098658; }
    .jv-literal { color: #0000ff; }
    .jv-comment { color: #008000; }
    @media (prefers-color-scheme: dark) {
      .json-viewer-bar { background: #1f3350; color: #e8e8e8; border-color: #3d5a85; }
      .json-viewer-bar.disabled label { color: #8a8f98; }
      .json-viewer-bar .note { color: #a0a6b0; }
      .json-viewer-bar .note.error { color: #f2b8b5; }
      .jv-key { color: #9cdcfe; }
      .jv-string { color: #ce9178; }
      .jv-number { color: #b5cea8; }
      .jv-literal { color: #569cd6; }
      .jv-comment { color: #6a9955; }
    }
  `;
  document.head.append(style);

  const bar = document.createElement('div');
  bar.className = 'json-viewer-bar';
  bar.dataset.jsonViewerBar = '';
  bar.title = `Added by the "${GM_info.script.name}" userscript`;
  const label = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  label.append('Pretty-print', box);
  bar.append(label);
  document.body.prepend(bar);

  const addNote = (text, className = '') => {
    const note = document.createElement('span');
    note.className = `note ${className}`;
    note.textContent = text;
    bar.append(note);
    return note;
  };

  if (parseError !== null) {
    bar.classList.add('disabled');
    box.disabled = true;
    addNote('Parsing failed', 'error').title = parseError;
    show(original);
    log('not valid JSON, leaving it as is:', parseError);
    return;
  }

  box.checked = true;
  if (unchanged) {
    bar.classList.add('disabled');
    box.disabled = true;
    addNote('Already formatted');
    show(original);
    log('already pretty-printed');
    return;
  }

  box.addEventListener('change', () => {
    show(box.checked ? pretty : original);
    log(box.checked ? 'showing pretty-printed' : 'showing original');
  });
  show(pretty);
  log('pretty-printed', original.length, 'chars');
})();
