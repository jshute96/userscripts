// ==UserScript==
// @name         Medium: Keyboard comment navigation
// @namespace    https://github.com/jshute96/userscripts
// @version      1.0.9
// @description  Adds keyboard shortcuts for moving through the responses on a story — next and previous response, parent, next thread, and open or jump to the responses drawer.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://medium.com/*
// @match        https://*.medium.com/*
// @require      https://raw.githubusercontent.com/jshute96/userscripts/main/lib/keyboard-shortcuts.js
// @require      https://raw.githubusercontent.com/jshute96/userscripts/main/lib/keyboard-comment-nav.js
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[medium cnav]';

  if (window.__mediumCNavLoaded) {
    console.log(TAG, 'already loaded; skipping duplicate run');
    return;
  }
  window.__mediumCNavLoaded = true;

  console.log(TAG, 'initializing');

  // Medium's CSS classes are per-build atomic names (`aer`, `vs gx`)
  // that carry no meaning and rotate on every deploy, so nothing here
  // matches on class.
  const SEL = {
    // The "..." menu — exactly one per response, and the only use of
    // this label on the page. How responses are found at all.
    options: 'button[aria-label="Response options"]',
    // Speech-bubble button with the response count, in the story's
    // sticky top bar and footer bar. Opens the drawer.
    openDrawer: 'button[aria-label="responses"]',
    // Under the story's inline preview, and only when there are more
    // responses than it shows — hence a fallback, not the way in.
    seeAll: 'button',
    seeAllText: /^see all responses$/i,
  };

  // Distance from a card's "..." button up to the card:
  //
  //   button > div > div(menu anchor) > div(header row)
  //          > div(content) > div > div > CARD
  //
  // The card, not the content block, because replies nest inside it —
  // which is what makes `parentOf` a containment test. Nothing in that
  // chain is identifiable by class or attribute, so the depth is the
  // assumption; `cardsIn` checks it.
  const CARD_DEPTH = 7;

  function cardOf(optionsButton) {
    let el = optionsButton;
    for (let i = 0; i < CARD_DEPTH && el; i++) el = el.parentElement;
    return el;
  }

  // The open responses drawer, or null. The `[role="dialog"]` stays in
  // the DOM when closed, so presence proves nothing — the panel that's
  // showing is the child with `aria-hidden="false"`. Requiring cards
  // in it keeps us off any other dialog Medium opens.
  function drawer() {
    for (const dialog of document.querySelectorAll('[role="dialog"]')) {
      for (const panel of dialog.children) {
        if (panel.getAttribute('aria-hidden') === 'false'
            && panel.querySelector(SEL.options)) {
          return panel;
        }
      }
    }
    return null;
  }

  let warnedDepth = false;

  function cardsIn(panel) {
    const buttons = [...panel.querySelectorAll(SEL.options)];
    const cards = [];
    for (const button of buttons) {
      const card = cardOf(button);
      // Must be the card this button belongs to: its first "..." in
      // document order is ours (a card with replies holds theirs too,
      // but later). A wrapper change shows up here.
      if (!card || card.querySelector(SEL.options) !== button) {
        if (!warnedDepth) {
          warnedDepth = true;
          console.error(TAG, 'response card not', CARD_DEPTH,
                        'levels above its options button — Medium\'s',
                        'markup has changed; navigation will be wrong');
        }
        continue;
      }
      cards.push(card);
    }
    return cards;
  }

  // The drawer scrolls in its own container. Both the panel and one
  // descendant are `overflow-y: auto`; the inner one is what actually
  // scrolls, so take the deepest one. It has to hold *every* card, not
  // just one — otherwise a single response wrapping its own overflow
  // (Medium clamps wide code blocks) would win, and scrolling it would
  // silently do nothing.
  function findScroller(node, depth, cardCount) {
    if (!node || depth > 8) return null;
    for (const child of node.children) {
      const found = findScroller(child, depth + 1, cardCount);
      if (found) return found;
    }
    const oy = getComputedStyle(node).overflowY;
    return (oy === 'auto' || oy === 'scroll')
      && node.querySelectorAll(SEL.options).length === cardCount
      ? node : null;
  }

  // The response permalink's id. The author link on the same card
  // points at a profile with no id, so scan for the first href that
  // has one; a card holding replies holds theirs too, but later.
  function idOf(card) {
    for (const a of card.querySelectorAll('a[href*="source=responses"]')) {
      const match = /-([0-9a-f]{6,})$/.exec(new URL(a.href).pathname);
      if (match) return match[1];
    }
    return '?';
  }

  function openButton() {
    const bubble = document.querySelector(SEL.openDrawer);
    if (bubble) return bubble;
    return [...document.querySelectorAll(SEL.seeAll)]
      .find(b => SEL.seeAllText.test(b.textContent.trim())) || null;
  }

  // A signed-in reader gets a Slate response editor at the top of the
  // drawer, focused about a second after it opens. The shared shortcut
  // layer ignores every key while the caret is in an editable — `c`
  // included — so the drawer would open and then swallow everything,
  // with no way back from the keyboard. `releaseComposerFocus` moves
  // the caret somewhere harmless. The doc has the full story; these
  // numbers were measured against a signed-in account, where alone any
  // of this is reachable.
  const FOCUS_WATCH_MS = 10000;  // long, but user input stands it down
  const FOCUS_SETTLE_MS = 700;   // sooner and Medium just re-focuses
  const FOCUS_RETRY_MS = 400;
  const FOCUS_TRIES = 5;

  function isEditable(el) {
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
  }

  // Has the reader typed anything? Decides whether moving the caret
  // would discard work. Slate renders its placeholder as a real span
  // inside the editable, so plain `textContent` reads an untouched
  // composer as "What are your thoughts?" — drop it before reading.
  function isEmpty(el) {
    if (el.value !== undefined) return !el.value.trim();
    const copy = el.cloneNode(true);
    copy.querySelectorAll('[data-slate-placeholder]').forEach(n => n.remove());
    return !copy.textContent.trim();
  }

  // Where the caret goes instead of the composer. Not the dialog:
  // react-focus-lock treats focus on the locked container as escaped
  // and redirects it to the first tabbable — the composer we just
  // left. Not the close button or a link either: a later Space or
  // Enter would close the drawer or navigate. So use a target of our
  // own — inside the lock, focusable but not tabbable, and zero-sized
  // so it can't disturb the layout.
  const HOLDER_ATTR = 'data-medium-cnav-focus';

  // The keys this script binds — `c` and the nav set from
  // keyboard-comment-nav, plus `?` for the help overlay.
  const NAV_KEYS = new Set(['c', 'j', 'k', 'h', 'l', 'p', 'r', 'n', 'm', '?']);

  function focusHolder(dialog) {
    const panel = drawer() || dialog;
    let holder = panel.querySelector('[' + HOLDER_ATTR + ']');
    if (!holder) {
      holder = document.createElement('div');
      holder.setAttribute(HOLDER_ATTR, '');
      holder.tabIndex = -1;
      holder.style.cssText = 'position:absolute;width:0;height:0;outline:none;';
      panel.insertBefore(holder, panel.firstChild);
    }
    holder.focus({ preventScroll: true });
    return holder;
  }

  function releaseComposerFocus() {
    let finished = false;
    let tries = 0;
    let timer = null;

    const finish = () => {
      finished = true;
      clearTimeout(timer);
      document.removeEventListener('focusin', onFocusIn, true);
      document.removeEventListener('mousedown', finish, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };

    // Between Medium focusing the composer and us moving the caret off
    // it there's a window of about a second, and a key pressed in it
    // lands in the composer. That isn't just a swallowed keystroke: `j`
    // *types a "j"*, which leaves a draft — and the draft check then
    // refuses to touch the composer, so one fast keypress wedges the
    // keyboard permanently. Waiting less doesn't fix it; any window has
    // the same race.
    //
    // So don't race. This runs on `document` in the capture phase,
    // ahead of both Slate (a descendant) and the shortcut layer (which
    // listens on `document` while bubbling), and takes the keystroke
    // away from the composer before it can become text.
    const onKeyDown = (event) => {
      if (event.key === 'Tab') return finish();
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const active = document.activeElement;
      if (!active || !isEditable(active) || !active.closest) return;
      if (!active.closest('[role="dialog"]')) return;
      // Something is already written: the reader is composing, not
      // navigating. Their keys are their own from here.
      if (!isEmpty(active)) return finish();
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      // Anything we don't bind is the reader starting to type a
      // response — let it through and stop watching.
      if (!NAV_KEYS.has(key)) return finish();
      event.preventDefault();
      event.stopImmediatePropagation();
      const holder = focusHolder(active.closest('[role="dialog"]'));
      // Re-issue it now that the caret is somewhere harmless, so the
      // keystroke does what the reader meant rather than being lost.
      holder.dispatchEvent(new KeyboardEvent('keydown',
        { key: event.key, bubbles: true, cancelable: true }));
    };

    // Re-reads state each pass: in between, Medium may have moved the
    // caret back, the user may have started typing, or the drawer may
    // have gone.
    function attempt() {
      if (finished) return;
      const active = document.activeElement;
      if (!active || !isEditable(active)) {
        finish();
        console.log(TAG, 'moved focus off the response composer');
        return;
      }
      const dialog = active.closest && active.closest('[role="dialog"]');
      if (!dialog) {
        finish();
        console.warn(TAG, 'an editable outside the drawer has focus;',
                     'leaving it alone');
        return;
      }
      if (!isEmpty(active)) {
        finish();
        console.log(TAG, 'composer took focus with a draft in it; leaving it',
                    'alone — keys stay off until you click outside it');
        return;
      }
      if (tries >= FOCUS_TRIES) {
        finish();
        console.warn(TAG, 'focus keeps returning to the composer; keys will',
                     'be swallowed until you click outside it');
        return;
      }
      tries++;
      focusHolder(dialog);
      timer = setTimeout(attempt, FOCUS_RETRY_MS);
    }

    function onFocusIn(event) {
      const el = event.target;
      if (!el || !el.closest || !isEditable(el)) return;
      if (!el.closest('[role="dialog"]')) return;
      // One trigger is enough: from here the retry loop owns it, and
      // our own focus moves would otherwise re-enter this.
      document.removeEventListener('focusin', onFocusIn, true);
      timer = setTimeout(attempt, FOCUS_SETTLE_MS);
    }

    // Armed on a later task so the keypress that opened the drawer
    // isn't itself mistaken for the user acting.
    setTimeout(() => {
      if (finished) return;
      // Listening, not polling: the focus arrives whenever Medium's
      // editor bundle finishes loading, which we can't predict.
      document.addEventListener('focusin', onFocusIn, true);
      // A click, or a Tab, is the user placing the caret deliberately
      // — stand down rather than take it off them.
      document.addEventListener('mousedown', finish, true);
      document.addEventListener('keydown', onKeyDown, true);
      setTimeout(() => { if (!finished) finish(); }, FOCUS_WATCH_MS);
      // `focusin` fires only on a change, so cover focus already there.
      const active = document.activeElement;
      if (active && isEditable(active)) onFocusIn({ target: active });
    }, 0);
  }

  CommentNav.create({
    tag: TAG,

    // Everything but `c` waits for the drawer. `@match` is the whole
    // site because Medium is a single-page app; the gate is re-read
    // per keypress, so no URL listener is needed.
    enabled: () => !!drawer(),

    comments: () => {
      const panel = drawer();
      return panel ? cardsIn(panel) : [];
    },

    // Intersection is tested against the prose, not the card: a card
    // wraps its reply subtree, so it keeps intersecting long after the
    // reader has scrolled into the replies and `j` would stick on the
    // root. The card's own `<pre>` comes before its replies'.
    body: card => card.querySelector('pre') || card,

    id: idOf,

    // Replies nest inside their parent's card, so the parent is the
    // nearest enclosing card at any depth — threads run at least three
    // levels once replies are expanded. There's no selector to hand
    // `closest`, and a containment scan per lookup would be quadratic,
    // so build the map in one pass: the list is in document order, so
    // a stack of open ancestors gives each card its parent.
    parentOf: CommentNav.parentMapper(all => {
      const map = new Map();
      const open = [];
      for (const card of all) {
        while (open.length && !open[open.length - 1].contains(card)) open.pop();
        map.set(card, open.length ? open[open.length - 1] : null);
        open.push(card);
      }
      return map;
    }),

    container: () => {
      const panel = drawer();
      if (!panel) return null;
      return findScroller(panel, 0, panel.querySelectorAll(SEL.options).length);
    },
    strategy: 'container',

    // No `headerOffset`: nothing in the drawer is sticky.

    // Null while closed, or `c` would scroll to a hidden panel instead
    // of opening it. Open, it goes to the first response rather than
    // the heading, so the `j` after it advances to the second.
    commentsTop: () => {
      const panel = drawer();
      if (!panel) return null;
      return cardsIn(panel)[0] || panel;
    },

    open: {
      canOpen: () => !!openButton(),
      // Re-resolved: Medium re-renders the action bars as you scroll.
      click: () => {
        const button = openButton();
        if (!button) {
          console.error(TAG, 'responses button vanished before it was clicked');
          return;
        }
        button.click();
        releaseComposerFocus();
      },
    },
  });
})();
