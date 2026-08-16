// ==UserScript==
// @name         Strava Upload: One-click defaults for my preferred commute settings
// @namespace    https://github.com/jshute96/userscripts
// @version      0.1.0
// @description  Adds a Set button beside the Commute tag on the upload page that tags the activity as a commute, with my usual bike, and makes it private.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://www.strava.com/upload/*
// @grant        none
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[strava-commute]';

  // ------------------------------------------------------------ settings
  // Edit these to match your own commute defaults. GEAR_NAME is the bike
  // exactly as it appears in the Bike drop-down; VISIBILITY is the value on
  // the Privacy Controls radios ('everyone', 'followers_only', 'only_me').
  const SET_COMMUTE = true;
  const GEAR_NAME = 'Trek Domane';
  const VISIBILITY = 'only_me';

  const BUTTON_MARK = 'data-jshute-commute-preset';
  // Blue, so it reads as ours rather than as one of Strava's orange actions.
  const BUTTON_COLOR = '#0a66c2';
  const BUTTON_COLOR_HOVER = '#08529c';
  // A little shorter than Strava's own buttons (34px), to sit neatly beside
  // the tag pills.
  const BUTTON_HEIGHT = '28px';

  // ------------------------------------------------------------- helpers

  // The Commute tag pill. Each uploaded file gets its own form, and every tag
  // checkbox in it is named activity[tags][], distinguished only by value.
  function commuteInput(form) {
    return form.querySelector('input[type="checkbox"][name="activity[tags][]"][value="Commute"]');
  }

  // Strava's legacy drop-down widget: a .selection div showing the current
  // choice, plus a ul.options of li[data-value] > a items.
  function bikeMenu(form) {
    return form.querySelector('.drop-down-menu.bike');
  }

  function visibilityInput(form) {
    return form.querySelector(`input[type="radio"][name="visibility"][value="${VISIBILITY}"]`);
  }

  // Click rather than assign .checked: these inputs are driven by the page's
  // own handlers (jQuery for the tags, React for the privacy radios), and a
  // direct property assignment fires no event for either of them.
  function setChecked(input, what, done) {
    if (!input) {
      console.log(TAG, `could not find the ${what} control`);
      return;
    }
    if (input.checked) {
      console.log(TAG, `${what} already set, skipping`);
      return;
    }
    input.click();
    done.push(what);
  }

  function setBike(form, done) {
    const menu = bikeMenu(form);
    const selection = menu && menu.querySelector('.selection');
    if (!selection) {
      console.log(TAG, 'could not find the bike drop-down');
      return;
    }
    if (selection.textContent.trim() === GEAR_NAME) {
      console.log(TAG, `bike already set to ${GEAR_NAME}, skipping`);
      return;
    }
    const option = Array.from(menu.querySelectorAll('ul.options li a'))
      .find((a) => a.textContent.trim() === GEAR_NAME);
    if (!option) {
      console.log(TAG, `no bike named "${GEAR_NAME}" in the drop-down; leaving it alone`);
      return;
    }
    // Open the menu first: the widget binds its selection handler to items in
    // an open menu, and clicking a hidden option does nothing.
    selection.click();
    option.click();
    if (selection.textContent.trim() !== GEAR_NAME) {
      console.log(TAG, `clicked "${GEAR_NAME}" but the drop-down still shows ` +
        `"${selection.textContent.trim()}" — the widget may have changed`);
      return;
    }
    done.push(`bike=${GEAR_NAME}`);
  }

  function applyPreset(form) {
    const done = [];
    if (SET_COMMUTE) setChecked(commuteInput(form), 'commute', done);
    setBike(form, done);
    setChecked(visibilityInput(form), `visibility=${VISIBILITY}`, done);
    console.log(TAG, done.length ? `applied: ${done.join(', ')}` : 'nothing to change');
  }

  // ------------------------------------------------------------- button

  // Match the shape of the page's own primary buttons (Save & View, Upload
  // Selected) by reusing their classes, minus the ones that place them in the
  // footer. The page holds more than one Save & View — an older, taller variant
  // that carries the legacy `btn` class stays hidden — so only a rendered one
  // is a good model. Until one is rendered we use the current classes of the
  // live button, and upgrade later if the page disagrees.
  function primaryButtonClasses() {
    const positional = ['right', 'action-button', 'save-and-view', 'upload-selected'];
    const models = Array.from(document.querySelectorAll('button.action-button'));
    const model = models.find((b) => b.getBoundingClientRect().height > 0);
    if (!model) return 'btn-primary';
    return Array.from(model.classList).filter((c) => !positional.includes(c)).join(' ') || 'btn-primary';
  }

  function addButton(form) {
    const input = commuteInput(form);
    // The pill's wrapper is what Strava shows and hides per activity type, so
    // the button rides along with it rather than sitting beside it.
    const field = input && input.closest('.input-field');
    if (!field || field.querySelector(`[${BUTTON_MARK}]`)) return false;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = primaryButtonClasses();
    button.textContent = 'Set';
    button.title = `Tag as commute, set bike to ${GEAR_NAME}, and set privacy to ${VISIBILITY}`;
    button.setAttribute(BUTTON_MARK, '1');
    Object.assign(button.style, {
      marginLeft: '10px',
      verticalAlign: 'middle',
      // The tag pills set line-height: 33px, and a button inheriting that ends
      // up half as tall again as Strava's own buttons.
      lineHeight: 'normal',
      // Fixed height with the vertical padding dropped, so the shorter button
      // still centers its label whatever padding the copied classes carry.
      height: BUTTON_HEIGHT,
      // Strava's button class carries a min-height of its own, which wins over
      // a shorter height unless it too is overridden.
      minHeight: BUTTON_HEIGHT,
      paddingTop: '0',
      paddingBottom: '0',
      backgroundColor: BUTTON_COLOR,
      borderColor: BUTTON_COLOR,
      color: '#fff',
    });
    button.addEventListener('mouseenter', () => {
      button.style.backgroundColor = BUTTON_COLOR_HOVER;
      button.style.borderColor = BUTTON_COLOR_HOVER;
    });
    button.addEventListener('mouseleave', () => {
      button.style.backgroundColor = BUTTON_COLOR;
      button.style.borderColor = BUTTON_COLOR;
    });
    button.addEventListener('click', (event) => {
      event.preventDefault();
      applyPreset(form);
    });
    field.appendChild(button);
    return true;
  }

  // Forms appear one per uploaded file, after the upload finishes, and the
  // page keeps adding them as more files are processed.
  function addButtons() {
    let added = 0;
    for (const form of document.querySelectorAll('form.good')) {
      if (addButton(form)) added++;
    }
    if (added) console.log(TAG, `added Set button to ${added} upload form(s)`);

    // Save & View is hidden until the activity is ready to save, so the first
    // button may have been styled off a fallback. Restyle once the real one
    // shows up.
    const classes = primaryButtonClasses();
    let upgraded = 0;
    for (const button of document.querySelectorAll(`[${BUTTON_MARK}]`)) {
      if (button.className === classes) continue;
      button.className = classes;
      upgraded++;
    }
    if (upgraded) console.log(TAG, `restyled ${upgraded} button(s) to match the page: ${classes}`);
  }

  function init() {
    console.log(TAG, 'init on', location.pathname);
    addButtons();
    let pending = null;
    new MutationObserver(() => {
      if (pending) return;
      pending = setTimeout(() => { pending = null; addButtons(); }, 100);
    }).observe(document.body, { childList: true, subtree: true });
  }

  init();
})();
