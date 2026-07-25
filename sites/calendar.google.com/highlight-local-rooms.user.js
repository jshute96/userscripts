// ==UserScript==
// @name         calendar.google.com: highlight local rooms
// @namespace    https://github.com/jshute96/userscripts
// @version      1.7.1
// @description  Highlight meeting locations matching a configurable regex, to make it easy to find the local room in a long room list. Where room lists are shown as comma-separated text blobs, reformat them one per line.
// @author       Jeff Shute <jshute@gmail.com>
// @match        https://calendar.google.com/calendar/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[room highlight]';
  const STORAGE_KEY = 'highlight-local-rooms:room-regex';
  const PROMPTED_KEY = 'highlight-local-rooms:first-run-prompted';
  const DEFAULT_REGEX_STRING = 'BUILDING[12]';
  const SENTINEL = Symbol('unset');

  const HIGHLIGHT_CLASS = 'jshute-local-room-highlight';
  const ROOM_LINE_ATTR = 'data-jshute-room-line';
  const STYLE_ATTR = 'data-jshute-local-room-styles';

  const DIALOG_ID = 'xDetDlg';
  const LOC_ID = 'xDetDlgLoc';

  // Text we must never match against or highlight. `span.XuJrye` is Calendar's
  // visually-hidden accessibility label; inside the location row it reads
  // "Location:". Matching a container's textContent therefore matched the word
  // "Lo(ca)tion" for a regex as short as /CA/i, highlighting every event that
  // had any location at all. `[aria-hidden="true"]` covers the icon wrappers.
  const IGNORED_TEXT_SELECTOR = 'span.XuJrye, [aria-hidden="true"]';

  // Room resource rows: the previously used `span.iGpjxc` has already rotated
  // away, so it is only a legacy candidate. Absence of rooms is the normal case
  // for most events, so a miss here is not an error.
  const ROOM_BLOCK_CANDIDATES = [
    { name: 'legacy iGpjxc class', find: (d) => d.querySelectorAll(`span.iGpjxc:not(#${LOC_ID} span)`) },
  ];

  console.log(TAG, 'init');

  // --- Configuration ---------------------------------------------------

  function readRegexString() {
    const val = GM_getValue(STORAGE_KEY, undefined);
    return val === undefined ? SENTINEL : val;
  }

  function getRoomRegex() {
    const val = readRegexString();
    const pattern = val === SENTINEL ? DEFAULT_REGEX_STRING : val;
    try {
      return new RegExp(pattern, 'i');
    } catch (e) {
      console.error(TAG, 'invalid regex in storage:', val, e);
      return new RegExp(DEFAULT_REGEX_STRING, 'i');
    }
  }

  let targetRoomRegex = getRoomRegex();

  function promptForRegex() {
    const currentVal = readRegexString();
    let initial = currentVal === SENTINEL ? DEFAULT_REGEX_STRING : currentVal;

    while (true) {
      const entered = window.prompt(
        'Google Calendar room highlight — set local rooms regex\n' +
        'Regular expression matching your local rooms (case-insensitive,\n' +
        'matched anywhere in the text — anchor it if you need a whole word).',
        initial,
      );

      if (entered === null) {
        console.log(TAG, 'set regex cancelled');
        return;
      }

      const trimmed = entered.trim();
      if (!trimmed) {
        console.log(TAG, 'rejected empty regex');
        window.alert('Regex pattern cannot be empty. Please enter a valid pattern.');
        initial = entered;
        continue;
      }

      try {
        new RegExp(trimmed, 'i');
      } catch (e) {
        console.log(TAG, 'rejected invalid regex:', JSON.stringify(trimmed), e);
        window.alert(`Invalid regular expression:\n${e.message}\n\nPlease check your syntax and try again.`);
        initial = entered;
        continue;
      }

      GM_setValue(STORAGE_KEY, trimmed);
      targetRoomRegex = getRoomRegex();
      console.log(TAG, 'local room regex set to', JSON.stringify(trimmed));
      reprocessOpenDialog('regex changed');
      return;
    }
  }

  GM_registerMenuCommand('Set local room regex', promptForRegex);

  function reprocessOpenDialog(reason) {
    const dialog = document.getElementById(DIALOG_ID);
    if (!dialog || !isVisible(dialog)) return;
    console.log(TAG, `re-evaluating open card (${reason})`);
    resetLocationFormatting(dialog);
    processDialog(dialog);
  }

  // --- Styles ----------------------------------------------------------

  // An explicit text colour is required: Calendar's dark theme renders text
  // near-white, which is unreadable on the pale yellow background.
  if (!document.head.querySelector(`style[${STYLE_ATTR}]`)) {
    const style = document.createElement('style');
    style.setAttribute(STYLE_ATTR, '');
    style.textContent = `
      .${HIGHLIGHT_CLASS} {
        background-color: #fff9c4 !important;
        color: #202124 !important;
        display: inline-block !important;
        padding: 1px 5px !important;
        border-radius: 3px !important;
      }
      .${HIGHLIGHT_CLASS}:hover {
        background-color: #fff59d !important;
      }
    `;
    document.head.appendChild(style);
  }

  // --- Helpers ---------------------------------------------------------

  // Split on commas, ignoring commas inside square brackets — room entries
  // carry bracketed detail lists, e.g. "[Video Conf, Not Wheelchair Accessible]".
  function splitOuterCommas(str) {
    const result = [];
    let current = '';
    let inBrackets = 0;

    for (const char of str) {
      if (char === '[') {
        inBrackets++;
      } else if (char === ']') {
        inBrackets = Math.max(0, inBrackets - 1);
      }

      if (char === ',' && inBrackets === 0) {
        if (current.trim()) result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    if (current.trim()) result.push(current.trim());
    return result;
  }

  // A multi-room resource blob, as opposed to a street address: room entries
  // carry a capacity marker such as "(16)".
  function looksLikeRoomList(str) {
    return /\(\d+\)/.test(str) && str.includes(',');
  }

  function isVisible(el) {
    // offsetParent is null for position:fixed elements, which the popover is,
    // so measure instead.
    return el.getBoundingClientRect().height > 0;
  }

  // The leaf elements actually holding visible text, skipping hidden a11y
  // labels and icon wrappers. Matching these rather than a container's
  // textContent is what keeps hidden label text out of the regex.
  function visibleTextLeaves(root) {
    const out = [];
    for (const el of root.querySelectorAll('*')) {
      if (el.childElementCount !== 0) continue;
      if (!el.textContent.trim()) continue;
      if (el.closest(IGNORED_TEXT_SELECTOR)) continue;
      out.push(el);
    }
    return out;
  }

  // --- Highlight bookkeeping -------------------------------------------

  // Elements we affirmatively decided to highlight on the current pass.
  // Anything else carrying our class gets swept, which self-heals highlights
  // stranded by Wiz recycling a node or by a selector that stopped matching.
  let keepHighlighted = new Set();

  function setHighlight(el, on, label) {
    if (on) keepHighlighted.add(el);
    const has = el.classList.contains(HIGHLIGHT_CLASS);
    if (on === has) return;
    el.classList.toggle(HIGHLIGHT_CLASS, on);
    console.log(TAG, `${on ? 'highlighted' : 'unhighlighted'} ${label}:`, JSON.stringify(el.textContent.trim()));
  }

  function sweepStaleHighlights(dialog) {
    for (const el of dialog.querySelectorAll(`.${HIGHLIGHT_CLASS}`)) {
      if (keepHighlighted.has(el)) continue;
      el.classList.remove(HIGHLIGHT_CLASS);
      console.log(TAG, 'cleared stale highlight:', JSON.stringify(el.textContent.trim().slice(0, 80)));
    }
  }

  // --- Feature 1: room resource rows -----------------------------------

  let roomSourceLogged = null;

  function findRoomTextBlocks(dialog) {
    for (const candidate of ROOM_BLOCK_CANDIDATES) {
      const found = Array.from(candidate.find(dialog))
        .filter((el) => !el.closest(IGNORED_TEXT_SELECTOR));
      if (found.length === 0) continue;
      if (roomSourceLogged !== candidate.name) {
        roomSourceLogged = candidate.name;
        console.log(TAG, `room resource blocks located via: ${candidate.name}`);
      }
      return found;
    }
    return [];
  }

  function highlightRoomResources(dialog) {
    // Most events have no room resources at all, so finding none is normal and
    // is not reported as a failure. The location field is handled separately.
    for (const textBlock of findRoomTextBlocks(dialog)) {
      const text = textBlock.textContent || '';
      setHighlight(textBlock, targetRoomRegex.test(text), 'room');
    }
  }

  // --- Feature 2: text location field ----------------------------------

  // The location row has no anchor: the whole `div.nBzcnc` row carries
  // role="button" and opens Maps, so injected child lines stay clickable.
  // The visible address lives in a pure-text leaf inside `#xDetDlgLoc`,
  // alongside the hidden "Location:" label we must skip.
  function getLocationTextEl(dialog) {
    const locEl = dialog.querySelector(`#${LOC_ID}`);
    if (!locEl) return null;

    const existing = locEl.querySelector(`[${ROOM_LINE_ATTR}]`);
    if (existing) return existing.parentElement;

    const leaves = visibleTextLeaves(locEl);
    return leaves.length > 0 ? leaves[0] : null;
  }

  function resetLocationFormatting(dialog) {
    const targetEl = getLocationTextEl(dialog);
    if (!targetEl) return;
    if (targetEl.querySelectorAll(`[${ROOM_LINE_ATTR}]`).length === 0) return;

    const raw = targetEl.dataset.jshuteRawLocation || '';
    targetEl.replaceChildren();
    if (raw) targetEl.appendChild(document.createTextNode(raw));
    delete targetEl.dataset.jshuteRawLocation;
    console.log(TAG, 'reset location formatting');
  }

  function formatTextLocations(dialog) {
    const targetEl = getLocationTextEl(dialog);
    if (!targetEl) return;

    // Detect "already formatted" from the DOM, not from a stored flag: Wiz's
    // async detail load overwrites the element's text content, which destroys
    // our injected children but *keeps* attributes. Only child presence tells
    // us the truth.
    const existingLines = targetEl.querySelectorAll(`[${ROOM_LINE_ATTR}] > span`);
    if (existingLines.length > 0) {
      for (const roomLine of existingLines) {
        setHighlight(roomLine, targetRoomRegex.test(roomLine.textContent), 'location line');
      }
      return;
    }

    const rawText = targetEl.textContent.trim();
    if (!rawText) return;

    if (!looksLikeRoomList(rawText)) {
      setHighlight(targetEl, targetRoomRegex.test(rawText), 'location');
      return;
    }

    const rooms = splitOuterCommas(rawText);
    let highlighted = 0;

    // Node-level construction only — no innerHTML, which Trusted Types blocks.
    targetEl.dataset.jshuteRawLocation = rawText;
    targetEl.replaceChildren();
    targetEl.style.display = 'block';
    targetEl.style.whiteSpace = 'normal';

    for (const room of rooms) {
      const containerLine = document.createElement('div');
      containerLine.setAttribute(ROOM_LINE_ATTR, '');
      containerLine.style.marginBottom = '3px';
      containerLine.style.display = 'block';

      const roomLine = document.createElement('span');
      roomLine.textContent = room;
      roomLine.style.display = 'inline-block';
      roomLine.style.cursor = 'pointer';
      if (targetRoomRegex.test(room)) {
        roomLine.classList.add(HIGHLIGHT_CLASS);
        keepHighlighted.add(roomLine);
        highlighted++;
      }

      containerLine.appendChild(roomLine);
      targetEl.appendChild(containerLine);
    }

    console.log(TAG, `split location list into ${rooms.length} line(s), highlighted ${highlighted}`);
  }

  // --- Dialog processing -----------------------------------------------

  let lastEventTitle = null;

  function processDialog(dialog) {
    // Wiz reuses the whole #xDetDlg tree in place when you click straight from
    // one event to another. If it recycles the location element without
    // rewriting its text, our injected lines survive and we would keep showing
    // the previous event's rooms — so a title change forces a re-split.
    const titleEl = dialog.querySelector('#rAECCd') || dialog.querySelector('[role="heading"]');
    const eventTitle = titleEl ? titleEl.textContent.trim() : '';

    if (lastEventTitle !== null && eventTitle !== lastEventTitle) {
      console.log(TAG, `event changed to ${JSON.stringify(eventTitle)}`);
      resetLocationFormatting(dialog);
    }
    lastEventTitle = eventTitle;

    keepHighlighted = new Set();
    highlightRoomResources(dialog);
    formatTextLocations(dialog);
    sweepStaleHighlights(dialog);
  }

  // --- Observer --------------------------------------------------------

  // #xDetDlg stays in the DOM (hidden) after the popover closes, so presence
  // alone is not a useful gate — without the visibility check we would rescan
  // on every unrelated grid mutation for the rest of the session.
  let scheduled = false;
  let dialogWasVisible = false;

  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const dialog = document.getElementById(DIALOG_ID);
      const visible = dialog !== null && isVisible(dialog);

      if (!visible) {
        if (dialogWasVisible) {
          dialogWasVisible = false;
          lastEventTitle = null;
        }
        return;
      }

      clearTimeout(waitTimer);
      if (!dialogWasVisible) {
        dialogWasVisible = true;
        console.log(TAG, 'event details card opened');
      }
      processDialog(dialog);
    });
  }

  // If the card never shows up, say so once, so a permanent break is
  // distinguishable from "the user hasn't opened an event yet".
  const waitTimer = setTimeout(() => {
    console.log(TAG, 'still waiting for an event details card (#xDetDlg) to open');
  }, 8000);

  const observer = new MutationObserver(scheduleScan);
  observer.observe(document.body, { childList: true, subtree: true });

  scheduleScan();

  // --- First-run prompt ------------------------------------------------

  // Prompt at most once ever: the built-in default is a placeholder that will
  // not match anyone's real rooms, but a modal that reappears on every Calendar
  // tab until answered is worse than a script that quietly does nothing.
  if (readRegexString() === SENTINEL && !GM_getValue(PROMPTED_KEY, false)) {
    console.log(TAG, 'no regex configured, scheduling first-run prompt');
    setTimeout(() => {
      if (readRegexString() !== SENTINEL) return;
      GM_setValue(PROMPTED_KEY, true);
      promptForRegex();
    }, 500);
  }

  console.log(TAG, 'ready');
})();
