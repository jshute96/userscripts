// ==UserScript==
// @name         Pinkbike: Keyboard navigation for article photos
// @namespace    https://github.com/jshute96/userscripts
// @version      1.1.0
// @description  Adds i and Shift-I shortcuts that jump from photo to photo through an article, for nicer viewing in photo-heavy stories.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://www.pinkbike.com/news/*
// @require      https://raw.githubusercontent.com/jshute96/userscripts/main/lib/keyboard-shortcuts.js
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[pb img]';

  if (window.__pbImgNavLoaded) {
    console.log(TAG, 'already loaded; skipping duplicate run');
    return;
  }
  window.__pbImgNavLoaded = true;

  // A photo "counts" if it's at least this tall (in CSS pixels).
  // Excludes comment avatars (tiny), related-articles thumbs (~120px),
  // ad slots, and inline icons — leaves the gallery photos the user
  // actually wants to scan. A fixed pixel cutoff (vs. a fraction of
  // viewport height) keeps the set of reachable images stable as the
  // window is resized.
  const MIN_HEIGHT_PX = 200;

  // Scroll target = absoluteTop(image) - SCROLL_BUFFER. So the image's
  // top edge lands a few pixels below the viewport top — enough to see
  // its border and tell "this is the start of a new picture."
  const SCROLL_BUFFER = 30;

  // Tolerance: an image whose absTop is within EPSILON of the current
  // "anchor line" is considered already at the top, and pressing `i`
  // skips past it to the next one.
  const EPSILON = 5;

  console.log(TAG, 'initializing');

  // Bottom-of-article boundary: anything at or past the comments
  // section is "outside the article" — related stories, more-from-
  // this-author blocks, sponsored galleries, etc. Pinkbike reuses
  // `.blog-section` for those, so a class-only scope isn't enough on
  // photo-gallery posts. Falls back to the document bottom if no
  // comments wrapper exists.
  function articleBottomY() {
    const el = document.querySelector('.news-comments-container')
      || document.getElementById('commenttop');
    return el
      ? Math.round(el.getBoundingClientRect().top + window.scrollY)
      : document.body.scrollHeight;
  }

  // Sorted list of {el, absTop, kind} for every large image/video
  // inside the article body (`.blog-section`, above the comments).
  // Recomputed on every keypress so lazy-loaded images that grew or
  // shrank get picked up.
  function findArticleMedia() {
    const bottom = articleBottomY();
    const selector = [
      '.blog-section img',
      '.blog-section video',
      '.blog-section iframe[src*="youtube"]',
      '.blog-section iframe[src*="vimeo"]',
    ].join(', ');
    const out = [];
    for (const el of document.querySelectorAll(selector)) {
      const rect = el.getBoundingClientRect();
      if (rect.height < MIN_HEIGHT_PX) continue;
      const absTop = Math.round(rect.top + window.scrollY);
      if (absTop >= bottom) continue;
      out.push({ el, absTop, kind: el.tagName.toLowerCase() });
    }
    out.sort((a, b) => a.absTop - b.absTop);
    return out;
  }

  function describeMedia(m) {
    if (m.kind === 'img') {
      // Prefer data-src: Pinkbike's lazy loader leaves `src` empty
      // until the image scrolls near the viewport, but `data-src`
      // carries the final URL from initial render. This way logs
      // identify the image consistently regardless of load state.
      const src = m.el.dataset.src || m.el.currentSrc || m.el.src || '';
      return `img(${(src.split('/').pop() || '?').split('?')[0]})`;
    }
    return m.kind;
  }

  function jumpImage(direction) {
    const media = findArticleMedia();
    const label = direction === 'next' ? 'i' : 'I';
    if (!media.length) {
      console.log(TAG, `${label}: no qualifying images in .blog-section`);
      return;
    }
    // Current anchor line — where the next-placed image's top would
    // land if we ran `i` from this position.
    const anchor = window.scrollY + SCROLL_BUFFER;
    let target;
    if (direction === 'next') {
      target = media.find(m => m.absTop > anchor + EPSILON);
    } else {
      // Last image strictly above the anchor.
      for (let i = media.length - 1; i >= 0; i--) {
        if (media[i].absTop < anchor - EPSILON) { target = media[i]; break; }
      }
    }
    if (!target) {
      console.log(TAG, `${label}: no ${direction === 'next' ? 'next' : 'previous'} image (scrollY=${Math.round(window.scrollY)})`);
      return;
    }
    const targetY = target.absTop - SCROLL_BUFFER;
    console.log(TAG, `${label} -> ${describeMedia(target)} @ y=${target.absTop}`);
    window.scrollTo({ top: targetY, behavior: 'smooth' });
  }

  // Modifier filtering, the "is the user typing?" guard, and the
  // Caps-Lock-safe letter matching all live in the shared library
  // now. Declaring `i` and `shift-i` separately keeps the original
  // behavior: the *modifier* picks the direction, so Caps Lock alone
  // doesn't reverse it.
  const keys = KeyboardShortcuts.create({ tag: TAG });
  keys.register('i', 'Go to next photo', () => jumpImage('next'));
  keys.register('shift-i', 'Go to previous photo', () => jumpImage('prev'));
  keys.logKeys();
})();
