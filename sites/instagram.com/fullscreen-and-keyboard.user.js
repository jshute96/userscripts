// ==UserScript==
// @name         Instagram: Fullscreen images and video, video seek bar, keyboard shortcuts
// @namespace    https://github.com/jshute96/userscripts
// @version      0.1.0
// @description  View images and videos full screen, add a progress bar on videos, and add keyboard shortcuts to step through posts
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://www.instagram.com/*
// @require      https://raw.githubusercontent.com/jshute96/userscripts/main/lib/keyboard-shortcuts.js
// @grant        GM_addStyle
// @noframes
// ==/UserScript==

// Keyboard shortcuts:
//   f                  Fullscreen on / off
//   s                  Sound on / off
//   Space              Play / pause
//   j / k              Next / previous photo or video in a multi-photo
//                      post, and on into the next / previous post past
//                      either end
//   h / l              Next / previous post
//   ?                  Show all shortcuts
//
// Previous / next post use Instagram's own arrows in the post popup, and
// elsewhere the order of the last grid of posts seen.
//
// They act on the video or photo that's fullscreen, else the one under
// the mouse, else the one most visible on screen.

(function () {
  'use strict';

  const TAG = '[ig-video]';
  const PREFIX = 'jshute-ig-video';
  // On Instagram's overlay layer, once we've added our controls to it.
  const ATTACHED_ATTR = `data-${PREFIX}`;
  // On a photo's media box, once we've added our button to it.
  const IMAGE_ATTR = `data-${PREFIX}-image`;
  // On a multi-photo post's media box while it's showing a video, whose
  // own controls take over.
  const VIDEO_SLIDE_ATTR = `data-${PREFIX}-video-slide`;
  // On <html> while it's fullscreen for us.
  const FS_ATTR = `data-${PREFIX}-fullscreen`;
  // On a video's player container while it's pinned to fill the screen,
  // and on the ancestors whose styles would stop it.
  const PINNED_ATTR = `data-${PREFIX}-pinned`;
  const UNTRANSFORM_ATTR = `data-${PREFIX}-untransform`;
  // How far up from a <video> or <img> to look.
  const MAX_ANCESTORS = 12;
  // Smaller images are avatars and icons, not post photos.
  const MIN_IMAGE_SIZE = 200;
  // Height / width past which an image must be a video's poster: photos
  // are at most 3:4 (1.33), and Reels are 9:16 (1.78).
  const MAX_PHOTO_ASPECT = 1.5;
  // How long to wait for a carousel or post to change after clicking its
  // arrow, before giving up on following it in fullscreen.
  const FOLLOW_WAIT_MS = 8000;
  // HTMLMediaElement.readyState once a frame can be drawn.
  const HAVE_CURRENT_DATA = 2;
  // Fullscreen viewer arrows: sizes, distance from the screen edge, and
  // gap between the photo arrows and the image or post arrows.
  const POST_ARROW_SIZE = 44;
  const SLIDE_ARROW_SIZE = 32;
  const VIEWER_EDGE = 16;
  const VIEWER_GAP = 16;
  // Report once if videos are on the page but none could be attached.
  const STILL_WAITING_MS = 10000;

  const ICONS = {
    full: '<svg viewBox="0 0 24 24"><path d="M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>',
    left: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>',
    right: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4"/></svg>',
    unfull: '<svg viewBox="0 0 24 24"><path d="M9 3v6H3M21 9h-6V3M15 21v-6h6M3 15h6v6" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>',
  };

  GM_addStyle(`
    .${PREFIX}-bar {
      position: absolute; left: 0; right: 0; bottom: 0; height: 10px;
      z-index: 10; cursor: pointer; touch-action: none;
    }
    .${PREFIX}-track {
      position: absolute; left: 0; right: 0; bottom: 0; height: 3px;
      background: rgba(255, 255, 255, 0.35);
      transition: height 0.1s;
    }
    .${PREFIX}-bar:hover .${PREFIX}-track,
    .${PREFIX}-bar.${PREFIX}-dragging .${PREFIX}-track { height: 8px; }
    .${PREFIX}-fill {
      position: absolute; left: 0; top: 0; bottom: 0; width: 0;
      background: #fff;
    }
    .${PREFIX}-time {
      position: absolute; bottom: 14px; transform: translateX(-50%);
      padding: 2px 6px; border-radius: 4px; white-space: nowrap;
      background: rgba(0, 0, 0, 0.7); color: #fff;
      font: 12px/1.3 system-ui, sans-serif; pointer-events: none;
      display: none;
    }
    .${PREFIX}-bar:hover .${PREFIX}-time,
    .${PREFIX}-bar.${PREFIX}-dragging .${PREFIX}-time { display: block; }
    /* On videos, left of Instagram's mute button: 28px square, 12px in
       from the bottom-right corner. (The top edge is taken by the
       poster's name and menu in the home feed.) On photos, in the
       corner itself. */
    .${PREFIX}-buttons {
      position: absolute; bottom: 12px; right: 48px; z-index: 10;
      display: flex; gap: 8px;
    }
    [${IMAGE_ATTR}] > .${PREFIX}-buttons { right: 12px; }
    [${VIDEO_SLIDE_ATTR}] > .${PREFIX}-buttons { display: none; }
    .${PREFIX}-buttons button {
      width: 28px; height: 28px; padding: 0; border: 0; border-radius: 50%;
      background: rgba(43, 48, 54, 0.8); color: #fff; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
    }
    .${PREFIX}-buttons button:hover { background: rgba(80, 86, 94, 0.9); }
    .${PREFIX}-buttons svg { width: 16px; height: 16px; display: block; }

    html[${FS_ATTR}] { overflow: hidden !important; }
    [${PINNED_ATTR}] {
      position: fixed !important; inset: 0 !important;
      width: 100vw !important; height: 100vh !important;
      z-index: 2147483000 !important; background: #000 !important;
      transform: none !important;
      transition: none !important; animation: none !important;
    }
    [${PINNED_ATTR}] video { object-fit: contain !important; }
    /* Instagram's poster lingers a moment over a video that's already
       drawing, and pinned it fills the screen, cropped (cover). */
    [${PINNED_ATTR}] img { visibility: hidden !important; }
    [${UNTRANSFORM_ATTR}] {
      transform: none !important; filter: none !important;
      perspective: none !important; backdrop-filter: none !important;
      contain: none !important; will-change: auto !important;
      /* Or the carousel's own transition animates the change. */
      transition: none !important; animation: none !important;
    }

    .${PREFIX}-viewer {
      position: fixed; inset: 0; z-index: 2147483000; background: #000;
      display: flex; align-items: center; justify-content: center;
    }
    .${PREFIX}-nav {
      position: fixed; inset: 0; z-index: 2147483001; pointer-events: none;
    }
    .${PREFIX}-viewer[hidden], .${PREFIX}-nav[hidden] { display: none; }
    .${PREFIX}-nav .${PREFIX}-arrow { pointer-events: auto; }
    .${PREFIX}-viewer img, .${PREFIX}-viewer canvas {
      width: 100%; height: 100%; object-fit: contain; display: block;
    }
    .${PREFIX}-viewer [hidden] { display: none; }
    .${PREFIX}-arrow {
      position: absolute; top: 50%; transform: translateY(-50%);
      padding: 0; border: 0; border-radius: 50%; cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      color: #000; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
    }
    .${PREFIX}-arrow[hidden] { display: none; }
    .${PREFIX}-slide {
      width: ${SLIDE_ARROW_SIZE}px; height: ${SLIDE_ARROW_SIZE}px;
      background: rgba(255, 255, 255, 0.75);
    }
    .${PREFIX}-post {
      width: ${POST_ARROW_SIZE}px; height: ${POST_ARROW_SIZE}px;
      background: #fff;
    }
    .${PREFIX}-arrow svg { width: 55%; height: 55%; display: block; }
  `);

  // The overlay layer Instagram draws over each video: a role="group"
  // div, in a sibling branch of the video's, covering the same area.
  // Returns [container, overlay], where the container holds both.
  function findPlayer(video) {
    let el = video.parentElement;
    for (let i = 0; el && i < MAX_ANCESTORS; i++, el = el.parentElement) {
      // Past this player's own container: any group from here on may
      // belong to a neighboring video (Reels feed, carousels).
      if (el.querySelectorAll('video').length > 1) return null;
      const group = [...el.querySelectorAll('[role="group"]')]
        .find(g => !g.contains(video));
      if (group) return [el, group];
    }
    return null;
  }

  // A post's media box: the outermost ancestor the same size as one
  // photo or video. For a multi-photo post (a "carousel") it's the frame
  // around the sliding <ul> of slides, which also holds its previous /
  // next arrows. The <ul> and its wrapper are 1px wide, so the frame's
  // size is taken from the first ancestor past them. It can be wider
  // than the slides themselves (in the post popup: 748px slides in a
  // 775px frame), so it's measured from the <ul>, not the photo.
  function mediaBox(el) {
    const ul = el.closest('li')?.parentElement;
    const start = ul?.tagName === 'UL' ? ul : el;
    let size = start === el ? el.getBoundingClientRect() : null;
    let box = null;
    let node = start.parentElement;
    for (let i = 0; node && i < MAX_ANCESTORS; i++, node = node.parentElement) {
      const r = node.getBoundingClientRect();
      if (r.width < 2) continue;
      if (!size) size = r;
      if (Math.abs(r.width - size.width) > 2 || Math.abs(r.height - size.height) > 2) break;
      box = node;
    }
    return box;
  }

  // The slide showing in a carousel's box: the <li> across its middle.
  // A single photo is its own slide.
  function currentSlide(box) {
    const ul = box.querySelector('ul');
    if (!ul) return box;
    const r = box.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    for (const li of ul.children) {
      const lr = li.getBoundingClientRect();
      if (lr.width > 2 && lr.left <= cx && lr.right >= cx) return li;
    }
    return null;
  }

  // A carousel's previous / next arrows. Their labels are translated, so
  // tell them apart by position: vertically centered, at the left or
  // right edge of the box.
  function carouselArrows(box) {
    const ul = box.querySelector('ul');
    const r = box.getBoundingClientRect();
    const arrows = { prev: null, next: null };
    if (!ul) return arrows;
    for (const b of box.querySelectorAll('button')) {
      if (ul.contains(b) || b.closest(`.${PREFIX}-buttons`)) continue;
      const br = b.getBoundingClientRect();
      if (!br.width) continue;
      const cx = (br.left + br.right) / 2;
      const cy = (br.top + br.bottom) / 2;
      if (cy < r.top + r.height * 0.3 || cy > r.top + r.height * 0.7) continue;
      if (cx < r.left + r.width * 0.25) arrows.prev = b;
      else if (cx > r.right - r.width * 0.25) arrows.next = b;
    }
    return arrows;
  }

  // The carousel box around a video, if it's one slide of several.
  function carouselOf(el) {
    const li = el.closest('li');
    const ul = li?.closest('ul');
    if (!ul) return null;
    const box = mediaBox(li);
    return box && box.contains(ul) ? box : null;
  }

  function formatTime(s) {
    if (!isFinite(s)) return '0:00';
    s = Math.floor(s);
    const h = Math.floor(s / 3600);
    const m = Math.floor(s / 60) % 60;
    const ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  }

  // Keep our clicks and drags from reaching Instagram's handlers, which
  // would pause, mute or open the post.
  function swallow(el) {
    for (const type of ['click', 'dblclick', 'mousedown', 'mouseup',
      'pointerdown', 'pointerup', 'touchstart', 'touchend']) {
      el.addEventListener(type, e => e.stopPropagation());
    }
  }

  function makeFullButton(onClick) {
    const buttons = document.createElement('div');
    buttons.className = `${PREFIX}-buttons`;
    const btn = document.createElement('button');
    buttons.append(btn);
    swallow(buttons);
    btn.addEventListener('click', onClick);
    return [buttons, btn];
  }

  // ---------------------------------------------------------------
  // Videos
  // ---------------------------------------------------------------

  // Everything we've attached, for the progress loop.
  const players = new Set();

  function attachVideo(video) {
    const found = findPlayer(video);
    if (!found) return false;
    const [container, overlay] = found;
    if (overlay.hasAttribute(ATTACHED_ATTR)) return true;
    overlay.setAttribute(ATTACHED_ATTR, '');

    const bar = document.createElement('div');
    bar.className = `${PREFIX}-bar`;
    bar.innerHTML = `<div class="${PREFIX}-track"><div class="${PREFIX}-fill"></div></div>` +
      `<div class="${PREFIX}-time"></div>`;
    const fill = bar.querySelector(`.${PREFIX}-fill`);
    const time = bar.querySelector(`.${PREFIX}-time`);
    swallow(bar);

    // Instagram may swap the <video> inside a player, so look it up
    // each time rather than holding on to the first one.
    const player = { kind: 'video', container, overlay, fill,
      video: () => container.querySelector('video') };
    const [buttons, fullBtn] = makeFullButton(() => toggleFullscreen(player));
    Object.assign(player, { buttons, fullBtn });
    overlay.append(bar, buttons);
    players.add(player);
    overlay.addEventListener('mouseenter', () => alignButtons(player));
    new ResizeObserver(() => alignButtons(player)).observe(overlay);

    function fractionAt(e) {
      const r = bar.getBoundingClientRect();
      return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    }
    function showTime(e) {
      const v = player.video();
      if (!v) return;
      const f = fractionAt(e);
      time.textContent = `${formatTime(f * v.duration)} / ${formatTime(v.duration)}`;
      time.style.left = `${Math.min(Math.max(f * 100, 8), 92)}%`;
    }
    function seek(e) {
      const v = player.video();
      if (!v || !isFinite(v.duration)) return;
      v.currentTime = fractionAt(e) * v.duration;
      update(player);
    }
    bar.addEventListener('pointermove', e => {
      showTime(e);
      if (bar.hasPointerCapture(e.pointerId)) seek(e);
    });
    bar.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      bar.setPointerCapture(e.pointerId);
      bar.classList.add(`${PREFIX}-dragging`);
      seek(e);
      showTime(e);
    });
    const endDrag = e => {
      if (!bar.hasPointerCapture(e.pointerId)) return;
      bar.releasePointerCapture(e.pointerId);
      bar.classList.remove(`${PREFIX}-dragging`);
      console.log(TAG, 'seeked to', formatTime(player.video()?.currentTime));
    };
    bar.addEventListener('pointerup', endDrag);
    bar.addEventListener('pointercancel', endDrag);

    updateButtons(player);
    update(player);
    // The video may already be playing, with its play event long gone.
    kick();
    console.log(TAG, 'attached controls to a video');
    return true;
  }

  function togglePlay(player) {
    const v = player.video();
    if (!v) return;
    if (v.paused) {
      v.play().catch(err => console.log(TAG, 'play failed:', err.message));
      console.log(TAG, 'play');
    } else {
      v.pause();
      console.log(TAG, 'pause');
    }
  }

  // Click Instagram's own mute button, inside its volume slider, so its
  // icon and remembered mute setting stay in step.
  function toggleSound(player) {
    const v = player.video();
    const btn = player.overlay.querySelector('[role="slider"] [role="button"]');
    if (btn) {
      btn.click();
    } else if (v) {
      console.log(TAG, 'mute button not found, setting muted directly');
      v.muted = !v.muted;
    }
    console.log(TAG, v?.muted ? 'sound off' : 'sound on');
  }

  // Line our buttons up to the left of Instagram's mute button, whose
  // offset from the corner varies by page. The stylesheet's position is
  // the fallback when it's missing.
  function alignButtons(p) {
    const mute = p.overlay.querySelector('[role="slider"] [role="button"]');
    if (!mute) return;
    const o = p.overlay.getBoundingClientRect();
    const m = mute.getBoundingClientRect();
    if (!m.width) return;
    p.buttons.style.bottom = `${o.bottom - m.bottom}px`;
    p.buttons.style.right = `${o.right - m.left + 8}px`;
  }

  function update(p) {
    const v = p.video();
    const f = v && v.duration > 0 ? v.currentTime / v.duration : 0;
    p.fill.style.width = `${f * 100}%`;
  }

  // Redraw progress every frame while any video plays, and stop the
  // loop when none do.
  let looping = false;
  function loop() {
    let playing = false;
    for (const p of players) {
      if (!p.overlay.isConnected) {
        players.delete(p);
        continue;
      }
      const v = p.video();
      if (v && !v.paused) playing = true;
      update(p);
    }
    looping = playing;
    if (playing) requestAnimationFrame(loop);
  }
  function kick() {
    if (!looping) {
      looping = true;
      requestAnimationFrame(loop);
    }
  }
  // Media events don't bubble, but they do pass through the capture phase.
  for (const type of ['play', 'seeked', 'loadedmetadata']) {
    document.addEventListener(type, kick, true);
  }

  // ---------------------------------------------------------------
  // Photos
  // ---------------------------------------------------------------

  const photos = new Set();

  function isPostPhoto(img) {
    if (img.closest(`a, [role="group"], .${PREFIX}-viewer`)) return false;
    if (!img.closest('article, main, [role="dialog"]')) return false;
    const r = img.getBoundingClientRect();
    return r.width >= MIN_IMAGE_SIZE && r.height >= MIN_IMAGE_SIZE &&
      !isVideoPoster(img, r);
  }

  // A video's poster, shown in its place until the video loads, is laid
  // out just like a photo. Tell it by Instagram's generated alt text
  // (English only), or by shape: photos are cropped to at most 3:4
  // (portrait), so anything much taller is a video's.
  function isVideoPoster(img, r) {
    return /^Video by /.test(img.alt) || r.height > r.width * MAX_PHOTO_ASPECT;
  }

  function attachPhoto(img) {
    if (!isPostPhoto(img)) return;
    const box = mediaBox(img);
    if (!box || box.closest(`[${IMAGE_ATTR}]`)) return;
    // A scan during page layout can settle on a box inside the final
    // one; the outer one, which holds the carousel arrows, wins.
    for (const p of photos) {
      if (box.contains(p.box)) {
        p.buttons.remove();
        p.box.removeAttribute(IMAGE_ATTR);
        photos.delete(p);
      }
    }
    box.setAttribute(IMAGE_ATTR, '');
    if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
    const photo = { kind: 'image', box };
    const [buttons, fullBtn] = makeFullButton(() => toggleFullscreen(photo));
    Object.assign(photo, { buttons, fullBtn });
    box.append(buttons);
    photos.add(photo);
    updateButtons(photo);
    console.log(TAG, 'attached fullscreen button to a photo');
  }

  // Which slide a photo's box shows can change under it; hide our photo
  // button while it's a video, which has its own.
  function updatePhotoSlide(photo) {
    const slide = currentSlide(photo.box);
    photo.box.toggleAttribute(VIDEO_SLIDE_ATTR, !!slide?.querySelector('video'));
  }

  // The largest version of a photo in its srcset.
  function bestSrc(img) {
    let best = img.currentSrc || img.src;
    let bestW = 0;
    for (const m of (img.getAttribute('srcset') || '').matchAll(/(\S+)\s+(\d+)w/g)) {
      if (+m[2] > bestW) {
        best = m[1];
        bestW = +m[2];
      }
    }
    return best;
  }

  // ---------------------------------------------------------------
  // Fullscreen
  // ---------------------------------------------------------------
  // Fullscreen is the whole page (<html>), entered once. What it shows
  // is drawn over the page: a photo in a viewer of our own, a video by
  // pinning its player to fill the screen. Stepping to another photo,
  // video or post only swaps that, so it never drops out of fullscreen,
  // as it would if Instagram's own element were fullscreen and got
  // replaced. (A viewer, rather than the page's photo, because
  // Instagram's carousel sizes each slide by its aspect ratio at the
  // page's width and overflows the screen.)
  //
  // Over either sits a layer with copies of whichever of Instagram's
  // arrows are active: previous / next photo just outside the media,
  // previous / next post at the screen edges.

  // Set while fullscreen is ours: the media box (or lone video's
  // container) being shown.
  let fs = null;
  // Set while the screen shows a stand-in (a held video frame, or the
  // last photo while the next decodes), so the previous / next photo
  // arrows, which are placed by the media's size, wait for the real one.
  let settling = false;
  let viewer = null;
  let nav = null;
  // Ancestors of the pinned player whose styles we've neutralized.
  let untransformed = [];

  function makeArrow(cls, dir, title, onClick) {
    const b = document.createElement('button');
    b.className = `${PREFIX}-arrow ${PREFIX}-${cls}`;
    b.innerHTML = dir < 0 ? ICONS.left : ICONS.right;
    b.title = title;
    b.hidden = true;
    b.addEventListener('click', e => {
      e.stopPropagation();
      onClick();
    });
    return b;
  }

  // Built on first use, and hung off <html>, so a site that replaces
  // <body> can't take them along.
  function buildLayers() {
    if (viewer) return;
    const el = document.createElement('div');
    el.className = `${PREFIX}-viewer`;
    el.hidden = true;
    const im = document.createElement('img');
    const frame = document.createElement('canvas');
    frame.hidden = true;
    el.append(im, frame);
    viewer = { el, im, frame };

    const navEl = document.createElement('div');
    navEl.className = `${PREFIX}-nav`;
    navEl.hidden = true;
    const arrows = {
      slidePrev: makeArrow('slide', -1, 'Previous photo (k)', () => step(-1)),
      slideNext: makeArrow('slide', 1, 'Next photo (j)', () => step(1)),
      postPrev: makeArrow('post', -1, 'Previous post (l)', () => goPost(-1)),
      postNext: makeArrow('post', 1, 'Next post (h)', () => goPost(1)),
    };
    arrows.postPrev.style.left = `${VIEWER_EDGE}px`;
    arrows.postNext.style.right = `${VIEWER_EDGE}px`;
    navEl.append(...Object.values(arrows));
    nav = { el: navEl, arrows };
    document.documentElement.append(el, navEl);
  }

  function enterFullscreen(t) {
    const box = t.kind === 'video' ? carouselOf(t.container) || t.container : t.box;
    buildLayers();
    document.documentElement.requestFullscreen().then(
      () => {
        fs = { box };
        document.documentElement.setAttribute(FS_ATTR, '');
        // Chrome takes Esc to leave fullscreen before the page sees it,
        // so Esc couldn't close the ? help first. Locked, Esc comes to
        // the page (see the keydown listener below); holding it still
        // leaves fullscreen.
        navigator.keyboard?.lock(['Escape']).catch(() => {});
        nav.el.hidden = false;
        if (!showSlide(box)) cover();
        console.log(TAG, 'entered fullscreen');
        for (const u of [...players, ...photos]) updateButtons(u);
      },
      err => console.log(TAG, 'fullscreen failed:', err.message));
  }

  function leaveFullscreen() {
    navigator.keyboard?.unlock();
    unpin();
    viewer.el.hidden = true;
    viewer.im.removeAttribute('src');
    viewer.frame.hidden = true;
    nav.el.hidden = true;
    document.documentElement.removeAttribute(FS_ATTR);
    fs = null;
    settling = false;
    console.log(TAG, 'left fullscreen');
  }

  function toggleFullscreen(t) {
    if (document.fullscreenElement) document.exitFullscreen();
    else enterFullscreen(t);
  }

  document.addEventListener('fullscreenchange', () => {
    if (fs && document.fullscreenElement !== document.documentElement) {
      leaveFullscreen();
    }
    for (const t of [...players, ...photos]) updateButtons(t);
  });

  function isFullscreen(t) {
    if (!fs) return false;
    return t.kind === 'video'
      ? t.container.hasAttribute(PINNED_ATTR)
      : fs.box === t.box && !viewer.el.hidden;
  }

  // Pin a video's player to fill the screen. Ancestors with a transform
  // (each carousel slide has one), filter or containment would trap a
  // fixed-position element inside their own box, so those are
  // neutralized until it's unpinned.
  function pin(player) {
    if (player.container.hasAttribute(PINNED_ATTR)) return;
    unpin();
    for (let el = player.container.parentElement; el && el !== document.documentElement;
      el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (cs.transform !== 'none' || cs.filter !== 'none' ||
          cs.perspective !== 'none' || cs.backdropFilter !== 'none' ||
          /paint|layout|strict|content/.test(cs.contain) ||
          /transform|filter|perspective/.test(cs.willChange)) {
        el.setAttribute(UNTRANSFORM_ATTR, '');
        untransformed.push(el);
      }
    }
    player.container.setAttribute(PINNED_ATTR, '');
  }

  function unpin() {
    for (const el of document.querySelectorAll(`[${PINNED_ATTR}]`)) {
      el.removeAttribute(PINNED_ATTR);
    }
    for (const el of untransformed) el.removeAttribute(UNTRANSFORM_ATTR);
    untransformed = [];
  }

  // Black out the page while waiting for the next media to show, after
  // taking down a pinned video. (A photo stays up until the next one is
  // ready instead.) The arrows go too, as there's nothing to place them
  // by.
  function cover() {
    unpin();
    photoToken++;
    viewer.im.removeAttribute('src');
    viewer.frame.hidden = true;
    viewer.el.hidden = false;
    nav.el.hidden = true;
  }

  // Leaving a pinned video: take it down, and hold its current frame in
  // the viewer until the next media shows. (Its stream comes in through
  // the page's own code, so the canvas isn't cross-origin tainted.)
  // Black if the frame can't be had.
  function freezeVideo() {
    const v = document.querySelector(`[${PINNED_ATTR}] video`);
    if (!v) return;
    const { frame } = viewer;
    try {
      frame.width = v.videoWidth;
      frame.height = v.videoHeight;
      frame.getContext('2d').drawImage(v, 0, 0);
    } catch (e) {
      console.log(TAG, 'could not hold the video frame:', e.message);
      cover();
      return;
    }
    unpin();
    photoToken++;
    settling = true;
    frame.hidden = false;
    viewer.im.hidden = true;
    viewer.size = [v.videoWidth, v.videoHeight];
    viewer.el.hidden = false;
    updateNav();
  }

  // Show a page photo in the viewer. The copy the page already loaded
  // shows at once; the full-size original, which can take a while to
  // arrive, replaces it once loaded.
  let photoToken = 0;
  // Each version is decoded off-screen before it's swapped in, since
  // swapping in an undecoded image blanks the viewer until it's ready.
  // Whatever was showing stays up meanwhile.
  function showPhoto(img) {
    const token = ++photoToken;
    settling = true;
    const quick = img.currentSrc || img.src || null;
    const best = bestSrc(img);
    let shownBest = false;
    const swapIn = (src, isBest) => {
      const pre = new Image();
      pre.src = src;
      pre.decode().then(() => {
        if (token !== photoToken || (shownBest && !isBest)) return;
        unpin();
        viewer.im.src = src;
        viewer.im.hidden = false;
        viewer.frame.hidden = true;
        // The <img> reports its new size only once it has loaded it.
        viewer.size = [pre.naturalWidth, pre.naturalHeight];
        viewer.el.hidden = false;
        settling = false;
        if (isBest) shownBest = true;
        updateNav();
      }, () => {});
    };
    if (quick) swapIn(quick, !best || best === quick);
    if (best && best !== quick) swapIn(best, true);
  }

  // The slide next to the showing one in a carousel, by position.
  function neighborSlide(box, dir) {
    const cur = currentSlide(box);
    if (!cur || cur === box) return null;
    const cr = cur.getBoundingClientRect();
    let best = null;
    let bestDist = Infinity;
    for (const li of cur.parentElement.children) {
      const r = li.getBoundingClientRect();
      if (r.width < 2) continue;
      const dist = (r.left - cr.left) * dir;
      if (dist > 1 && dist < bestDist) {
        best = li;
        bestDist = dist;
      }
    }
    return best;
  }

  // Show whatever a media box (or a lone video's container) has in view.
  // Returns false if it isn't ready yet.
  //
  // With `ready`, a video isn't shown until it has a frame to show (the
  // viewer keeps whatever it has meanwhile), so a caller polling for
  // the next media doesn't pin a black player.
  function showSlide(box, { ready = false } = {}) {
    if (!fs) return false;
    const slide = currentSlide(box) || box;
    const player = [...players].find(p => slide.contains(p.container) || p.container.contains(slide));
    if (player && (slide.querySelector('video') || player.container === box)) {
      const v = player.video();
      if (ready && !(v?.readyState >= HAVE_CURRENT_DATA)) return false;
      if (player.container.hasAttribute(PINNED_ATTR)) return true;
      pin(player);
      settling = false;
      // Keep the viewer's stand-in over it until the pinned player has
      // been drawn in place. (This also cancels any photo on its way.)
      const token = ++photoToken;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (token === photoToken && player.container.hasAttribute(PINNED_ATTR)) {
          viewer.el.hidden = true;
        }
      }));
    } else {
      if (slide.querySelector('video')) return false;
      const img = [...slide.querySelectorAll('img')].find(isPostPhoto) ||
        slide.querySelector('img');
      if (!img) return false;
      unpin();
      showPhoto(img);
      viewer.el.hidden = false;
    }
    fs.box = box;
    nav.el.hidden = false;
    updateNav();
    return true;
  }

  // Show the arrows Instagram has active, with the previous / next photo
  // ones just outside the media as drawn (object-fit: contain), but
  // clear of the post arrows when the media is wide.
  function updateNav() {
    if (!fs) return;
    const { arrows } = nav;
    const slide = fs.box.isConnected ? carouselArrows(fs.box) : {};
    arrows.slidePrev.hidden = settling || !slide.prev;
    arrows.slideNext.hidden = settling || !slide.next;
    arrows.postPrev.hidden = !canGoPost(-1);
    arrows.postNext.hidden = !canGoPost(1);
    const v = document.querySelector(`[${PINNED_ATTR}] video`);
    const [w, h] = v ? [v.videoWidth, v.videoHeight] : viewer.size || [0, 0];
    const W = innerWidth;
    const H = innerHeight;
    // Size not known yet (a photo still loading): leave them where
    // they were rather than bunching them in the middle.
    if (!w || !h) return;
    const scale = Math.min(W / w, H / h);
    const margin = (W - w * scale) / 2;
    const offset = Math.max(margin - VIEWER_GAP - SLIDE_ARROW_SIZE,
      VIEWER_EDGE + POST_ARROW_SIZE + VIEWER_GAP);
    arrows.slidePrev.style.left = `${offset}px`;
    arrows.slideNext.style.right = `${offset}px`;
  }

  window.addEventListener('resize', () => updateNav());

  // The post popup's previous / next post arrows: buttons in the dialog
  // but outside the post's <article>, vertically centered at the screen
  // edges. On a post's own page there are none.
  function postArrows() {
    const arrows = { prev: null, next: null };
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find(d => d.querySelector('article'));
    if (!dialog) return arrows;
    for (const b of dialog.querySelectorAll('button, [role="button"]')) {
      if (b.closest('article')) continue;
      const r = b.getBoundingClientRect();
      if (!r.width) continue;
      const cx = (r.left + r.right) / 2;
      const cy = (r.top + r.bottom) / 2;
      if (cy < innerHeight * 0.3 || cy > innerHeight * 0.7) continue;
      if (cx < innerWidth * 0.15) arrows.prev = b;
      else if (cx > innerWidth * 0.85) arrows.next = b;
    }
    return arrows;
  }

  // ---------------------------------------------------------------
  // Stepping through carousels and posts
  // ---------------------------------------------------------------

  // Poll until `ready()` is true. If it never is, go back to what was
  // showing, or leave fullscreen if that's gone too.
  let following = 0;
  function follow(ready, what) {
    const start = Date.now();
    const was = fs?.box;
    following++;
    const tick = () => {
      if (!fs || ready()) {
        following--;
        return;
      }
      if (Date.now() - start < FOLLOW_WAIT_MS) {
        setTimeout(tick, 50);
        return;
      }
      following--;
      console.log(TAG, `lost track of the ${what} after moving`);
      if (!(was?.isConnected && showSlide(was))) document.exitFullscreen();
    };
    setTimeout(tick, 50);
  }

  // What a media box has in view, to tell when it's changed: Instagram
  // changes the URL before it swaps in the new post, and may reuse the
  // same elements for it.
  function mediaSig(box) {
    if (!box) return null;
    const slide = currentSlide(box) || box;
    const v = slide.querySelector('video');
    if (v) return `v:${v.src}`;
    const img = [...slide.querySelectorAll('img')].find(isPostPhoto) ||
      slide.querySelector('img');
    return img ? `i:${img.currentSrc || img.src}` : null;
  }

  // If what's showing in fullscreen is taken off the page (Instagram
  // replaced it), show whatever the post has now, or black until it has
  // something.
  let recovering = false;
  function recover() {
    if (!fs || recovering) return;
    // Showing nothing: a pinned player that Instagram took off the page.
    const blank = viewer.el.hidden && !document.querySelector(`[${PINNED_ATTR}]`);
    if (following) {
      // Following finds the next media itself; just don't show the page.
      if (blank) cover();
      return;
    }
    if (fs.box.isConnected && !blank) {
      // Showing a still (a poster, say) where the slide now has a video:
      // switch to the video.
      const slide = currentSlide(fs.box) || fs.box;
      if (!viewer.el.hidden && slide.querySelector('video') &&
          !document.querySelector(`[${PINNED_ATTR}]`)) {
        showSlide(fs.box, { ready: true });
      }
      return;
    }
    recovering = true;
    try {
      const box = postMediaBox();
      if (box && showSlide(box, { ready: true })) {
        console.log(TAG, 'fullscreen media replaced, showing the new one');
      } else if (viewer.im.getAttribute('src') || document.querySelector(`[${PINNED_ATTR}]`)) {
        cover();
      }
    } finally {
      recovering = false;
    }
  }

  // j/k: step through a carousel with its own arrows,
  // spilling over into the previous / next post past either end (or on
  // a single photo). In fullscreen, follow to the new photo or video.
  function step(dir) {
    const t = activeTarget();
    if (!t) return;
    const box = t.kind === 'video' ? carouselOf(t.container) : t.box;
    const arrow = box && carouselArrows(box)[dir > 0 ? 'next' : 'prev'];
    if (!arrow) {
      goPost(dir);
      return;
    }
    // A pinned player has its slide's transform switched off, which
    // would confuse both Instagram's carousel and currentSlide().
    if (fs) freezeVideo();
    const before = currentSlide(box);
    // A neighboring photo is usually loaded already: show it now, rather
    // than after Instagram's slide animation.
    const next = fs && neighborSlide(box, dir);
    // (Loaded or not: showPhoto() starts on it now, rather than after the
    // carousel's animation, and keeps the current photo up meanwhile.)
    const nextImg = next && !next.querySelector('video') &&
      [...next.querySelectorAll('img')].find(i => i.currentSrc || i.src);
    arrow.click();
    console.log(TAG, dir > 0 ? 'next slide' : 'previous slide');
    if (!fs) return;
    if (nextImg) {
      showPhoto(nextImg);
      viewer.el.hidden = false;
      nav.el.hidden = false;
      // Mid-animation the carousel still shows the old slide; keep
      // recover() from acting on that until it arrives.
      follow(() => currentSlide(box) === next, 'carousel');
      return;
    }
    follow(() => {
      const now = currentSlide(box);
      return now && now !== before && showSlide(box, { ready: true });
    }, 'carousel');
  }

  // Previous / next post, with the popup's own arrows. Returns false
  // where there are none (a post's own page, or the end of the list).
  function goPost(dir) {
    const arrow = postArrows()[dir > 0 ? 'next' : 'prev'];
    const href = arrow ? null : listNeighbor(dir);
    if (!arrow && !href) {
      console.log(TAG, `no ${dir > 0 ? 'next' : 'previous'} post`);
      return false;
    }
    const fromPath = location.pathname;
    if (fs) freezeVideo();
    if (arrow) {
      arrow.click();
    } else {
      // Instagram's router follows the history, as for back / forward.
      history.pushState(null, '', href);
      dispatchEvent(new PopStateEvent('popstate', { state: null }));
    }
    console.log(TAG, dir > 0 ? 'next post' : 'previous post');
    if (fs) followPost(fromPath);
    return true;
  }

  // In fullscreen, show the new post once the URL has moved on from
  // `fromPath` and its media is on the page.
  function followPost(fromPath) {
    const oldSig = mediaSig(postMediaBox());
    follow(() => {
      if (location.pathname === fromPath) return false;
      const box = postMediaBox();
      return !!box && mediaSig(box) !== oldSig && showSlide(box, { ready: true });
    }, 'post');
  }

  function canGoPost(dir) {
    return !!(postArrows()[dir > 0 ? 'next' : 'prev'] || listNeighbor(dir));
  }

  // Where Instagram has no post arrows (a post's own page), previous /
  // next post go by the last grid of posts seen: a profile, or another
  // grid page. It's kept for the tab's session, so it survives a reload.
  const POST_LIST_KEY = `${PREFIX}-posts`;
  const POST_HREF = /^(?:\/[\w.]+)?\/(?:p|reel)\/([\w-]+)\/?$/;
  let postList = null;
  try {
    postList = JSON.parse(sessionStorage.getItem(POST_LIST_KEY));
  } catch (e) {
    // Unavailable or unreadable: start without one.
  }

  function currentPostId() {
    return location.pathname.match(/\/(?:p|reel)\/([\w-]+)/)?.[1] || null;
  }

  // Record the grid on a page that isn't a post, appending posts as more
  // load in. (A post page's own "More posts" grid isn't a sequence the
  // post belongs to, so it's left out.)
  function recordPostList() {
    if (currentPostId() || location.pathname.startsWith('/reels/')) return;
    const main = document.querySelector('main');
    if (!main) return;
    const items = [];
    for (const a of main.querySelectorAll('a[href]')) {
      if (a.closest('article, [role="dialog"]')) continue;
      const href = a.getAttribute('href');
      const m = href.match(POST_HREF);
      if (m && !items.some(i => i.id === m[1])) items.push({ id: m[1], href });
    }
    if (items.length < 2) return;
    const page = location.pathname;
    if (postList?.page === page) {
      const known = new Set(postList.items.map(i => i.id));
      const added = items.filter(i => !known.has(i.id));
      if (!added.length) return;
      postList.items.push(...added);
    } else {
      postList = { page, items };
    }
    try {
      sessionStorage.setItem(POST_LIST_KEY, JSON.stringify(postList));
    } catch (e) {
      // Kept in memory only.
    }
  }

  function listNeighbor(dir) {
    const id = currentPostId();
    if (!id || !postList) return null;
    const i = postList.items.findIndex(item => item.id === id);
    if (i < 0) return null;
    return postList.items[i + dir]?.href || null;
  }

  // The media box of the post in the popup (or the main post).
  function postMediaBox() {
    scan();
    const scope = [...document.querySelectorAll('[role="dialog"]')]
      .find(d => d.querySelector('article')) || document;
    const boxes = [
      ...[...photos].map(p => p.box),
      ...[...players].map(p => carouselOf(p.container) || p.container),
    ].filter(b => b.isConnected && scope.contains(b));
    let best = null;
    let bestArea = 0;
    for (const b of boxes) {
      const r = b.getBoundingClientRect();
      if (r.width * r.height > bestArea) {
        best = b;
        bestArea = r.width * r.height;
      }
    }
    return best;
  }

  function updateButtons(t) {
    if (t.kind === 'video') alignButtons(t);
    const full = isFullscreen(t);
    t.fullBtn.innerHTML = full ? ICONS.unfull : ICONS.full;
    t.fullBtn.title = full ? 'Exit fullscreen (f)' : 'Fullscreen (f)';
  }

  // With Esc locked (see enterFullscreen), leave fullscreen on Esc
  // ourselves, unless the ? help is open: its own Esc handler, added
  // after this one, closes it instead.
  window.addEventListener('keydown', e => {
    if (!fs || e.key !== 'Escape' || e.defaultPrevented) return;
    if (document.getElementById('userscript-shortcuts-help')) return;
    // Without the lock, Chrome would have taken this Esc; don't let it
    // also reach Instagram, which closes the post popup on Esc.
    e.preventDefault();
    e.stopImmediatePropagation();
    document.exitFullscreen();
  }, true);

  // In the popup, Instagram's own ←/→ change posts. In fullscreen that
  // would happen behind our view, so follow along. (Capture phase, so
  // this runs before Instagram moves.)
  window.addEventListener('keydown', e => {
    if (!fs) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;
    if (!postArrows()[e.key === 'ArrowRight' ? 'next' : 'prev']) return;
    freezeVideo();
    followPost(location.pathname);
  }, true);

  // ---------------------------------------------------------------
  // Keys
  // ---------------------------------------------------------------

  // What keyboard shortcuts act on: the video or photo that's
  // fullscreen, else the one under the mouse, else the most visible one
  // on screen. A carousel showing a video counts as that video.
  function activeTarget() {
    const videos = [...players].filter(p => p.overlay.isConnected);
    const images = [...photos].filter(p => p.box.isConnected &&
      !p.box.hasAttribute(VIDEO_SLIDE_ATTR));
    const all = [...videos, ...images];
    const found =
      all.find(isFullscreen) ||
      videos.find(p => p.overlay.matches(':hover')) ||
      images.find(p => p.box.matches(':hover'));
    if (found) return found;
    let best = null;
    let bestArea = 0;
    for (const t of all) {
      const r = (t.kind === 'video' ? t.container : t.box).getBoundingClientRect();
      const w = Math.min(r.right, innerWidth) - Math.max(r.left, 0);
      const h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
      const area = Math.max(0, w) * Math.max(0, h);
      if (area > bestArea) {
        best = t;
        bestArea = area;
      }
    }
    return best;
  }

  function activeVideo() {
    const t = activeTarget();
    return t?.kind === 'video' ? t : null;
  }

  const hasTarget = { when: () => !!activeTarget() };
  const keys = KeyboardShortcuts.create({ tag: TAG });
  keys.register('f', 'Fullscreen on / off', () => toggleFullscreen(activeTarget()),
    { when: () => !!fs || !!activeTarget() });
  keys.register('s', 'Sound on / off', () => toggleSound(activeVideo()),
    { when: () => !!activeVideo() });
  keys.register('space', 'Play / pause', () => togglePlay(activeVideo()),
    { when: () => !!activeVideo() });
  keys.register('j', 'Next photo', () => step(1), hasTarget);
  keys.register('k', 'Previous photo', () => step(-1), hasTarget);
  keys.register('h', 'Next post', () => goPost(1), { when: () => canGoPost(1) });
  keys.register('l', 'Previous post', () => goPost(-1), { when: () => canGoPost(-1) });
  keys.logKeys();

  // ---------------------------------------------------------------
  // Finding media
  // ---------------------------------------------------------------

  // Media come and go as the app navigates and feeds scroll.
  const startedAt = Date.now();
  let reportedWaiting = false;
  function scan() {
    let missing = 0;
    for (const v of document.querySelectorAll('video')) {
      if (!attachVideo(v)) missing++;
    }
    recordPostList();
    for (const img of document.querySelectorAll(`img:not([${IMAGE_ATTR}] img)`)) {
      attachPhoto(img);
    }
    for (const p of photos) {
      if (p.box.isConnected) updatePhotoSlide(p);
      else photos.delete(p);
    }
    updateNav();
    if (missing && !players.size && !reportedWaiting &&
        Date.now() - startedAt > STILL_WAITING_MS) {
      reportedWaiting = true;
      console.log(TAG, `still no player overlay found for ${missing} video(s)`);
    }
  }
  let scanQueued = false;
  new MutationObserver(() => {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(() => {
      scanQueued = false;
      scan();
      // Only after the page has changed, not on the scans our own
      // lookups run, which can come mid-step.
      recover();
    });
  }).observe(document.documentElement, { childList: true, subtree: true });

  console.log(TAG, 'init');
  scan();
})();
