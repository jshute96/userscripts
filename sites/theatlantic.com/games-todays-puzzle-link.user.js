// ==UserScript==
// @name         The Atlantic Games: Link to today's puzzle
// @namespace    https://github.com/jshute96/userscripts
// @version      1.0.2
// @description  Adds a Today's Puzzle link to the puzzle-completed screen, so you can get to the new puzzle instead of back to the previous one you solved.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://www.theatlantic.com/games/*
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[atlantic games]';
  const LINK_ID = 'atlantic-games-todays-puzzle';
  const STYLE_ID = 'atlantic-games-todays-puzzle-style';
  const URL_CHANGE_EVENT = 'atlantic-games-todays-puzzle:urlchange';
  // CSS-module class names carry build-hash suffixes that rotate on every
  // deploy, so match on the stable semantic prefix only.
  const ENDSHEET_SELECTOR = '[class*="GamesEndsheet_root"]';
  const RETURN_BUTTON_SELECTOR = 'button[class*="GamesEndsheet_returnToPuzzle"]';

  console.log(TAG, 'init');

  // The dateless game URL always serves the current day's puzzle; a `?date=`
  // query param pins it to one specific day.
  function todaysPuzzleUrl() {
    return location.origin + location.pathname;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    // We copy the host button's className for typography, then override the
    // few bits that differ. An ID selector outranks the host's class rules,
    // so these win regardless of stylesheet order.
    //   - width: the host rule is display:flex + margin-left:auto, which
    //     right-aligns a shrink-to-fit <button> but would stretch a block
    //     <a> full width; max-content restores the right alignment.
    //   - margin-top: pull up under the button, whose margin-bottom is 24px.
    style.textContent = `
      #${LINK_ID} {
        width: max-content;
        margin-top: -18px;
        text-decoration: underline;
      }
    `;
    document.head.appendChild(style);
  }

  let warnedMissingButton = false;

  function insertLink() {
    const endsheet = document.querySelector(ENDSHEET_SELECTOR);
    if (!endsheet) {
      // Endsheet is gone (puzzle in progress, or user returned to the
      // puzzle); re-arm the warning for the next time it appears.
      warnedMissingButton = false;
      return;
    }

    const existing = document.getElementById(LINK_ID);
    if (existing) {
      const url = todaysPuzzleUrl();
      if (existing.getAttribute('href') !== url) {
        existing.setAttribute('href', url);
        console.log(TAG, 'updated Today\'s Puzzle link ->', url);
      }
      return;
    }

    const btn = endsheet.querySelector(RETURN_BUTTON_SELECTOR);
    if (!btn) {
      if (!warnedMissingButton) {
        warnedMissingButton = true;
        console.warn(TAG, 'endsheet found but "Return to Puzzle" button did not match', RETURN_BUTTON_SELECTOR);
      }
      return;
    }

    console.log(TAG, 'endsheet detected');
    ensureStyle();
    const link = document.createElement('a');
    link.id = LINK_ID;
    link.className = btn.className;
    link.href = todaysPuzzleUrl();
    link.textContent = "Today's Puzzle";
    btn.insertAdjacentElement('afterend', link);
    console.log(TAG, 'added Today\'s Puzzle link ->', link.href);
  }

  // The endsheet is injected when the puzzle is solved and torn down when the
  // user returns to the puzzle, so keep watching for the whole page lifetime.
  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      insertLink();
    });
  }

  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });

  // The games section is a Next.js app: moving between games can happen via
  // history mutation with no document load, which would leave a stale href.
  for (const method of ['pushState', 'replaceState']) {
    const orig = history[method];
    history[method] = function (...args) {
      const result = orig.apply(this, args);
      window.dispatchEvent(new Event(URL_CHANGE_EVENT));
      return result;
    };
  }
  window.addEventListener('popstate', insertLink);
  window.addEventListener(URL_CHANGE_EVENT, insertLink);

  insertLink();
})();
