// Shared keyboard-shortcut helper for userscripts.
//
// NOT a userscript — no metadata block. Pull it in with:
//
//   // @require https://raw.githubusercontent.com/jshute96/userscripts/main/lib/keyboard-shortcuts.js
//
// The manager runs @require'd code in the userscript's own sandbox
// immediately before the script body, so the `KeyboardShortcuts`
// const below is visible to the body.
//
// What it does:
//   * Declarative key registration with labels.
//   * The guards every one of our key handlers had copy-pasted:
//     skip while typing, skip on unwanted modifiers, Caps-Lock-safe
//     letter matching.
//   * A `?` help overlay listing every shortcut registered on the
//     page — including ones registered by *other* userscripts.
//
// Cross-script sharing: each userscript is sandboxed, so this file
// runs once per script with its own private state. The shared piece
// is a DOM node (`#userscript-shortcuts`) that every instance writes
// its own metadata into, so any instance can render the full list.
// Only the metadata crosses the boundary — handlers stay in their
// own sandbox, which is all the help screen needs.

const KeyboardShortcuts = (function () {
  'use strict';

  const REGISTRY_ID = 'userscript-shortcuts';
  const HELP_ID = 'userscript-shortcuts-help';
  const HELP_KEY = '?';

  // ---------------------------------------------------------------
  // Key specs
  // ---------------------------------------------------------------
  // A spec is zero or more dash-separated modifiers followed by one
  // base key: 'j', 'shift-i', 'ctrl-alt-c', '?'.

  const MODIFIERS = {
    ctrl: 'ctrl', control: 'ctrl',
    alt: 'alt',
    meta: 'meta', cmd: 'meta',
    shift: 'shift',
  };

  const LETTER = /^[a-z]$/;

  function parseSpec(spec) {
    const parts = String(spec).split('-');
    // '-' splits to ['', ''] and 'shift--' to ['shift', '', ''], so
    // both the base and the modifier list can pick up an empty string.
    // The base falls back to '-'; empty modifiers are skipped below
    // rather than reported as unknown ones.
    const key = (parts.pop() || '-').toLowerCase();
    const b = { key, ctrl: false, alt: false, meta: false, shift: false };
    for (const raw of parts) {
      if (raw === '') continue;
      const mod = MODIFIERS[raw.toLowerCase()];
      if (!mod) throw new Error(`unknown modifier "${raw}" in key spec "${spec}"`);
      b[mod] = true;
    }
    return b;
  }

  function matches(b, e) {
    // Compare lowercased, so Caps Lock doesn't stop `j` from matching.
    if (e.key.toLowerCase() !== b.key) return false;
    if (e.ctrlKey !== b.ctrl) return false;
    if (e.altKey !== b.alt) return false;
    if (e.metaKey !== b.meta) return false;
    // Shift is only enforced for letters, where 'i' vs 'shift-i' is a
    // real distinction and we want the *modifier*, not the character
    // case, to decide (Caps Lock + i must not read as Shift-I).
    // Symbol keys like '?' are produced *by* shift on most layouts,
    // so enforcing shift:false there would make them unbindable.
    if (LETTER.test(b.key) && e.shiftKey !== b.shift) return false;
    return true;
  }

  function displaySpec(b) {
    const parts = [];
    if (b.ctrl) parts.push('Ctrl');
    if (b.alt) parts.push('Alt');
    if (b.meta) parts.push('Cmd');
    if (b.shift) parts.push('Shift');
    parts.push(LETTER.test(b.key) && b.shift ? b.key.toUpperCase() : b.key);
    return parts.join('-');
  }

  const HELP_BINDING = parseSpec(HELP_KEY);

  // ---------------------------------------------------------------
  // "Is the user typing?"
  // ---------------------------------------------------------------

  function isTypingElement(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return !!el.isContentEditable;
  }

  // composedPath() crosses shadow boundaries. Events originating
  // inside an open shadow root (WaPo's Coral drawer) retarget to the
  // host by the time a document listener sees them, so e.target alone
  // can't tell us the user is typing in a reply box. On a plain page
  // composedPath is just the normal ancestor chain, so this is always
  // the right check.
  function isTypingEvent(e) {
    const path = e.composedPath ? e.composedPath() : [e.target];
    return path.some(isTypingElement);
  }

  // ---------------------------------------------------------------
  // Cross-script registry (a DOM node, because sandboxes don't share
  // JS state but do share the document)
  // ---------------------------------------------------------------

  // Hung off <html> rather than <body>. Registration happens once, at
  // script load, and these scripts are @match'ed at the site root so
  // they stay resident across SPA navigation — if a site ever replaced
  // its <body>, the registry would go with it and `?` would come up
  // empty with no way to rebuild it (the other sandboxes have long
  // since finished registering). <html> is never swapped out.
  function registryHost() {
    let host = document.getElementById(REGISTRY_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = REGISTRY_ID;
      host.hidden = true;
      document.documentElement.appendChild(host);
    }
    return host;
  }

  // One <script type="application/json"> per userscript, keyed by
  // name so a re-run replaces its entry instead of duplicating it.
  // The type keeps it inert — never executed, so no CSP concern —
  // and out of layout.
  function publish(name, entries) {
    const host = registryHost();
    let node = host.querySelector(`script[data-userscript="${CSS.escape(name)}"]`);
    if (!node) {
      node = document.createElement('script');
      node.type = 'application/json';
      node.dataset.userscript = name;
      host.appendChild(node);
    }
    node.textContent = JSON.stringify(entries);
  }

  function readRegistry() {
    const host = document.getElementById(REGISTRY_ID);
    if (!host) return [];
    const groups = [];
    for (const node of host.querySelectorAll('script[data-userscript]')) {
      let entries;
      try {
        entries = JSON.parse(node.textContent);
      } catch (err) {
        console.log('[shortcuts] unreadable registry entry for',
          node.dataset.userscript, err.message);
        continue;
      }
      if (Array.isArray(entries) && entries.length) {
        groups.push({ script: node.dataset.userscript, entries });
      }
    }
    groups.sort((a, b) => a.script.localeCompare(b.script));
    return groups;
  }

  // ---------------------------------------------------------------
  // Help overlay
  // ---------------------------------------------------------------
  // Rendered into a shadow root so the host page's CSS can't reach
  // in and wreck it, and as a <dialog> so it lands in the browser's
  // top layer — immune to z-index and stacking-context fights with
  // the site — and gets Esc-to-close for free.

  const HELP_CSS = `
    :host { all: initial; }
    dialog {
      border: none;
      border-radius: 10px;
      padding: 22px 26px;
      max-width: 620px;
      max-height: 80vh;
      overflow-y: auto;
      background: #1e1f22;
      color: #e8e8ea;
      font: 14px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
      box-shadow: 0 8px 40px rgba(0, 0, 0, 0.5);
    }
    dialog::backdrop { background: rgba(0, 0, 0, 0.55); }
    /* showModal() focuses the dialog, and the UA draws its focus ring
       around the whole panel. Nothing here is keyboard-operable
       except Esc, so the ring is pure noise. */
    dialog:focus, dialog:focus-visible { outline: none; }
    h1 { font-size: 16px; margin: 0 0 14px; font-weight: 600; }
    h2 {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #9aa0a6;
      margin: 20px 0 8px;
    }
    dl {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 6px 14px;
      margin: 0;
    }
    dt { margin: 0; }
    dd { margin: 0; }
    kbd {
      display: inline-block;
      min-width: 1.1em;
      padding: 1px 7px;
      border: 1px solid #4a4d52;
      border-bottom-width: 2px;
      border-radius: 4px;
      background: #2b2d31;
      font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
      text-align: center;
    }
    .note { color: #9aa0a6; }
    .note::before { content: " — "; }
  `;

  function addRow(dl, keys, label, note) {
    const dt = document.createElement('dt');
    const kbd = document.createElement('kbd');
    kbd.textContent = keys;
    dt.appendChild(kbd);

    const dd = document.createElement('dd');
    dd.textContent = label;
    if (note) {
      const span = document.createElement('span');
      span.className = 'note';
      span.textContent = note;
      dd.appendChild(span);
    }
    dl.append(dt, dd);
  }

  // Returns true if it opened the overlay. Every script on the page
  // binds `?`, so all their handlers fire on the same keypress — the
  // ID check makes the first one win and the rest no-op. It doesn't
  // matter which wins: the renderer reads the shared DOM registry, so
  // it draws every script's bindings, not just its own.
  function showHelp() {
    if (document.getElementById(HELP_ID)) return false;
    const groups = readRegistry();
    if (!groups.length) {
      console.log('[shortcuts] ? pressed but no shortcuts are registered');
      return false;
    }

    const host = document.createElement('div');
    host.id = HELP_ID;
    const root = host.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = HELP_CSS;
    root.appendChild(style);

    const dlg = document.createElement('dialog');
    dlg.setAttribute('aria-label', 'Keyboard shortcuts from userscripts');

    const h1 = document.createElement('h1');
    h1.textContent = 'Keyboard shortcuts from userscripts';
    dlg.appendChild(h1);

    // `?` itself, as a plain row above the per-script groups. It
    // belongs to no single userscript, so putting it first lets it
    // stand without a heading.
    const own = document.createElement('dl');
    addRow(own, HELP_KEY, 'Show this list');
    dlg.appendChild(own);

    for (const group of groups) {
      const h2 = document.createElement('h2');
      h2.textContent = group.script;
      dlg.appendChild(h2);
      const dl = document.createElement('dl');
      for (const entry of group.entries) {
        addRow(dl, entry.keys, entry.label, entry.note);
      }
      dlg.appendChild(dl);
    }

    root.appendChild(dlg);
    (document.body || document.documentElement).appendChild(host);

    let closed = false;
    function closeHelp() {
      if (closed) return;
      closed = true;
      window.removeEventListener('keydown', onEscape, true);
      if (dlg.open) dlg.close();
      host.remove();
    }

    // Esc is handled explicitly rather than left to <dialog>'s built-in
    // close request. Leaving it to the browser failed in both
    // directions on real sites:
    //
    //   * NYTimes — the dialog closed, but the keydown went on
    //     propagating and NYT's own Escape handler closed the comments
    //     panel behind it. One keystroke dismissed the help *and* what
    //     the user was reading.
    //   * Washington Post — Coral suppresses the default close, so the
    //     overlay stayed up and only a click outside dismissed it.
    //
    // Listening on `window` in capture phase puts us at the very front
    // of the propagation path, ahead of any document-level handler the
    // site registered earlier, and stopImmediatePropagation keeps the
    // site from seeing a keystroke that was aimed at our overlay.
    function onEscape(e) {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      closeHelp();
    }
    window.addEventListener('keydown', onEscape, true);

    dlg.addEventListener('close', closeHelp);
    // Clicking the ::backdrop reports the dialog itself as the target.
    dlg.addEventListener('click', e => { if (e.target === dlg) closeHelp(); });
    dlg.showModal();

    const total = groups.reduce((n, g) => n + g.entries.length, 0);
    console.log('[shortcuts] help:', total, 'shortcuts from',
      groups.length, 'userscript(s)');
    return true;
  }

  function helpOpen() {
    return !!document.getElementById(HELP_ID);
  }

  // ---------------------------------------------------------------
  // Service
  // ---------------------------------------------------------------

  function scriptName(explicit, tag) {
    if (explicit) return explicit;
    // GM_info is populated even under `@grant none`. `typeof` rather
    // than a bare reference: an undefined global would throw a
    // ReferenceError and abort the whole userscript.
    if (typeof GM_info !== 'undefined' && GM_info && GM_info.script
        && GM_info.script.name) {
      return GM_info.script.name;
    }
    return tag;
  }

  // options:
  //   tag      log prefix, e.g. '[pb nav]'
  //   name     display name for the help screen; defaults to the
  //            userscript's own @name via GM_info
  //   capture  bind in capture phase and stopImmediatePropagation on
  //            handled keys, to beat a site's own bindings (Reddit)
  function create(options) {
    const opts = options || {};
    const tag = opts.tag || '[shortcuts]';
    const name = scriptName(opts.name, tag);
    const capture = !!opts.capture;

    const bindings = [];
    let unhandled = null;
    let attached = false;
    let flushQueued = false;

    function flush() {
      flushQueued = false;
      publish(name, bindings.map(b => {
        const entry = { keys: b.display, label: b.label };
        if (b.note) entry.note = b.note;
        return entry;
      }));
    }

    // Registration is usually a run of synchronous calls; batch them
    // into one registry write. Later registrations re-flush.
    function queueFlush() {
      if (flushQueued) return;
      flushQueued = true;
      queueMicrotask(flush);
    }

    function onKeyDown(e) {
      if (isTypingEvent(e)) return;
      // The modal owns the keyboard while it's up; Esc closes it.
      if (helpOpen()) return;

      if (matches(HELP_BINDING, e)) {
        if (showHelp()) e.preventDefault();
        return;
      }

      for (const b of bindings) {
        if (!matches(b, e)) continue;
        // A binding whose `when` is false isn't handled at all — it
        // falls through to onUnhandledKey like any unbound key.
        if (b.when && !b.when()) continue;
        e.preventDefault();
        if (capture) {
          e.stopPropagation();
          e.stopImmediatePropagation();
        }
        b.handler(e);
        return;
      }

      if (unhandled) unhandled(e);
    }

    function attach() {
      if (attached) return;
      attached = true;
      document.addEventListener('keydown', onKeyDown, capture);
    }

    const api = {
      // spec:    'j', 'shift-i', 'ctrl-c'
      // label:   user-facing description, shown on the help screen
      // handler: fn(event)
      // extra:   { when: () => bool, note: 'shown greyed on the help screen' }
      register(spec, label, handler, extra) {
        const b = parseSpec(spec);
        b.display = displaySpec(b);
        b.label = label;
        b.handler = handler;
        if (extra) {
          b.when = extra.when;
          b.note = extra.note;
        }
        bindings.push(b);
        attach();
        queueFlush();
        return api;
      },

      // Called for any keypress that passed the typing/modal guards
      // but matched no binding. Comment navigation uses it to drop a
      // remembered scroll target when the user moves the viewport
      // themselves (PageDown, arrows, space).
      onUnhandledKey(cb) {
        unhandled = cb;
        return api;
      },

      // One-line summary for the console, generated from the labels
      // so it can't drift out of sync with what's actually bound.
      logKeys() {
        const list = bindings.map(b => `${b.display}=${b.label}`).join(', ');
        console.log(tag, `keys: ${list}, ${HELP_KEY}=show all shortcuts`);
      },

      get name() { return name; },
      showHelp,
    };

    return api;
  }

  return { create, showHelp, readRegistry, isTypingEvent };
})();
