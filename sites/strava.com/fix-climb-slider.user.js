// ==UserScript==
// @name         Strava: Fix the broken climb filter on segment search
// @namespace    https://github.com/jshute96/userscripts
// @version      0.1.2
// @description  Bug fix for broken layout on the segment search page: Strava currently draws it vertically rather than horizontally because of missing CSS.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://www.strava.com/segments/search*
// @grant        none
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[strava-climb]';
  const STYLE_ID = 'jshute-climb-slider-layout';
  // The div holding the slider and the category icons. Used both by our CSS and
  // by sizeSliderToIcons(), so keep it as one expression.
  const COLUMN_SELECTOR = '#segment-cat-container > div:not(.cat-label)';
  // Gap we want between neighbouring category icons. The slider column is sized
  // from this so the levels sit close together rather than spread out.
  const ICON_GAP_PX = 4;
  // Column width before the icons have been measured; sizeSliderToIcons()
  // replaces it in the same frame.
  const INITIAL_SLIDER_WIDTH_PX = 210;

  function container() {
    return document.getElementById('segment-cat-container');
  }

  function sliderColumn() {
    return document.querySelector(COLUMN_SELECTOR);
  }

  function icons() {
    return Array.from(document.querySelectorAll('#segment-categories .icon-container'));
  }

  // The widget is hidden (zero-sized) while the search is for Running, and
  // nothing about it can be judged or measured in that state.
  function measurable() {
    const track = document.getElementById('segment-vals');
    return !!track && !!track.getBoundingClientRect().width;
  }

  // True when the category icons already sit in a row, i.e. Strava shipped the
  // widget's CSS again and this script has nothing left to do. Only meaningful
  // while the widget is visible — see measurable().
  function alreadyHorizontal() {
    const boxes = icons().map((el) => el.getBoundingClientRect());
    if (boxes.length < 2) return false;
    return Math.abs(boxes[0].top - boxes[1].top) < 2 && boxes[1].left > boxes[0].left + 1;
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      /* Flat/Downhill label | slider + icons | Climb label, on one row. */
      #segment-cat-container {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      #segment-cat-container > .cat-label {
        flex: 0 0 auto;
        white-space: nowrap;
      }
      ${COLUMN_SELECTOR} {
        flex: 0 0 auto;
        width: ${INITIAL_SLIDER_WIDTH_PX}px;
      }
      /* Icons are placed by positionIcons() so they sit under the slider stops. */
      #segment-categories {
        position: relative;
        height: 20px;
      }
      #segment-categories .icon-container {
        position: absolute;
        top: 0;
        transform: translateX(-50%);
      }
      /* Keep the flex row around the form from squeezing the widget back down. */
      #ride-type {
        flex: 0 0 auto;
      }
    `;
    document.head.appendChild(style);
    console.log(TAG, 'layout styles injected');
  }

  // Size the slider column so consecutive category icons end up ICON_GAP_PX
  // apart. The track is narrower than its column (Strava gives .ui-slider a left
  // margin), so measure that difference rather than assuming it.
  function sizeSliderToIcons(column, track, cells) {
    const iconWidth = Math.max(...cells.map((c) => c.getBoundingClientRect().width));
    if (!iconWidth) return;
    const wantTrack = (cells.length - 1) * (iconWidth + ICON_GAP_PX);
    const columnExtra = column.getBoundingClientRect().width - track.getBoundingClientRect().width;
    column.style.width = `${Math.round(wantTrack + columnExtra)}px`;
  }

  // Line each category icon up with the slider value it represents: icon i of n
  // sits at i/(n-1) along the slider track, matched to where jQuery UI draws a
  // handle for that value (handles are offset by their own margin, so we read it
  // off a live handle rather than assuming).
  function positionIcons() {
    const track = document.getElementById('segment-vals');
    const cats = document.getElementById('segment-categories');
    const column = sliderColumn();
    const cells = icons();
    if (!track || !cats || !column || cells.length < 2 || !measurable()) return false;

    sizeSliderToIcons(column, track, cells);

    const trackBox = track.getBoundingClientRect();
    const catsBox = cats.getBoundingClientRect();
    if (!trackBox.width) return false;

    let handleNudge = 0;
    const handle = track.querySelector('.ui-slider-handle');
    if (handle) {
      const margin = parseFloat(getComputedStyle(handle).marginLeft) || 0;
      handleNudge = margin + handle.offsetWidth / 2;
    }

    const origin = trackBox.left - catsBox.left + handleNudge;
    const step = trackBox.width / (cells.length - 1);
    cells.forEach((cell, i) => {
      cell.style.left = `${origin + step * i}px`;
    });
    return true;
  }

  let aligned = false;

  function align() {
    const ok = positionIcons();
    if (ok && !aligned) console.log(TAG, 'category icons aligned to slider positions');
    aligned = ok;
  }

  // Whether the page needs fixing at all can only be judged once the widget is
  // visible, and our own styles would poison the judgement, so nothing is
  // injected until this returns true.
  let decided = false;
  let fixing = false;

  function decide() {
    if (!measurable()) return false;
    decided = true;
    if (alreadyHorizontal()) {
      console.warn(TAG, 'climb-category widget already lays out horizontally — ' +
        'Strava appears to have fixed it, so this userscript is doing nothing ' +
        'and can be removed.');
      return true;
    }
    fixing = true;
    console.log(TAG, 'climb-category widget is stacked vertically; fixing layout');
    injectStyle();
    align();
    return true;
  }

  function onWidgetChanged() {
    if (!decided) decide();
    else if (fixing) align();
  }

  function init() {
    if (!container()) return;  // No climb-category widget on this page; nothing to fix.
    console.log(TAG, 'init on', location.pathname);

    // The widget starts hidden when the search is for Running, and stays
    // unmeasurable until the Cycling/Running switch reveals it. Strava toggles
    // that by writing #ride-type's inline style, so watch it. (A ResizeObserver
    // on the track does not fire for that transition.)
    const rideType = document.getElementById('ride-type');
    if (rideType) {
      new MutationObserver(onWidgetChanged).observe(rideType, {
        attributes: true,
        attributeFilter: ['style', 'class'],
      });
    }
    window.addEventListener('resize', onWidgetChanged);

    if (!decide()) {
      console.log(TAG, 'climb-category widget is hidden (Running search?); ' +
        'waiting until it is shown to see whether it needs fixing');
    }
  }

  init();
})();
