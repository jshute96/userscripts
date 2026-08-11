// ==UserScript==
// @name         calendar.google.com: highlight local rooms
// @namespace    https://github.com/jshute96/userscripts
// @version      1.7.3
// @description  Highlight meeting locations matching a configurable regex, to make it easy to find the local room in a long room list. Where room lists are shown as comma-separated text blobs, reformat them one per line.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
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
  const ROOM_ID = 'xDetDlgRoom';

  // Text we must never match against or highlight. `span.XuJrye` is Calendar's
  // visually-hidden accessibility label; inside the location row it reads
  // "Location:". Matching a container's textContent therefore matched the word
  // "Lo(ca)tion" for a regex as short as /CA/i, highlighting every event that
  // had any location at all. `[aria-hidden="true"]` covers the icon wrappers.
  const IGNORED_TEXT_SELECTOR = 'span.XuJrye, [aria-hidden="true"]';

  // Each booked room is one `span.iGpjxc`, wrapping the building name plus a
  // map link holding the room name and floor ("AAA-BBB-BLDG1 Aspen 3-C").
  // That whole span is the unit we match and highlight; its sibling
  // `div[role="tooltip"]` repeats the room name and must stay out of the text.
  //
  // Rooms are spread across several `div.nBzcnc.OcVpRe` rows and only the first
  // carries `#xDetDlgRoom`, so the search is dialog-wide with the location
  // field excluded — scoping to `#xDetDlgRoom` silently drops every room after
  // the first. (`OcVpRe` is not room-specific either; the location row in an
  // event with no rooms also has it.)
  //
  // Candidates are tried in order. `iGpjxc` is a rotating build hash, so the
  // second entry re-derives the same spans from the map link's aria-label,
  // which describes purpose rather than styling. Note that aria-label is
  // localised: the /meeting room/i test only holds for an English Calendar UI,
  // and the fallback goes dead (falling back to the warning) in other locales.
  const ROOM_BLOCK_CANDIDATES = [
    {
      name: 'span.iGpjxc room entries',
      find: (d) => d.querySelectorAll(`span.iGpjxc:not(#${LOC_ID} span)`),
    },
    {
      name: 'room map links (aria-label)',
      find: (d) => Array.from(d.querySelectorAll(`a[aria-label]:not(#${LOC_ID} a)`))
        .filter((a) => /meeting room/i.test(a.getAttribute('aria-label')))
        .map((a) => a.parentElement)
        .filter((el) => el !== null),
    },
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

  // Text to run the regex against. Room entries join their parts with
  // non-breaking spaces, so a pattern typed with an ordinary space
  // ("BLDG1 Aspen") would not match the raw textContent.
  function matchableText(el) {
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
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

  let missingRoomsLogged = false;

  function highlightRoomResources(dialog) {
    const textBlocks = findRoomTextBlocks(dialog);

    if (textBlocks.length === 0) {
      // Most events book no rooms, so finding none is normal. But if the rooms
      // row itself is present, rooms exist and every candidate selector failed
      // — that is a real break worth saying out loud, once.
      const roomRow = dialog.querySelector(`#${ROOM_ID}`);
      if (roomRow && roomRow.textContent.trim() && !missingRoomsLogged) {
        missingRoomsLogged = true;
        console.warn(TAG, `#${ROOM_ID} is present but no room entries matched any known selector — selectors have changed`);
      }
      return;
    }
    missingRoomsLogged = false;

    for (const textBlock of textBlocks) {
      setHighlight(textBlock, targetRoomRegex.test(matchableText(textBlock)), 'room');
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
    if (leaves.length === 0) return null;

    // Cross-check against the row's own `data-text`, which holds the location
    // string verbatim. This is the safety net for `span.XuJrye` rotating: that
    // class is how we recognise the hidden "Location:" label, and without it
    // the label becomes an ordinary text leaf that sorts *before* the address
    // and would be picked instead — silently killing the feature, and matching
    // "Lo(ca)tion" all over again. Falling back to the first leaf keeps the
    // previous behaviour when `data-text` is absent.
    const wanted = (locEl.dataset.text || '').replace(/\s+/g, ' ').trim();
    if (wanted) {
      const exact = leaves.find((el) => matchableText(el) === wanted);
      if (exact) return exact;
    }
    return leaves[0];
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
        setHighlight(roomLine, targetRoomRegex.test(matchableText(roomLine)), 'location line');
      }
      return;
    }

    const rawText = targetEl.textContent.trim();
    if (!rawText) return;

    if (!looksLikeRoomList(rawText)) {
      setHighlight(targetEl, targetRoomRegex.test(matchableText(targetEl)), 'location');
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
      if (targetRoomRegex.test(room.replace(/\s+/g, ' '))) {
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
