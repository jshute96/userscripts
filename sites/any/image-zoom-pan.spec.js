// Tests for image-zoom-pan.user.js (and lib/image-zoom-pan.js).
//
// No site or login needed: each test serves a generated PNG at a fake
// URL with page.route, so Chrome opens it in its standalone image
// viewer, and sets the window size so the expected numbers are exact.
//
//     scripts/open-browser.sh     # one terminal, leave running
//     pnpm test sites/any/image-zoom-pan.spec.js

import path from 'node:path';
import zlib from 'node:zlib';
import { test, expect } from '../../test/fixtures.js';

const SCRIPT_PATH = path.join(import.meta.dirname, 'image-zoom-pan.user.js');
const ORIGIN = 'https://image-zoom-pan.test';

// A solid-color PNG of the given size.
function makePng(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([70, 130, 180], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const SMALL = { name: 'small.png', width: 300, height: 200 };
const LARGE = { name: 'large.png', width: 2400, height: 1200 };
const pngs = new Map();
function png(img) {
  if (!pngs.has(img.name)) pngs.set(img.name, makePng(img.width, img.height));
  return pngs.get(img.name);
}

// Open `img` in Chrome's image viewer with the script, at a window of
// `width` x `height`, and wait until the image is laid out.
async function openImage(page, loadUserscript, img, width = 1000, height = 700) {
  await page.setViewportSize({ width, height });
  await page.route(`${ORIGIN}/${img.name}`, (route) =>
    route.fulfill({ contentType: 'image/png', body: png(img) })
  );
  await loadUserscript(SCRIPT_PATH);
  const init = page.waitForEvent('console', {
    predicate: (msg) => msg.text() === '[image-zoom] init',
    timeout: 10000,
  });
  await page.goto(`${ORIGIN}/${img.name}`);
  await init;
  await page.waitForFunction(() => {
    const i = document.querySelector('img');
    return i && i.complete && i.naturalWidth > 0 && i.offsetWidth > 0;
  });
  // The first event detects the viewer; park the mouse in the middle.
  await page.mouse.move(width / 2, height / 2);
}

// The image's on-screen box, its gaps to each window edge, its real
// zoom (screen pixels per image pixel), and which point of the image
// (as fractions) is at the window's center.
async function state(page) {
  return page.evaluate(() => {
    const i = document.querySelector('img');
    const r = i.getBoundingClientRect();
    return {
      width: r.width,
      height: r.height,
      gapLeft: r.left,
      gapRight: innerWidth - r.right,
      gapTop: r.top,
      gapBottom: innerHeight - r.bottom,
      zoom: r.width / i.naturalWidth,
      centerU: (innerWidth / 2 - r.left) / r.width,
      centerV: (innerHeight / 2 - r.top) / r.height,
      badge: document.getElementById('jshute-image-zoom-pan-hud')?.textContent ?? null,
    };
  });
}

function expectCentered(s) {
  expect(Math.abs(s.gapLeft - s.gapRight)).toBeLessThanOrEqual(1);
  expect(Math.abs(s.gapTop - s.gapBottom)).toBeLessThanOrEqual(1);
}

test.afterEach(async ({ reports }) => {
  expect(reports.errors()).toEqual([]);
});

test('small image starts centered at original size', async ({ page, loadUserscript }) => {
  await openImage(page, loadUserscript, SMALL);
  const s = await state(page);
  expect(s.width).toBeCloseTo(300, 0);
  expect(s.zoom).toBeCloseTo(1, 2);
  expectCentered(s);
});

test('x on a small image toggles between original size and fit', async ({ page, loadUserscript }) => {
  await openImage(page, loadUserscript, SMALL);
  for (let n = 0; n < 2; n++) {
    await page.keyboard.press('x');
    let s = await state(page);
    // Fit: 300x200 into 1000x700 is limited by the width, 1000/300 = 3.33.
    expect(s.width).toBeCloseTo(1000, 0);
    expect(s.badge).toBe('3.3×');
    expectCentered(s);

    await page.keyboard.press('x');
    s = await state(page);
    expect(s.zoom).toBeCloseTo(1, 2);
    expectCentered(s);
  }
});

test('x on a large image toggles between fit and original size', async ({ page, loadUserscript }) => {
  await openImage(page, loadUserscript, LARGE);
  let s = await state(page);
  expect(s.width).toBeCloseTo(1000, 0); // fit by width
  expectCentered(s);

  // Repeated presses must keep landing exactly on each end; a sub-pixel
  // leftover once made x stick on an almost-1x view.
  for (let n = 0; n < 3; n++) {
    await page.keyboard.press('x');
    s = await state(page);
    expect(s.zoom).toBeCloseTo(1, 3);
    expect(s.badge).toBe('1.0×');
    expect(s.centerU).toBeCloseTo(0.5, 3);
    expect(s.centerV).toBeCloseTo(0.5, 3);

    await page.keyboard.press('x');
    s = await state(page);
    expect(s.width).toBeCloseTo(1000, 0);
    expectCentered(s);
  }
});

test('x returns to the last wheel zoom', async ({ page, loadUserscript }) => {
  await openImage(page, loadUserscript, LARGE);
  await page.mouse.move(200, 200);
  await page.mouse.wheel(0, -300);
  const zoomed = await state(page);
  expect(zoomed.zoom).toBeGreaterThan(0.5);

  await page.keyboard.press('x'); // to fit
  expect((await state(page)).width).toBeCloseTo(1000, 0);
  await page.keyboard.press('x'); // back to the wheel zoom
  const back = await state(page);
  expect(back.zoom).toBeCloseTo(zoomed.zoom, 3);
  expect(back.gapLeft).toBeCloseTo(zoomed.gapLeft, 0);
  expect(back.gapTop).toBeCloseTo(zoomed.gapTop, 0);
});

test('a zoomed image stays centered while it fits the window', async ({ page, loadUserscript }) => {
  await openImage(page, loadUserscript, SMALL);
  // One notch near the image's corner: 300x200 grows to about 385x257,
  // still smaller than the window, so it should stay centered rather
  // than growing toward the cursor.
  await page.mouse.move(360, 260);
  await page.mouse.wheel(0, -100);
  let s = await state(page);
  expect(s.width).toBeGreaterThan(300);
  expectCentered(s);

  // Back out to 1x: centered, and exactly unzoomed.
  await page.mouse.wheel(0, 300);
  s = await state(page);
  expect(s.zoom).toBeCloseTo(1, 3);
  expectCentered(s);
});

test('resizing keeps the real zoom and the point at the center', async ({ page, loadUserscript }) => {
  await openImage(page, loadUserscript, LARGE);
  await page.keyboard.press('x'); // original size
  for (const [w, h] of [[800, 600], [500, 300], [1000, 700]]) {
    await page.setViewportSize({ width: w, height: h });
    await expect.poll(async () => (await state(page)).zoom).toBeCloseTo(1, 3);
    const s = await state(page);
    expect(s.centerU).toBeCloseTo(0.5, 2);
    expect(s.centerV).toBeCloseTo(0.5, 2);
  }
});

test('resizing re-fits a small image enlarged to fit', async ({ page, loadUserscript }) => {
  await openImage(page, loadUserscript, SMALL);
  await page.keyboard.press('x'); // fit
  await page.setViewportSize({ width: 600, height: 900 });
  // Now limited by the width: 600/300 = 2.
  await expect.poll(async () => (await state(page)).width).toBeCloseTo(600, 0);
  expectCentered(await state(page));
});

test('an image over 32x the window can still reach original size', async ({ page, loadUserscript }) => {
  // 2400 px into a 60 px window: fit is 1/40, beyond the 32x zoom cap.
  await openImage(page, loadUserscript, LARGE, 60, 40);
  await page.keyboard.press('x');
  expect((await state(page)).zoom).toBeCloseTo(1, 3);
  await page.mouse.wheel(0, -1000); // can't zoom past original size
  expect((await state(page)).zoom).toBeCloseTo(1, 3);
});

test('an HTML page at an image URL is left alone', async ({ page, loadUserscript }) => {
  await page.route(`${ORIGIN}/page.png`, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<p>Not an image</p>' })
  );
  const logs = [];
  page.on('console', (msg) => logs.push(msg.text()));
  await loadUserscript(SCRIPT_PATH);
  await page.goto(`${ORIGIN}/page.png`);
  await page.waitForTimeout(500);
  expect(logs.filter((t) => t.startsWith('[image-zoom]'))).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.hasAttribute(
    'data-jshute-image-zoom-pan-active'))).toBe(false);
});

// URL matching, through the manager's real header rules:
// loadUserscript's `url` option checks the URL against the script's
// @match / @include / @exclude and throws if the script wouldn't run.
test.describe('URL matching', () => {
  const MATCHES = [
    'https://example.com/photo.png',
    'https://example.com/photo.jpg',
    'https://example.com/photo.jpeg',
    'https://example.com/photo.webp',
    'https://example.com/photo.gif',
    'https://example.com/photo.avif',
    'https://example.com/photo.bmp',
    'https://example.com/favicon.ico',
    'https://example.com/IMG_1234.JPG', // any case
    'https://example.com/photo.Png',
    'http://example.com/photo.png',
    'https://example.com:8080/a/b/c/photo.png',
    'https://example.com/photo.jpg?width=612',
    'https://example.com/photo.jpg#top',
    'https://example.com/photo.jpg?w=1&h=2#top',
    'https://example.com/my.photo.v2.png', // dots earlier in the name
    'file:///home/user/Pictures/photo.png',
  ];
  const MISSES = [
    'https://example.com/',
    'https://example.com/page.html',
    'https://example.com/photo.png.html',
    'https://example.com/photo.pngx',
    'https://example.com/png',
    'https://example.com/photo.png/', // a directory, not the image
    'https://example.com/search?q=cat.png', // extension only in the query
    'https://example.com/page#photo.png', // or only in the fragment
    'https://example.com/drawing.svg',
    'https://example.com/scan.tiff',
    'ftp://example.com/photo.png',
  ];

  for (const url of MATCHES) {
    test(`runs on ${url}`, async ({ loadUserscript }) => {
      await loadUserscript(SCRIPT_PATH, { url });
    });
  }
  for (const url of MISSES) {
    test(`skips ${url}`, async ({ loadUserscript }) => {
      await expect(loadUserscript(SCRIPT_PATH, { url })).rejects.toThrow(/No @match or @include covers this URL/);
    });
  }
});
