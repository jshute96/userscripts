// ==UserScript==
// @name         YouTube: Simple zoom and pan
// @namespace    https://github.com/jshute96/userscripts
// @version      0.1.0
// @description  Zoom and pan the video with the mouse, trackpad or keyboard. Drag a box and zoom to that region.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://www.youtube.com/*
// @grant        window.onurlchange
// @noframes
// @run-at       document-start
// ==/UserScript==

// Mouse controls:
//   Ctrl + mouse wheel                   Zoom in / out
//   Ctrl + drag (left or middle button)  Pan
//   Shift + drag                         Draw a box, then zoom to it
//
// Trackpad controls:
//   Pinch-zoom                           Zoom in / out
//   Ctrl + two-finger drag up/down       Zoom in / out
//   Ctrl + drag                          Pan
//   Shift + drag                         Draw a box, then zoom to it
//
// Keyboard controls:
//   Plus / minus                         Zoom in / out by 2x
//   Ctrl + arrow keys                    Pan
//   x                                    Toggle between default and zoomed view

(function () {
  'use strict';

  const TAG = '[yt-zoom]';
  // The player root, shared by the watch page (#movie_player) and Shorts
  // (#shorts-player).  Both can be in the DOM at once after in-page
  // navigation, the inactive one empty and zero-sized.
  const PLAYER_SEL = '.html5-video-player';
  // 360° videos: the player draws the picture into a WebGL canvas and
  // has its own look-around and field-of-view zoom, so we stand down.
  const SPHERICAL_CLASS = 'ytp-webgl-spherical';
  const VIDEO_SEL = '.html5-video-player video.html5-main-video';
  const STYLE_MARK = 'data-jshute-yt-zoom-style';
  const BOX_ID = 'jshute-yt-zoom-box';
  const HUD_ID = 'jshute-yt-zoom-hud';

  const MIN_SCALE = 1;
  const MAX_SCALE = 32;
  // Wheel zoom is `scale *= exp(-deltaPixels * k)`: exponential so a
  // gesture multiplies the zoom by the same factor at every level, with
  // no ladder or accumulator to overshoot.  Constants and the pinch
  // handling were tuned across devices in the SeeWhatISee project
  // (src/capture-page/zoom.ts); see its docs for the measurements.
  // One 100 px mouse detent = e^0.25 ≈ 1.28×, ~2.8 detents per doubling.
  const WHEEL_ZOOM_K = 0.0025;
  // Chrome delivers a trackpad pinch as a ctrl+wheel event with deltas
  // ~8× smaller per unit of finger travel than a wheel detent.
  const PINCH_ZOOM_K = 0.02;
  // `deltaMode` line/page deltas, normalized to pixels.  Chrome always
  // sends pixels; Firefox and some Linux builds send lines (3 per
  // detent).  A page is scaled like a few detents, not a viewport, so
  // one event can't slam the zoom to a limit.
  const LINE_HEIGHT_PX = 40;
  const PAGE_DELTA_PX = 200;
  // A keypress is a discrete act, so it steps by a doubling; the wheel
  // is the fine control.
  const KEY_ZOOM_STEP = 2;
  // Ctrl+arrow pans by this fraction of the frame per press.
  const KEY_PAN_STEP = 0.2;
  // A shift-drag smaller than this (in either dimension) is treated
  // as an accidental click, not a zoom box.
  const MIN_BOX_PX = 8;
  const HUD_MS = 700;
  // How long after a drag ends to swallow the click/dblclick the
  // browser synthesizes from it (YouTube would toggle play/fullscreen).
  const SWALLOW_CLICK_MS = 500;

  // The view: a CSS transform on the <video>, `translate(ox, oy) scale(s)`
  // with transform-origin at the top-left.  ox/oy are fractions of the
  // video's own (unzoomed) width/height, so the view survives the
  // player being resized (theater mode, fullscreen) without recomputing.
  // Both are ≤ 0: the zoomed video is always at least as big as its
  // box, and never shows a gap.
  let view = { s: 1, ox: 0, oy: 0 };
  // The view `x` will return to.
  let savedView = null;
  let lastVideoKey = videoKey();

  // The drag in progress, if any: {mode: 'pan'|'box', player, video, ...}.
  let drag = null;
  let swallowClicksUntil = 0;
  let hudTimer = null;
  let styleObserver = null;
  let observedVideo = null;
  // Whether Ctrl/Cmd is physically held.  A pinch's wheel event says
  // ctrlKey=true with no key down, and that's the only reliable way
  // to tell the two apart: high-resolution wheels emit the same small
  // deltas a pinch does, so magnitude can't.  Misreading a pinch as a
  // wheel is merely slow; the reverse would be an 8× runaway.
  let zoomModifierDown = false;
  // Video id we've already logged "spherical, standing down" for.
  let sphericalLoggedFor = null;

  console.log(`${TAG} init`);

  // ---------- view math ----------

  function isZoomed(v) {
    return v.s !== 1 || v.ox !== 0 || v.oy !== 0;
  }

  function clampView(v) {
    const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.s));
    return {
      s,
      ox: Math.min(0, Math.max(1 - s, v.ox)),
      oy: Math.min(0, Math.max(1 - s, v.oy)),
    };
  }

  function setView(video, next) {
    view = clampView(next);
    if (view.s === 1) view = { s: 1, ox: 0, oy: 0 };
    applyView(video);
    showHud(video);
  }

  function applyView(video) {
    watchStyle(video);
    if (isZoomed(view)) {
      video.style.transformOrigin = '0 0';
      video.style.transform =
        `translate(${view.ox * 100}%, ${view.oy * 100}%) scale(${view.s})`;
    } else {
      video.style.removeProperty('transform');
      video.style.removeProperty('transform-origin');
    }
  }

  // Where the video's *untransformed* top-left corner is on screen,
  // plus its untransformed size.  offsetWidth ignores transforms;
  // getBoundingClientRect doesn't, so back the translation out of it.
  function videoFrame(video) {
    const rect = video.getBoundingClientRect();
    const w = video.offsetWidth;
    const h = video.offsetHeight;
    return { x0: rect.left - view.ox * w, y0: rect.top - view.oy * h, w, h };
  }

  // Client coords → fraction of the unzoomed video (0..1 inside it).
  function toVideoFraction(video, clientX, clientY) {
    const f = videoFrame(video);
    return {
      u: (clientX - f.x0 - view.ox * f.w) / (view.s * f.w),
      v: (clientY - f.y0 - view.oy * f.h) / (view.s * f.h),
    };
  }

  // Zoom by `factor`, keeping the video point under (clientX, clientY)
  // fixed on screen.
  function zoomAt(video, factor, clientX, clientY) {
    const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.s * factor));
    if (s === view.s) return;
    const f = videoFrame(video);
    const { u, v } = toVideoFraction(video, clientX, clientY);
    setView(video, {
      s,
      ox: (clientX - f.x0) / f.w - u * s,
      oy: (clientY - f.y0) / f.h - v * s,
    });
  }

  function zoomAtCenter(video, factor) {
    const r = video.closest(PLAYER_SEL).getBoundingClientRect();
    zoomAt(video, factor, r.left + r.width / 2, r.top + r.height / 2);
  }

  // Zoom so the client-coordinate box fills the video's frame, centered.
  function zoomToBox(video, x1, y1, x2, y2) {
    const a = toVideoFraction(video, Math.min(x1, x2), Math.min(y1, y2));
    const b = toVideoFraction(video, Math.max(x1, x2), Math.max(y1, y2));
    const s = Math.min(MAX_SCALE, 1 / (b.u - a.u), 1 / (b.v - a.v));
    setView(video, {
      s,
      ox: 0.5 - s * (a.u + b.u) / 2,
      oy: 0.5 - s * (a.v + b.v) / 2,
    });
  }

  function resetView(video) {
    savedView = null;
    setView(video, { s: 1, ox: 0, oy: 0 });
  }

  // `x`: zoomed → remember the view and show the full frame; full
  // frame → go back to the remembered view, if any.
  function toggleReset(video) {
    if (isZoomed(view)) {
      savedView = view;
      setView(video, { s: 1, ox: 0, oy: 0 });
    } else if (savedView) {
      setView(video, savedView);
    }
  }

  // ---------- DOM helpers ----------

  // What identifies the current video in the URL: `?v=` on a watch
  // page, the path on Shorts.
  function videoKey() {
    return new URLSearchParams(location.search).get('v') || location.pathname;
  }

  // The video to act on: the one in a player that's actually laid out
  // (an inactive player from an earlier page is zero-sized).  Null if
  // there's none or it's spherical.
  function getVideo() {
    const video = [...document.querySelectorAll(VIDEO_SEL)].find((v) => v.offsetWidth > 0);
    if (!video) return null;
    if (video.closest(PLAYER_SEL).classList.contains(SPHERICAL_CLASS)) {
      const id = videoKey();
      if (sphericalLoggedFor !== id) {
        sphericalLoggedFor = id;
        console.log(`${TAG} spherical (360°) video; zoom and pan disabled`);
      }
      return null;
    }
    return video;
  }

  function playerVideoAt(target) {
    const player = target instanceof Element && target.closest(PLAYER_SEL);
    if (!player) return null;
    const video = getVideo();
    return video && player.contains(video) ? { player, video } : null;
  }

  function inTextField(target) {
    if (!(target instanceof Element)) return false;
    return target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null;
  }

  function ensureStyles() {
    if (document.querySelector(`style[${STYLE_MARK}]`)) return;
    const style = document.createElement('style');
    style.setAttribute(STYLE_MARK, '');
    style.textContent = `
      #${BOX_ID} {
        position: absolute; z-index: 2000; pointer-events: none;
        border: 2px dashed #fff; box-shadow: 0 0 0 1px rgba(0,0,0,.6), inset 0 0 0 1px rgba(0,0,0,.6);
        box-sizing: border-box;
      }
      #${HUD_ID} {
        position: absolute; z-index: 2000; pointer-events: none;
        top: 12px; left: 12px; padding: 3px 8px; border-radius: 4px;
        background: rgba(0,0,0,.6); color: #fff;
        font: 500 13px/1.4 Roboto, Arial, sans-serif;
        opacity: 0; transition: opacity .2s;
      }
      #${HUD_ID}.visible { opacity: 1; transition: none; }
    `;
    document.head.appendChild(style);
  }

  function showHud(video) {
    ensureStyles();
    const player = video.closest(PLAYER_SEL);
    let hud = document.getElementById(HUD_ID);
    if (!hud || hud.parentElement !== player) {
      hud?.remove();
      hud = document.createElement('div');
      hud.id = HUD_ID;
      player.appendChild(hud);
    }
    hud.textContent = `${view.s.toFixed(view.s < 10 ? 1 : 0)}×`;
    hud.classList.add('visible');
    clearTimeout(hudTimer);
    hudTimer = setTimeout(() => hud.classList.remove('visible'), HUD_MS);
  }

  // YouTube rewrites the video's inline width/height/left/top on
  // resize.  It sets them individually today, so our transform
  // survives, but put it back if that ever changes.
  function watchStyle(video) {
    if (observedVideo === video) return;
    styleObserver?.disconnect();
    observedVideo = video;
    styleObserver = new MutationObserver(() => {
      if (isZoomed(view) && !video.style.transform) {
        console.log(`${TAG} transform was cleared by the page; reapplying`);
        applyView(video);
      }
    });
    styleObserver.observe(video, { attributes: true, attributeFilter: ['style'] });
  }

  // ---------- box overlay ----------

  function updateBox(player, x1, y1, x2, y2) {
    ensureStyles();
    let box = document.getElementById(BOX_ID);
    if (!box) {
      box = document.createElement('div');
      box.id = BOX_ID;
      player.appendChild(box);
    }
    const r = player.getBoundingClientRect();
    box.style.left = `${Math.min(x1, x2) - r.left}px`;
    box.style.top = `${Math.min(y1, y2) - r.top}px`;
    box.style.width = `${Math.abs(x2 - x1)}px`;
    box.style.height = `${Math.abs(y2 - y1)}px`;
  }

  function removeBox() {
    document.getElementById(BOX_ID)?.remove();
  }

  // ---------- event handlers ----------

  // Ctrl+wheel anywhere on the page zooms the video, never the page:
  // page zoom is useless with YouTube's layout, and claiming it
  // everywhere means nothing leaks through while the page is still
  // laying itself out around a video that's already playing.
  function wheelDeltaPixels(e) {
    if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) return e.deltaY * LINE_HEIGHT_PX;
    if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) return e.deltaY * PAGE_DELTA_PX;
    return e.deltaY;
  }

  function onWheel(e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const video = getVideo();
    if (!video) return;
    e.preventDefault();
    e.stopPropagation();
    const isPinch = !zoomModifierDown;
    const k = isPinch ? PINCH_ZOOM_K : WHEEL_ZOOM_K;
    const factor = Math.exp(-wheelDeltaPixels(e) * k);
    if (playerVideoAt(e.target)) {
      zoomAt(video, factor, e.clientX, e.clientY);
    } else {
      zoomAtCenter(video, factor);
    }
  }

  function onPointerDown(e) {
    if (drag || e.altKey || e.metaKey) return;
    const pv = playerVideoAt(e.target);
    if (!pv) return;
    let mode = null;
    // Shift wins when both are held, so ctrl+shift+drag draws a box too.
    if (e.shiftKey && e.button === 0) mode = 'box';
    else if (e.ctrlKey && !e.shiftKey && (e.button === 0 || e.button === 1)) mode = 'pan';
    if (!mode) return;
    if (mode === 'pan' && !isZoomed(view)) {
      // Nothing to pan at 1×; let the click through untouched.
      return;
    }
    // preventDefault on pointerdown also suppresses the compatibility
    // mousedown, which is what would start middle-button autoscroll.
    e.preventDefault();
    e.stopPropagation();
    drag = {
      mode,
      ...pv,
      pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      lastX: e.clientX, lastY: e.clientY,
    };
    try { pv.player.setPointerCapture(e.pointerId); } catch (_) { /* fine */ }
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    if (drag.mode === 'pan') {
      const f = videoFrame(drag.video);
      view = clampView({
        s: view.s,
        ox: view.ox + (e.clientX - drag.lastX) / f.w,
        oy: view.oy + (e.clientY - drag.lastY) / f.h,
      });
      applyView(drag.video);
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
    } else {
      updateBox(drag.player, drag.startX, drag.startY, e.clientX, e.clientY);
    }
  }

  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    const d = drag;
    drag = null;
    try { d.player.releasePointerCapture(e.pointerId); } catch (_) { /* fine */ }
    removeBox();
    const w = Math.abs(e.clientX - d.startX);
    const h = Math.abs(e.clientY - d.startY);
    // A press that barely moved is a click, and stays one.
    if (e.type === 'pointercancel' || Math.max(w, h) < MIN_BOX_PX) return;
    swallowClicksUntil = performance.now() + SWALLOW_CLICK_MS;
    if (d.mode === 'pan') return;
    if (w < MIN_BOX_PX || h < MIN_BOX_PX) return;
    zoomToBox(d.video, d.startX, d.startY, e.clientX, e.clientY);
  }

  // The click the browser synthesizes at the end of a drag would reach
  // YouTube's player and toggle play/pause (or fullscreen on dblclick).
  function onClick(e) {
    if (performance.now() < swallowClicksUntil && playerVideoAt(e.target)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function onKeyDown(e) {
    if (e.isComposing || inTextField(e.target)) return;
    const video = getVideo();
    if (!video) return;
    if (e.key === 'x' && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      e.stopImmediatePropagation();
      toggleReset(video);
      return;
    }
    if (e.altKey || e.metaKey) return;
    // Plain plus / minus, with or without Shift, on either row.  Matched
    // by physical key too, since Shift turns '=' into '+' and '-' into
    // '_'.  (These are YouTube's caption-size keys; zoom is the better
    // use of them.  Ctrl+plus/minus is left to the browser — claiming
    // it fought the browser's page zoom in awkward ways.)
    const zoomIn = e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '+' || e.key === '=';
    const zoomOut = e.code === 'Minus' || e.code === 'NumpadSubtract' || e.key === '-' || e.key === '_';
    if (!e.ctrlKey && (zoomIn || zoomOut)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      zoomAtCenter(video, zoomIn ? KEY_ZOOM_STEP : 1 / KEY_ZOOM_STEP);
      return;
    }
    if (!e.ctrlKey) return;
    const pan = KEY_PAN[e.key];
    if (pan) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (!isZoomed(view)) return;
      // Moving the view right means the content slides left.
      view = clampView({ s: view.s, ox: view.ox - pan[0] * KEY_PAN_STEP, oy: view.oy - pan[1] * KEY_PAN_STEP });
      applyView(video);
    }
  }
  const KEY_PAN = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

  // Same <video> element is reused across in-page navigation, so a
  // zoom would otherwise carry over to the next video.
  function onUrlChange() {
    const key = videoKey();
    if (key === lastVideoKey) return;
    lastVideoKey = key;
    // Reset the element we transformed, not whichever is live now: mid
    // navigation there may be none, and leaving a stale transform (and
    // a stale `view`) behind would skew the next video's anchor math.
    if (observedVideo && (isZoomed(view) || savedView)) {
      resetView(observedVideo);
    }
  }

  // Registered at document-start: the page is heavy enough that a video
  // can be playing well before document-idle, and a ctrl+wheel in that
  // window would zoom the page instead.  Nothing here needs the DOM —
  // the listeners find the player from the event target, and the
  // overlay/styles are created on first use.
  // Track the physical modifier for pinch detection.  keydown/keyup
  // alone miss Ctrl already held when the window took focus, so
  // mousemove re-syncs it: Chrome fabricates the modifier only on the
  // pinch's wheel event, never on pointer events, and a pinch produces
  // no mousemove.  Blur clears it, since the keyup may never arrive.
  const syncZoomModifier = (e) => { zoomModifierDown = e.ctrlKey || e.metaKey; };
  window.addEventListener('keydown', syncZoomModifier, true);
  window.addEventListener('keyup', syncZoomModifier, true);
  window.addEventListener('mousemove', syncZoomModifier, true);
  window.addEventListener('blur', () => { zoomModifierDown = false; });

  document.addEventListener('wheel', onWheel, { capture: true, passive: false });
  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointermove', onPointerMove, true);
  document.addEventListener('pointerup', onPointerUp, true);
  document.addEventListener('pointercancel', onPointerUp, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('dblclick', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('urlchange', onUrlChange);
})();
