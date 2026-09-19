// Tests for zoom-pan.user.js.
//
//     scripts/open-browser.sh https://www.youtube.com
//     pnpm test
//
// No login needed. Uses a public Blender Foundation video. The tests
// drive real input (page.mouse / page.keyboard with modifiers held), and
// read the resulting transform straight off the <video>.

const path = require('path');
const { test, expect } = require('../../test/fixtures');

const SCRIPT_PATH = path.join(__dirname, 'zoom-pan.user.js');
const VIDEO_URL = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'; // Big Buck Bunny
// A 360° video, where the script must stand down.
const SPHERICAL_URL = 'https://www.youtube.com/watch?v=CaswdIbc2UA';
// Matches the watch page's and Shorts' players alike.  A page can hold
// both after in-page navigation, so the live one is the laid-out one.
const VIDEO = '.html5-video-player video.html5-main-video';
const SHORTS_URL = 'https://www.youtube.com/shorts/j7G4rAhQ5P4';

// The view as {s, ox, oy}: scale and the translate percentages the
// script writes. Full frame is {s: 1, ox: 0, oy: 0} with no transform.
async function readView(page) {
  return page.evaluate((sel) => {
    const v = [...document.querySelectorAll(sel)].find((el) => el.offsetWidth > 0);
    const m = new DOMMatrix(getComputedStyle(v).transform);
    return { s: m.a, ox: m.e / v.offsetWidth, oy: m.f / v.offsetHeight, raw: v.style.transform };
  }, VIDEO);
}

// Browser page zoom changes devicePixelRatio (visualViewport.scale is
// pinch zoom, which never changes here).  CDP-synthesized input doesn't
// reach Chrome's browser-level zoom anyway, so this is a sanity check
// on the page, not proof that preventDefault worked.
async function pageZoom(page) {
  return page.evaluate(() => devicePixelRatio);
}

async function playerBox(page) {
  return page.locator('#movie_player').boundingBox();
}

// Screen position of a fixed video point (fraction u, v of the frame),
// from the transformed rect — used to check the zoom anchor holds.
async function screenPointOf(page, u, v) {
  return page.evaluate(({ sel, u, v }) => {
    const r = document.querySelector(sel).getBoundingClientRect();
    return { x: r.left + u * r.width, y: r.top + v * r.height };
  }, { sel: VIDEO, u, v });
}

test.beforeEach(async ({ page, loadUserscript }) => {
  await loadUserscript(SCRIPT_PATH);
  await page.goto(VIDEO_URL);
  const video = page.locator(VIDEO);
  await expect(video).toBeAttached();
  // Start playback with a real click so the video is laid out in the
  // frame (while cued it sits parked above the player).
  const box = await playerBox(page);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  // Nobody needs to hear the test run.  (open-browser.sh also passes
  // --mute-audio; this covers a browser launched before that was added.)
  await page.evaluate((sel) => { document.querySelector(sel).muted = true; }, VIDEO);
  await expect.poll(() => page.evaluate((sel) => {
    const v = document.querySelector(sel);
    return v.getBoundingClientRect().top >= v.closest('#movie_player').getBoundingClientRect().top - 1;
  }, VIDEO)).toBe(true);
  // YouTube keeps rewriting the video's inline style for a moment after
  // playback starts; wait until it has been quiet for a bit, otherwise a
  // drag can land mid-rewrite.
  await page.evaluate((sel) => new Promise((resolve) => {
    const v = document.querySelector(sel);
    let timer = setTimeout(resolve, 1000);
    new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(resolve, 1000);
    }).observe(v, { attributes: true, attributeFilter: ['style'] });
  }), VIDEO);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
});

test('ctrl+wheel zooms around the pointer; plain wheel does not', async ({ page }) => {
  const box = await playerBox(page);
  // A point one third across and down, away from the center.
  const px = box.x + box.width / 3;
  const py = box.y + box.height / 3;
  await page.mouse.move(px, py);

  // At the top of the page, so a negative delta can't scroll anything.
  await page.mouse.wheel(0, -100);
  expect((await readView(page)).s).toBe(1);
  const dpr = await pageZoom(page);

  // Which point of the video is under the pointer right now.
  const { u, v } = await page.evaluate(({ sel, px, py }) => {
    const r = document.querySelector(sel).getBoundingClientRect();
    return { u: (px - r.left) / r.width, v: (py - r.top) / r.height };
  }, { sel: VIDEO, px, py });
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');

  const view = await readView(page);
  // Two 100px detents at k=0.0025: e^0.5 ≈ 1.65×.
  expect(view.s).toBeCloseTo(Math.exp(0.5), 2);
  // That same video point is still under the pointer.
  const after = await screenPointOf(page, u, v);
  expect(Math.abs(after.x - px)).toBeLessThan(2);
  expect(Math.abs(after.y - py)).toBeLessThan(2);
  // And the browser's page zoom was not triggered.
  expect(await pageZoom(page)).toBe(dpr);

  // Off the player (over the page title), ctrl+wheel still zooms the
  // video, around its center.
  const title = await page.locator('#title h1, h1.ytd-watch-metadata').first().boundingBox();
  await page.mouse.move(title.x + 20, title.y + title.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  const off = await readView(page);
  expect(off.s).toBeGreaterThan(view.s);
  expect(await pageZoom(page)).toBe(dpr);
});

test('a trackpad pinch (ctrl-flagged wheel with no key held) zooms at the pinch rate', async ({ page }) => {
  const box = await playerBox(page);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  // Chrome reports a pinch as a wheel event with ctrlKey set while no
  // key is down; raw CDP can send exactly that (modifiers 2 = ctrl).
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel', x: cx, y: cy, deltaX: 0, deltaY: -25, modifiers: 2,
  });
  await expect.poll(async () => (await readView(page)).s).toBeCloseTo(Math.exp(25 * 0.02), 2);

  // With Control physically held, the same delta uses the slow wheel rate.
  const before = (await readView(page)).s;
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -25);
  await page.keyboard.up('Control');
  expect((await readView(page)).s / before).toBeCloseTo(Math.exp(25 * 0.0025), 3);
});

test('plus/minus zoom in and out, clamped at 1x; ctrl+arrows pan', async ({ page }) => {
  await page.keyboard.press('Equal');
  await page.keyboard.press('Shift+Equal');
  let view = await readView(page);
  expect(view.s).toBeCloseTo(4, 2);

  // Centered at 4x: ox = oy = -1.5.  Each arrow moves 20% of the frame.
  await page.keyboard.press('Control+ArrowRight');
  await page.keyboard.press('Control+ArrowRight');
  await page.keyboard.press('Control+ArrowUp');
  view = await readView(page);
  expect(view.ox).toBeCloseTo(-1.9, 2);
  expect(view.oy).toBeCloseTo(-1.3, 2);
  // Clamped at the edge.
  for (let i = 0; i < 20; i++) await page.keyboard.press('Control+ArrowLeft');
  expect((await readView(page)).ox).toBeCloseTo(0, 3);

  await page.keyboard.press('Minus');
  await page.keyboard.press('Shift+Minus');
  await page.keyboard.press('Minus');
  view = await readView(page);
  expect(view.s).toBe(1);
  expect(view.raw).toBe('');
});

test('ctrl+drag pans, stays within the frame, and does not toggle playback', async ({ page }) => {
  const box = await playerBox(page);
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.keyboard.press('Equal');
  const start = await readView(page);
  const paused = await page.evaluate((sel) => document.querySelector(sel).paused, VIDEO);

  for (const button of ['left', 'middle']) {
    await page.keyboard.down('Control');
    await page.mouse.move(cx, cy);
    await page.mouse.down({ button });
    await page.mouse.move(cx - 60, cy - 40, { steps: 4 });
    await page.mouse.up({ button });
    await page.keyboard.up('Control');
  }
  const view = await readView(page);
  expect(view.s).toBe(start.s);
  // Two drags of 60px left / 40px up, as fractions of the video box.
  const vw = await page.evaluate((sel) => document.querySelector(sel).offsetWidth, VIDEO);
  const vh = await page.evaluate((sel) => document.querySelector(sel).offsetHeight, VIDEO);
  expect(view.ox).toBeCloseTo(start.ox - 120 / vw, 2);
  expect(view.oy).toBeCloseTo(start.oy - 80 / vh, 2);

  // Drag far past the edge: the offset clamps so no gap opens up.
  await page.keyboard.down('Control');
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 3000, cy + 3000, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Control');
  const clamped = await readView(page);
  expect(clamped.ox).toBeCloseTo(0, 3);
  expect(clamped.oy).toBeCloseTo(0, 3);

  // The synthesized click after each drag was swallowed.
  await page.waitForTimeout(600);
  expect(await page.evaluate((sel) => document.querySelector(sel).paused, VIDEO)).toBe(paused);
});

test('shift+drag zooms to the drawn box; tiny boxes are ignored', async ({ page }) => {
  const box = await playerBox(page);
  // A box covering the middle quarter of the frame in each dimension.
  const x1 = box.x + box.width * 0.375;
  const y1 = box.y + box.height * 0.375;
  const x2 = box.x + box.width * 0.625;
  const y2 = box.y + box.height * 0.625;

  await page.keyboard.down('Shift');
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 4 });
  await expect(page.locator('#jshute-yt-zoom-box')).toBeVisible();
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect(page.locator('#jshute-yt-zoom-box')).toHaveCount(0);

  const view = await readView(page);
  // The frame center is now magnified 4× (limited by whichever
  // dimension the box is a larger fraction of) and stays centered.
  const vw = await page.evaluate((sel) => document.querySelector(sel).offsetWidth, VIDEO);
  const expected = Math.min(box.width, vw) / (x2 - x1);
  expect(view.s).toBeCloseTo(expected, 1);
  const center = await screenPointOf(page, 0.5, 0.5);
  expect(Math.abs(center.x - (box.x + box.width / 2))).toBeLessThan(2);

  // A 3px shift-drag is a click, not a box.
  await page.keyboard.down('Shift');
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x1 + 3, y1 + 3);
  await page.mouse.up();
  await page.keyboard.up('Shift');
  expect((await readView(page)).s).toBeCloseTo(view.s, 5);
});

test('x toggles between the zoomed view and the full frame', async ({ page }) => {
  await page.keyboard.press('Equal');
  await page.keyboard.press('Equal');
  const zoomed = await readView(page);
  expect(zoomed.s).toBeGreaterThan(1);

  await page.keyboard.press('x');
  expect((await readView(page)).s).toBe(1);

  await page.keyboard.press('x');
  const restored = await readView(page);
  expect(restored.s).toBeCloseTo(zoomed.s, 5);
  expect(restored.ox).toBeCloseTo(zoomed.ox, 5);
  expect(restored.oy).toBeCloseTo(zoomed.oy, 5);

  // Typing in the search box must not trigger it.
  await page.keyboard.press('x');
  expect((await readView(page)).s).toBe(1);
  const search = page.locator('textarea.ytSearchboxComponentInput, input[name="search_query"]').first();
  await search.click();
  await page.keyboard.type('x');
  expect((await readView(page)).s).toBe(1);
  await expect(search).toHaveValue('x');
});

test('stands down on a spherical (360°) video', async ({ page }) => {
  const logs = [];
  page.on('console', (m) => { if (m.text().includes('[yt-zoom]')) logs.push(m.text()); });
  await page.goto(SPHERICAL_URL);
  await expect(page.locator('#movie_player.ytp-webgl-spherical')).toBeAttached();
  const box = await playerBox(page);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await page.keyboard.press('Equal');
  await page.waitForTimeout(300);
  expect((await readView(page)).raw).toBe('');
  expect(logs.filter((l) => /spherical/.test(l))).toHaveLength(1);
});

test('works on Shorts, whose player root is #shorts-player', async ({ page }) => {
  await page.goto(SHORTS_URL);
  await expect(page.locator('#shorts-player video.html5-main-video')).toBeAttached();
  await expect.poll(() => page.evaluate(() =>
    document.querySelector('#shorts-player video').offsetWidth)).toBeGreaterThan(0);
  await page.evaluate(() => { document.querySelector('#shorts-player video').muted = true; });
  const box = await page.locator('#shorts-player').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -100);
  await page.keyboard.up('Control');
  await expect.poll(async () => (await readView(page)).s).toBeCloseTo(Math.exp(0.25), 2);
  await page.keyboard.press('x');
  expect((await readView(page)).s).toBe(1);
  // Shorts loop forever; stop it (the fixture closes the tab anyway).
  await page.evaluate(() => document.querySelector('#shorts-player video').pause());
});
