// Shared mouse-wheel, trackpad, drag, and keyboard zoom-and-pan helper for image viewers.
//
// NOT a userscript — no metadata block. Pull it in with:
//
//   // @require https://raw.githubusercontent.com/jshute96/userscripts/main/lib/image-zoom-pan.js
//
// Supports both:
//   1. Chrome's standalone image viewer (`ImageDocument`, where
//      `document.contentType` starts with `image/` and the DOM is
//      `<html><body><img src="..."></body></html>`).
//   2. Framed web-app image viewers configured via `viewport`, `content`,
//      `img`, and optional `svg` / `fitToScreenClass` selectors.
//
// Controls provided:
//   Mouse wheel (or Ctrl + wheel)   Zoom in / out at cursor
//   Trackpad pinch / 2-finger scroll Zoom in / out at cursor
//   Drag / Ctrl + drag / middle-drag Pan (when zoomed or larger than viewport)
//   Shift + drag                    Draw a box, then zoom to it
//   Plus / minus                    Zoom in / out by 2x
//   Ctrl + arrow keys (or arrows)   Pan (when zoomed)
//   x                               Toggle between 1x and zoomed view

const ImageZoomPan = (function () {
  'use strict';

  const ACTIVE_ATTR = 'data-jshute-image-zoom-pan-active';
  const STYLE_MARK = 'data-jshute-image-zoom-pan-style';
  const STANDALONE_ATTR = 'data-jshute-image-zoom-pan-standalone';
  const ZOOMED_ATTR = 'data-jshute-image-zoom-pan-zoomed';
  const PANNING_ATTR = 'data-jshute-image-zoom-pan-panning';
  const BOX_ID = 'jshute-image-zoom-pan-box';
  const HUD_ID = 'jshute-image-zoom-pan-hud';

  const MIN_SCALE = 1;
  const MAX_SCALE = 32;
  // Exponential wheel zoom (`scale *= exp(-deltaPixels * k)`), using the
  // same constants tuned in SeeWhatISee and sites/www.youtube.com/zoom-pan.user.js.
  // One 100 px mouse detent = e^0.25 ≈ 1.28x, ~2.8 detents per doubling.
  const WHEEL_ZOOM_K = 0.0025;
  // Chrome delivers a trackpad pinch as a ctrl+wheel event with deltas
  // ~8x smaller per unit of finger travel than a wheel detent.
  const PINCH_ZOOM_K = 0.02;
  const LINE_HEIGHT_PX = 40;
  const PAGE_DELTA_PX = 200;
  const KEY_ZOOM_STEP = 2;
  const KEY_PAN_STEP = 0.2;
  const MIN_BOX_PX = 8;
  const HUD_MS = 700;
  const SWALLOW_CLICK_MS = 500;
  const KEY_PAN = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };

  const DEFAULT_TEXT_FIELD_SEL =
    'input, textarea, select, [contenteditable=""], [contenteditable="true"], material-input';
  const DEFAULT_SCROLLABLE_OVERLAY_SEL =
    'material-drawer, material-dialog, material-popup, [role="dialog"], [role="listbox"], [role="menu"]';

  function isStandaloneImageDoc() {
    return Boolean(
      document.contentType &&
        document.contentType.startsWith('image/') &&
        document.contentType !== 'image/svg+xml'
    );
  }

  function create(options) {
    const opts = options || {};
    const tag = opts.tag || '[image-zoom]';
    const viewportSel = opts.viewport || null;
    const contentSel = opts.content || viewportSel;
    const imgSel = opts.img || (viewportSel ? `${viewportSel} img` : null);
    const svgSel = opts.svg || null;
    const fitToScreenClass = opts.fitToScreenClass || null;
    const scrollableOverlaySel = opts.scrollableOverlay || DEFAULT_SCROLLABLE_OVERLAY_SEL;
    const editableOverlaySel = opts.editableOverlay || null;
    const customCanPlainDrag = typeof opts.canPlainDrag === 'function' ? opts.canPlainDrag : null;

    // If this script only targets standalone image documents (no framed
    // viewport selector configured) and the current document is not an
    // image document (e.g. an HTML page whose URL path ends in `.png`),
    // exit immediately with zero listeners.
    if (!viewportSel && !isStandaloneImageDoc()) {
      return null;
    }

    // Prevent double-binding when both a site-specific script (e.g. SnipIt)
    // and the generic standalone image script match the same image URL.
    const html = document.documentElement;
    if (html && html.hasAttribute(ACTIVE_ATTR)) {
      console.log(
        `${tag} already active (${html.getAttribute(ACTIVE_ATTR)}); skipping duplicate init`
      );
      return null;
    }
    if (html) {
      html.setAttribute(ACTIVE_ATTR, tag);
    }

    // Current transform state on `target.content`:
    // `transform-origin: 0 0; transform: translate(ox * 100%, oy * 100%) scale(s)`
    // where ox and oy are fractions of `target.content`'s untransformed size.
    let view = { s: 1, ox: 0, oy: 0 };
    let savedView = null;
    let lastUrlKey = urlKey();

    let drag = null;
    let swallowClicksUntil = 0;
    let hudTimer = null;
    let styleObserver = null;
    let classObserver = null;
    let observedContent = null;
    let lastFitToScreen = null;
    let appliedStyle = '';
    let loggedTargetKind = null;
    // Physical Ctrl/Cmd state, used to distinguish a trackpad pinch
    // (ctrlKey=true fabricated by Chrome on the wheel event with no key held)
    // from a physical Ctrl+wheel.
    let zoomModifierDown = false;

    console.log(`${tag} init`);

    // ---------- target detection ----------

    function urlKey() {
      return location.pathname + location.search;
    }

    // Returns the active zoom/pan target descriptor, or null if the current
    // page has no viewer laid out yet.
    // - On Chrome's standalone image viewer (`ImageDocument`):
    //   viewport = `document.body`
    //   content  = `body > img`
    //   img      = `body > img`
    //   svg      = null
    // - On a framed web viewer (`opts.viewport`):
    //   viewport = element matching `viewportSel`
    //   content  = element matching `contentSel`
    //   img      = element matching `imgSel`
    //   svg      = element matching `svgSel` (if configured)
    function getTarget() {
      if (isStandaloneImageDoc()) {
        ensureStandaloneMode();
        const body = document.body;
        const img = body && body.querySelector('img');
        if (!body || !img || img.offsetWidth === 0 || img.offsetHeight === 0) return null;
        if (loggedTargetKind !== 'standalone') {
          loggedTargetKind = 'standalone';
          console.log(
            `${tag} detected standalone image viewer (${img.naturalWidth}x${img.naturalHeight})`
          );
        }
        return { kind: 'standalone', viewport: body, content: img, img, svg: null };
      }

      if (!viewportSel) return null;
      const viewport = document.querySelector(viewportSel);
      const content = contentSel ? document.querySelector(contentSel) : viewport;
      const img = imgSel ? document.querySelector(imgSel) : viewport?.querySelector('img');
      if (!viewport || !content || !img || img.offsetWidth === 0 || img.offsetHeight === 0) {
        return null;
      }
      const svg = svgSel ? document.querySelector(svgSel) : null;
      if (loggedTargetKind !== 'framed') {
        loggedTargetKind = 'framed';
        console.log(
          `${tag} detected framed image viewer (${img.naturalWidth}x${img.naturalHeight})`
        );
      }
      if (fitToScreenClass) {
        watchFitToScreenClass(content);
      }
      return { kind: 'framed', viewport, content, img, svg };
    }

    function targetAt(eventTarget) {
      const t = getTarget();
      if (!t || !(eventTarget instanceof Node)) return null;
      if (t.viewport.contains(eventTarget)) return t;
      return null;
    }

    function ensureStandaloneMode() {
      const root = document.documentElement;
      if (!root) return;
      ensureStyles();
      if (!root.hasAttribute(STANDALONE_ATTR)) {
        root.setAttribute(STANDALONE_ATTR, '');
      }
    }

    // ---------- view math ----------

    function isZoomed(v) {
      return v.s !== 1 || v.ox !== 0 || v.oy !== 0;
    }

    // Where `content`'s untransformed top-left corner is on screen, plus its
    // untransformed dimensions. `offsetWidth`/`offsetHeight` ignore CSS
    // transforms; `getBoundingClientRect` includes them, and because
    // `transform-origin` is `0 0`, the top-left corner is shifted only by
    // `translate(ox * w, oy * h)`.
    function contentFrame(content) {
      const rect = content.getBoundingClientRect();
      const w = content.offsetWidth;
      const h = content.offsetHeight;
      return {
        x0: rect.left - view.ox * w,
        y0: rect.top - view.oy * h,
        w,
        h,
      };
    }

    // Returns the rendered picture rectangle inside `target.content` in
    // untransformed coordinates (`relX`, `relY`, `picW`, `picH`).
    // When `content` wraps `img` with margins or `fitToScreenClass` applies
    // `object-fit: contain`, the visible bitmap can be smaller than `content`
    // along one or both axes. Clamping against the visible picture box allows
    // zooming in to smoothly expand across margins and letterbox bars.
    function pictureBox(target) {
      const { content, img } = target;
      if (content === img) {
        return { relX: 0, relY: 0, picW: img.offsetWidth, picH: img.offsetHeight };
      }
      const boxW = img.offsetWidth;
      const boxH = img.offsetHeight;
      const natW = img.naturalWidth || boxW;
      const natH = img.naturalHeight || boxH;
      let picW = boxW;
      let picH = boxH;
      if (
        fitToScreenClass &&
        content.classList.contains(fitToScreenClass) &&
        natW > 0 &&
        natH > 0
      ) {
        const fit = Math.min(boxW / natW, boxH / natH);
        picW = natW * fit;
        picH = natH * fit;
      }
      const relX = img.offsetLeft + (boxW - picW) / 2;
      const relY = img.offsetTop + (boxH - picH) / 2;
      return { relX, relY, picW, picH };
    }

    // Clamps one axis of the translation offset `o` (as a fraction of `w`,
    // the untransformed size of `content`).
    // The zoomed picture spans `[x0 + o * w + s * relStart, x0 + o * w + s * (relStart + picSize)]`.
    // The viewport spans `[lo, hi]`.
    function clampAxis(o, s, x0, w, relStart, picSize, lo, hi) {
      if (w <= 0 || picSize <= 0) return 0;
      const z = s * picSize;
      if (z <= hi - lo) {
        // Picture is smaller than the viewport along this axis: require it
        // to cover its unzoomed footprint [pLo, pHi] (so cursor-anchored
        // zoom from 1x stays locked on the cursor across margins and
        // letterbox bars, and smoothly returns to o = 0 as s -> 1)
        // while staying within the viewport [lo, hi].
        const L = x0 + o * w + s * relStart;
        const pLo = Math.max(lo, x0 + relStart);
        const pHi = Math.min(hi, x0 + relStart + picSize);
        const minL = Math.max(lo, pHi - z);
        const maxL = Math.min(pLo, hi - z);
        const clampedL =
          minL <= maxL ? Math.min(maxL, Math.max(minL, L)) : (lo + hi - z) / 2;
        return (clampedL - x0 - s * relStart) / w;
      }
      return Math.min(
        (lo - x0 - s * relStart) / w,
        Math.max((hi - x0 - s * (relStart + picSize)) / w, o)
      );
    }

    function clampView(target, v) {
      const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.s));
      const f = contentFrame(target.content);
      const pic = pictureBox(target);
      const vp = target.viewport.getBoundingClientRect();
      let ox = clampAxis(v.ox, s, f.x0, f.w, pic.relX, pic.picW, vp.left, vp.right);
      let oy = clampAxis(v.oy, s, f.y0, f.h, pic.relY, pic.picH, vp.top, vp.bottom);
      if (Math.abs(ox) < 1e-6) ox = 0;
      if (Math.abs(oy) < 1e-6) oy = 0;
      return { s, ox, oy };
    }

    // If the user scrolled the framed viewport natively while fit-to-screen
    // was off and then starts zooming/panning, fold `scrollLeft`/`scrollTop`
    // into `view.ox`/`view.oy` so switching `overflow` to `hidden` doesn't jump.
    function absorbNativeScroll(target) {
      if (target.kind !== 'framed') return;
      const vp = target.viewport;
      if (vp.scrollLeft === 0 && vp.scrollTop === 0) return;
      const w = target.content.offsetWidth;
      const h = target.content.offsetHeight;
      if (w > 0 && h > 0) {
        view = {
          s: view.s,
          ox: view.ox - vp.scrollLeft / w,
          oy: view.oy - vp.scrollTop / h,
        };
      }
      vp.scrollLeft = 0;
      vp.scrollTop = 0;
    }

    function setView(target, next, showBadge = true) {
      absorbNativeScroll(target);
      view = clampView(target, next);
      applyView(target);
      if (showBadge) showHud(target);
    }

    function applyView(target) {
      ensureStyles();
      const { viewport, content } = target;
      watchStyle(target);
      const zoomed = isZoomed(view);
      viewport.toggleAttribute(ZOOMED_ATTR, zoomed);
      if (target.kind === 'standalone') {
        document.documentElement.toggleAttribute(ZOOMED_ATTR, zoomed);
      }
      if (zoomed) {
        content.style.transformOrigin = '0 0';
        content.style.transform =
          `translate(${view.ox * 100}%, ${view.oy * 100}%) scale(${view.s})`;
      } else {
        content.style.removeProperty('transform');
        content.style.removeProperty('transform-origin');
      }
      appliedStyle = content.style.cssText;
    }

    function toContentFraction(content, clientX, clientY) {
      const f = contentFrame(content);
      return {
        u: (clientX - f.x0 - view.ox * f.w) / (view.s * f.w),
        v: (clientY - f.y0 - view.oy * f.h) / (view.s * f.h),
      };
    }

    function viewportCenter(target) {
      const r = target.viewport.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }

    function zoomAt(target, factor, clientX, clientY) {
      absorbNativeScroll(target);
      const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.s * factor));
      if (s === view.s) return;
      const { u, v } = toContentFraction(target.content, clientX, clientY);
      const f = contentFrame(target.content);
      setView(target, {
        s,
        ox: (clientX - f.x0) / f.w - u * s,
        oy: (clientY - f.y0) / f.h - v * s,
      });
    }

    function zoomAtCenter(target, factor) {
      const c = viewportCenter(target);
      zoomAt(target, factor, c.x, c.y);
    }

    function zoomToBox(target, x1, y1, x2, y2) {
      absorbNativeScroll(target);
      const a = toContentFraction(target.content, Math.min(x1, x2), Math.min(y1, y2));
      const b = toContentFraction(target.content, Math.max(x1, x2), Math.max(y1, y2));
      const du = Math.abs(b.u - a.u);
      const dv = Math.abs(b.v - a.v);
      if (du <= 0 || dv <= 0) return;
      const f = contentFrame(target.content);
      const vp = target.viewport.getBoundingClientRect();
      const s = Math.min(
        MAX_SCALE,
        Math.max(MIN_SCALE, Math.min(vp.width / (du * f.w), vp.height / (dv * f.h)))
      );
      const c = viewportCenter(target);
      setView(target, {
        s,
        ox: (c.x - f.x0) / f.w - (s * (a.u + b.u)) / 2,
        oy: (c.y - f.y0) / f.h - (s * (a.v + b.v)) / 2,
      });
    }

    function resetView(target, showBadge = true) {
      savedView = null;
      setView(target, { s: 1, ox: 0, oy: 0 }, showBadge);
    }

    // `x`: when zoomed, save the current view and reset to 1x; when at 1x,
    // restore the saved view (or, if none is saved yet and the image is
    // pillarboxed narrower than the viewport, zoom to fill the viewport width).
    function toggleReset(target) {
      if (isZoomed(view)) {
        savedView = { ...view };
        setView(target, { s: 1, ox: 0, oy: 0 });
      } else if (savedView) {
        setView(target, savedView);
      } else {
        const pic = pictureBox(target);
        const vp = target.viewport.getBoundingClientRect();
        if (pic.picW > 0 && pic.picW * 1.05 < vp.width) {
          const s = Math.min(MAX_SCALE, vp.width / pic.picW);
          const f = contentFrame(target.content);
          const c = viewportCenter(target);
          setView(target, {
            s,
            ox: (c.x - f.x0 - s * (pic.relX + pic.picW / 2)) / f.w,
            oy: (vp.top - f.y0 - s * pic.relY) / f.h,
          });
        }
      }
    }

    // ---------- DOM helpers & observers ----------

    function inTextField(target) {
      if (!(target instanceof Element)) return false;
      return target.closest(DEFAULT_TEXT_FIELD_SEL) !== null;
    }

    function inScrollableOverlay(target) {
      if (!scrollableOverlaySel || !(target instanceof Element)) return false;
      return target.closest(scrollableOverlaySel) !== null;
    }

    // Whether the image can currently be panned (either already zoomed or
    // larger than the viewport because Fit to Screen was turned off).
    function canPan(target) {
      if (isZoomed(view)) return true;
      const pic = pictureBox(target);
      const vp = target.viewport.getBoundingClientRect();
      return pic.picW > vp.width + 1 || pic.picH > vp.height + 1;
    }

    // On framed viewers with an SVG annotation layer, plain left-drag and
    // plain Shift+drag are only used for panning / box-zoom when no
    // annotation tool is active (`svg` has `.readonly` or `.no-tool-active`)
    // and the pointer isn't on an editable annotation or text input overlay.
    // Middle-drag and Ctrl+drag always pan.
    function canPlainDrag(target, eventTarget) {
      if (target.kind === 'standalone') return true;
      if (customCanPlainDrag) return Boolean(customCanPlainDrag(target, eventTarget));
      const { svg } = target;
      if (!svg) return true;
      if (!svg.classList.contains('readonly') && !svg.classList.contains('no-tool-active')) {
        return false;
      }
      if (
        !svg.classList.contains('readonly') &&
        editableOverlaySel &&
        eventTarget instanceof Element &&
        eventTarget.closest(editableOverlaySel)
      ) {
        return false;
      }
      return true;
    }

    function ensureStyles() {
      const root = document.head || document.documentElement;
      if (!root || document.querySelector(`style[${STYLE_MARK}]`)) return;
      const style = document.createElement('style');
      style.setAttribute(STYLE_MARK, '');
      const framedRules = viewportSel
        ? `
        ${viewportSel} {
          position: relative !important;
        }
        ${viewportSel}[${ZOOMED_ATTR}] {
          overflow: hidden !important;
        }
        ${viewportSel}[${ZOOMED_ATTR}] svg.canvas.readonly,
        ${viewportSel}[${ZOOMED_ATTR}] svg.canvas.no-tool-active {
          cursor: grab;
        }
      `
        : '';
      style.textContent = `
        #${BOX_ID} {
          position: absolute; z-index: 2000; pointer-events: none;
          border: 2px dashed #fff;
          box-shadow: 0 0 0 1px rgba(0,0,0,.6), inset 0 0 0 1px rgba(0,0,0,.6);
          box-sizing: border-box;
        }
        #${HUD_ID} {
          position: absolute; z-index: 2000; pointer-events: none;
          top: 12px; left: 12px; padding: 3px 8px; border-radius: 4px;
          background: rgba(0,0,0,.65); color: #fff;
          font: 500 13px/1.4 Roboto, Arial, sans-serif;
          opacity: 0; transition: opacity .2s;
        }
        #${HUD_ID}.visible { opacity: 1; transition: none; }
        ${framedRules}
        /* Chrome standalone image document */
        html[${STANDALONE_ATTR}],
        html[${STANDALONE_ATTR}] body {
          margin: 0 !important;
          padding: 0 !important;
          width: 100vw !important;
          height: 100vh !important;
          overflow: hidden !important;
          background: #0e0e0e !important;
        }
        html[${STANDALONE_ATTR}] body {
          position: relative !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          user-select: none !important;
        }
        html[${STANDALONE_ATTR}] body > img {
          display: block !important;
          margin: 0 !important;
          max-width: 100vw !important;
          max-height: 100vh !important;
          width: auto !important;
          height: auto !important;
          object-fit: contain !important;
          cursor: default !important;
          user-select: none !important;
          -webkit-user-drag: none !important;
        }
        html[${STANDALONE_ATTR}][${ZOOMED_ATTR}] body > img {
          cursor: grab !important;
        }

        html[${PANNING_ATTR}],
        html[${PANNING_ATTR}] * {
          cursor: grabbing !important;
        }
      `;
      root.appendChild(style);
    }

    function showHud(target) {
      ensureStyles();
      const { viewport } = target;
      let hud = document.getElementById(HUD_ID);
      if (!hud || hud.parentElement !== viewport) {
        hud?.remove();
        hud = document.createElement('div');
        hud.id = HUD_ID;
        viewport.appendChild(hud);
      }
      hud.textContent = `${view.s.toFixed(view.s < 10 ? 1 : 0)}×`;
      hud.classList.add('visible');
      clearTimeout(hudTimer);
      hudTimer = setTimeout(() => hud.classList.remove('visible'), HUD_MS);
    }

    function watchStyle(target) {
      const { content } = target;
      if (observedContent === content) return;
      styleObserver?.disconnect();
      observedContent = content;
      styleObserver = new MutationObserver(() => {
        if (!isZoomed(view) || content.style.cssText === appliedStyle) return;
        if (!content.style.transform) {
          console.log(`${tag} transform was cleared by the page; reapplying`);
          applyView(target);
        }
        appliedStyle = content.style.cssText;
      });
      styleObserver.observe(content, { attributes: true, attributeFilter: ['style'] });
    }

    function watchFitToScreenClass(content) {
      const fit = content.classList.contains(fitToScreenClass);
      if (lastFitToScreen === null) {
        lastFitToScreen = fit;
      }
      if (classObserver && observedContent === content) return;
      classObserver?.disconnect();
      classObserver = new MutationObserver(() => {
        const nowFit = content.classList.contains(fitToScreenClass);
        if (nowFit === lastFitToScreen) return;
        lastFitToScreen = nowFit;
        if (isZoomed(view) || savedView) {
          console.log(`${tag} ${fitToScreenClass} toggled (${nowFit}); resetting zoom`);
          const t = getTarget();
          if (t) resetView(t, false);
        }
      });
      classObserver.observe(content, { attributes: true, attributeFilter: ['class'] });
    }

    // ---------- box overlay ----------

    function updateBox(viewport, x1, y1, x2, y2) {
      ensureStyles();
      let box = document.getElementById(BOX_ID);
      if (!box || box.parentElement !== viewport) {
        box?.remove();
        box = document.createElement('div');
        box.id = BOX_ID;
        viewport.appendChild(box);
      }
      const r = viewport.getBoundingClientRect();
      box.style.left = `${Math.min(x1, x2) - r.left}px`;
      box.style.top = `${Math.min(y1, y2) - r.top}px`;
      box.style.width = `${Math.abs(x2 - x1)}px`;
      box.style.height = `${Math.abs(y2 - y1)}px`;
    }

    function removeBox() {
      document.getElementById(BOX_ID)?.remove();
    }

    // ---------- event handlers ----------

    function wheelDeltaPixels(e) {
      if (e.deltaMode === WheelEvent.DOM_DELTA_LINE) return e.deltaY * LINE_HEIGHT_PX;
      if (e.deltaMode === WheelEvent.DOM_DELTA_PAGE) return e.deltaY * PAGE_DELTA_PX;
      return e.deltaY;
    }

    function onWheel(e) {
      if (e.altKey) return;
      // Allow plain mouse wheel to scroll inside open drawers/dialogs/menus.
      if (!(e.ctrlKey || e.metaKey) && inScrollableOverlay(e.target)) return;
      const target = getTarget();
      if (!target) return;
      const delta = wheelDeltaPixels(e);
      if (delta === 0) return;
      e.preventDefault();
      e.stopPropagation();
      const isPinch = (e.ctrlKey || e.metaKey) && !zoomModifierDown;
      const k = isPinch ? PINCH_ZOOM_K : WHEEL_ZOOM_K;
      const factor = Math.exp(-delta * k);
      if (targetAt(e.target)) {
        zoomAt(target, factor, e.clientX, e.clientY);
      } else {
        zoomAtCenter(target, factor);
      }
    }

    function onPointerDown(e) {
      if (drag || e.altKey || e.metaKey) return;
      const target = targetAt(e.target);
      if (!target) return;
      const plainAllowed = canPlainDrag(target, e.target);
      let mode = null;
      if (e.shiftKey && e.button === 0 && (plainAllowed || e.ctrlKey)) {
        mode = 'box';
      } else if (e.button === 1 && !e.shiftKey) {
        mode = 'pan';
      } else if (e.button === 0 && !e.shiftKey && (e.ctrlKey || plainAllowed)) {
        mode = 'pan';
      }
      if (!mode) return;
      if (mode === 'pan' && !canPan(target)) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      absorbNativeScroll(target);
      drag = {
        mode,
        target,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
      };
      if (mode === 'pan') {
        document.documentElement.setAttribute(PANNING_ATTR, '');
      }
      try {
        target.viewport.setPointerCapture(e.pointerId);
      } catch (_) {
        /* ignore */
      }
    }

    function onPointerMove(e) {
      if (!drag || e.pointerId !== drag.pointerId) return;
      e.preventDefault();
      e.stopPropagation();
      const { target } = drag;
      if (drag.mode === 'pan') {
        const f = contentFrame(target.content);
        view = clampView(target, {
          s: view.s,
          ox: view.ox + (e.clientX - drag.lastX) / f.w,
          oy: view.oy + (e.clientY - drag.lastY) / f.h,
        });
        applyView(target);
        drag.lastX = e.clientX;
        drag.lastY = e.clientY;
      } else {
        updateBox(target.viewport, drag.startX, drag.startY, e.clientX, e.clientY);
      }
    }

    function onPointerUp(e) {
      if (!drag || e.pointerId !== drag.pointerId) return;
      e.preventDefault();
      e.stopPropagation();
      const d = drag;
      drag = null;
      document.documentElement.removeAttribute(PANNING_ATTR);
      try {
        d.target.viewport.releasePointerCapture(e.pointerId);
      } catch (_) {
        /* ignore */
      }
      removeBox();
      const w = Math.abs(e.clientX - d.startX);
      const h = Math.abs(e.clientY - d.startY);
      if (e.type === 'pointercancel' || Math.max(w, h) < MIN_BOX_PX) return;
      swallowClicksUntil = performance.now() + SWALLOW_CLICK_MS;
      if (d.mode === 'pan') return;
      if (w < MIN_BOX_PX || h < MIN_BOX_PX) return;
      zoomToBox(d.target, d.startX, d.startY, e.clientX, e.clientY);
    }

    function onClick(e) {
      // In Chrome's standalone ImageDocument, clicking the <img> toggles
      // Chrome's built-in 100% zoom and inline width/height attributes.
      // Always suppress that native click handler in standalone mode.
      if (isStandaloneImageDoc() && e.target instanceof HTMLImageElement) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (performance.now() < swallowClicksUntil && targetAt(e.target)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }

    function onKeyDown(e) {
      if (e.isComposing || inTextField(e.target)) return;
      const target = getTarget();
      if (!target) return;
      if (e.key === 'x' && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        toggleReset(target);
        return;
      }
      if (e.altKey || e.metaKey) return;
      const zoomIn =
        e.code === 'Equal' || e.code === 'NumpadAdd' || e.key === '+' || e.key === '=';
      const zoomOut =
        e.code === 'Minus' || e.code === 'NumpadSubtract' || e.key === '-' || e.key === '_';
      if (!e.ctrlKey && (zoomIn || zoomOut)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        zoomAtCenter(target, zoomIn ? KEY_ZOOM_STEP : 1 / KEY_ZOOM_STEP);
        return;
      }
      const pan = KEY_PAN[e.key];
      if (pan && (e.ctrlKey || (!e.shiftKey && canPan(target)))) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!canPan(target)) return;
        absorbNativeScroll(target);
        view = clampView(target, {
          s: view.s,
          ox: view.ox - pan[0] * KEY_PAN_STEP,
          oy: view.oy - pan[1] * KEY_PAN_STEP,
        });
        applyView(target);
      }
    }

    function onResize() {
      if (!isZoomed(view)) return;
      const target = getTarget();
      if (!target) return;
      view = clampView(target, view);
      applyView(target);
    }

    function onUrlChange() {
      const key = urlKey();
      if (key === lastUrlKey) return;
      lastUrlKey = key;
      loggedTargetKind = null;
      lastFitToScreen = null;
      const target = getTarget();
      if (target && (isZoomed(view) || savedView)) {
        resetView(target, false);
      } else {
        view = { s: 1, ox: 0, oy: 0 };
        savedView = null;
      }
    }

    if (isStandaloneImageDoc()) {
      ensureStandaloneMode();
      window.addEventListener('DOMContentLoaded', ensureStandaloneMode, { once: true });
    }

    const syncZoomModifier = (e) => {
      zoomModifierDown = e.ctrlKey || e.metaKey;
    };
    window.addEventListener('keydown', syncZoomModifier, true);
    window.addEventListener('keyup', syncZoomModifier, true);
    window.addEventListener('mousemove', syncZoomModifier, true);
    window.addEventListener('blur', () => {
      zoomModifierDown = false;
    });
    window.addEventListener('resize', onResize);
    window.addEventListener('urlchange', onUrlChange);

    document.addEventListener('wheel', onWheel, { capture: true, passive: false });
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerUp, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('dblclick', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);

    return {
      reset: () => {
        const t = getTarget();
        if (t) resetView(t, false);
      },
    };
  }

  return { create, isStandaloneImageDoc };
})();
