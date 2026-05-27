// ==UserScript==
// @name         Pinkbike: Article image navigation
// @namespace    https://github.com/jshute96/userscripts
// @version      1.0.3
// @description  Keyboard shortcuts (i / Shift-I) for paging through the large photos and videos in a Pinkbike article.
// @author       Jeff Shute <jshute@gmail.com>
// @match        https://www.pinkbike.com/news/*
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

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
  }

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

  function onKeyDown(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingTarget(e.target)) return;

    // Match the i-key regardless of Caps Lock state, then use the
    // Shift modifier (not e.key's case) to decide direction. Reading
    // case directly would treat CapsLock+i as Shift-I, which would
    // be a surprising reversal of behaviour.
    if (e.key.toLowerCase() !== 'i') return;
    e.preventDefault();
    jumpImage(e.shiftKey ? 'prev' : 'next');
  }

  document.addEventListener('keydown', onKeyDown);
  console.log(TAG, 'keys: i=next-image, Shift-I=prev-image');
})();
