// Tests for article-image-navigation.user.js.
//
// Pinkbike articles are public — no login needed. Run the launcher in
// one terminal and leave it running:
//
//     scripts/open-browser.sh https://www.pinkbike.com
//
// Then in another terminal:
//
//     npm test
//
// Override the article under test with PINKBIKE_ARTICLE_URL. The
// default has 5 qualifying images in its body, which is more than
// enough to exercise forward, reverse, and the end-of-article cases.

const path = require('path');
const { test, expect } = require('../../test/fixtures');

const SCRIPT_PATH = path.join(__dirname, 'article-image-navigation.user.js');

const ARTICLE_URL = process.env.PINKBIKE_ARTICLE_URL
    || 'https://www.pinkbike.com/news/new-vision-same-mountain-mammoth-mountain-to-reimagine-bike-park.html';

// Pinkbike's lazy loader leaves `<img src>` empty until an image
// scrolls near the viewport, but `data-src` carries the final URL
// from the moment the markup is rendered, and the wrapper is
// pre-sized so `getBoundingClientRect().height` is already accurate.
// We identify images by `data-src` in both this helper and the
// userscript, so no scroll-through-the-page priming is necessary.

// Pinkbike pages load ads and other async content after `load` fires.
// Those elements appear above the article and shift the hero photo's
// absolute position by 100-200 px when they fill in. If the script
// runs before that settles, its first measurement is stale by the
// time the scroll lands. Wait for `networkidle` (with a generous cap
// so flaky third-party trackers don't fail the whole test) and a
// small grace period for the resulting layout pass.
async function waitForLayoutSettled(page) {
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(200);
}

async function waitForInit(page) {
    await page.waitForEvent('console', {
        predicate: msg => /^\[pb img\] keys:/.test(msg.text()),
        timeout: 15000,
    });
}

// Dispatch a key and wait for the userscript's matching action log.
// Returns the log text so callers can extract the target src or kind.
async function pressAndWait(page, key, logPattern) {
    const got = page.waitForEvent('console', {
        predicate: msg => logPattern.test(msg.text()),
        timeout: 5000,
    });
    await page.keyboard.press(key);
    const msg = await got;
    return msg.text();
}

// Wait for a smooth-scroll animation to settle: poll scrollY until
// three samples in a row agree.
async function waitForScrollSettled(page) {
    let last = -1, stable = 0;
    for (let i = 0; i < 50 && stable < 3; i++) {
        const y = await page.evaluate(() => Math.round(window.scrollY));
        if (y === last) stable++; else { stable = 0; last = y; }
        await page.waitForTimeout(60);
    }
}

// Read the list of qualifying article images (mirroring the script's
// height threshold and `.blog-section` scope, but NOT the comments-top
// bound — the regression test wants to see candidates below it too).
// Keep MIN_HEIGHT_PX in sync with the userscript constant.
const MIN_HEIGHT_PX = 200;
async function listQualifyingImages(page) {
    return page.evaluate(minH => {
        return [...document.querySelectorAll('.blog-section img')]
            .filter(i => i.getBoundingClientRect().height >= minH)
            .map(i => ({
                tail: ((i.dataset.src || i.currentSrc || i.src || '')
                    .split('/').pop() || '').split('?')[0],
                absTop: Math.round(i.getBoundingClientRect().top + window.scrollY),
            }))
            .sort((a, b) => a.absTop - b.absTop);
    }, MIN_HEIGHT_PX);
}

test.describe('pinkbike article image navigation', () => {
    test.beforeEach(async ({ loadUserscript }) => {
        await loadUserscript(SCRIPT_PATH);
    });

    test('i from the top of the page jumps to the first big photo', async ({ page }) => {
        await page.goto(ARTICLE_URL);
        await waitForInit(page);
        await waitForLayoutSettled(page);
        const imgs = await listQualifyingImages(page);
        expect(imgs.length).toBeGreaterThan(0);
        const log = await pressAndWait(page, 'i', /^\[pb img\] i -> /);
        expect(log).toContain(`img(${imgs[0].tail})`);
        await waitForScrollSettled(page);
        // The image's top edge should land at viewport y ≈ 30 (the BUFFER).
        const topY = await page.evaluate(tail => {
            const i = [...document.querySelectorAll('.blog-section img')]
                .find(im => (im.dataset.src || im.currentSrc || im.src || '').endsWith(tail));
            return Math.round(i.getBoundingClientRect().top);
        }, imgs[0].tail);
        expect(topY).toBeGreaterThanOrEqual(25);
        expect(topY).toBeLessThanOrEqual(35);
    });

    test('pressing i again advances past the just-anchored image', async ({ page }) => {
        await page.goto(ARTICLE_URL);
        await waitForInit(page);
        await waitForLayoutSettled(page);
        const imgs = await listQualifyingImages(page);
        expect(imgs.length).toBeGreaterThanOrEqual(2);
        // First press: lands on imgs[0].
        const log1 = await pressAndWait(page, 'i', /^\[pb img\] i -> /);
        expect(log1).toContain(`img(${imgs[0].tail})`);
        await waitForScrollSettled(page);
        // Second press: must advance to imgs[1], not re-pick imgs[0].
        const log2 = await pressAndWait(page, 'i', /^\[pb img\] i -> /);
        expect(log2).toContain(`img(${imgs[1].tail})`);
        expect(log2).not.toContain(`img(${imgs[0].tail})`);
    });

    test('Shift-I steps backward through images', async ({ page }) => {
        await page.goto(ARTICLE_URL);
        await waitForInit(page);
        await waitForLayoutSettled(page);
        const imgs = await listQualifyingImages(page);
        expect(imgs.length).toBeGreaterThanOrEqual(3);
        // Forward twice → currently anchored at imgs[1].
        await pressAndWait(page, 'i', /^\[pb img\] i -> /);
        await waitForScrollSettled(page);
        await pressAndWait(page, 'i', /^\[pb img\] i -> /);
        await waitForScrollSettled(page);
        // Back to imgs[0].
        const log = await pressAndWait(page, 'Shift+I', /^\[pb img\] I -> /);
        expect(log).toContain(`img(${imgs[0].tail})`);
    });

    test('i past the last image is a no-op (logged)', async ({ page }) => {
        await page.goto(ARTICLE_URL);
        await waitForInit(page);
        await waitForLayoutSettled(page);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight - window.innerHeight));
        await page.waitForTimeout(200);
        const log = await pressAndWait(page, 'i', /^\[pb img\] i: no next image/);
        expect(log).toMatch(/no next image/);
    });

    test('Shift-I from the top of the page is a no-op (logged)', async ({ page }) => {
        await page.goto(ARTICLE_URL);
        await waitForInit(page);
        await waitForLayoutSettled(page);
        // Make sure we're at the very top.
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(100);
        const log = await pressAndWait(page, 'Shift+I', /^\[pb img\] I: no previous image/);
        expect(log).toMatch(/no previous image/);
    });

    test('small (sub-threshold) images are not targeted', async ({ page }) => {
        await page.goto(ARTICLE_URL);
        await waitForInit(page);
        await waitForLayoutSettled(page);
        // There are dozens of <img> on the page (avatars, related-article
        // thumbs, ads). Only the gallery photos should be reachable. We
        // step through a few in a row and check each logged tail belongs
        // to the qualifying set. We stop short of the last image so the
        // loop never has to handle the end-of-article "no next" branch.
        const imgs = await listQualifyingImages(page);
        expect(imgs.length).toBeGreaterThanOrEqual(3);
        const allowedTails = new Set(imgs.map(i => i.tail));
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(100);
        const steps = Math.min(3, imgs.length - 1);
        for (let step = 0; step < steps; step++) {
            const log = await pressAndWait(page, 'i', /^\[pb img\] i -> /);
            const m = log.match(/img\(([^)]+)\)/);
            expect(m).not.toBeNull();
            expect(allowedTails.has(m[1])).toBe(true);
            await waitForScrollSettled(page);
        }
    });

    test('does not jump to images past the comments section', async ({ page }) => {
        await page.goto(ARTICLE_URL);
        await waitForInit(page);
        await waitForLayoutSettled(page);
        // Inject a synthetic "post-article" .blog-section AFTER the
        // comments wrapper with a large image inside. The userscript
        // must exclude this from the candidate set.
        const PROBE_TAIL = '__post_comments_probe.jpg';
        await page.evaluate(tail => {
            const wrap = document.createElement('div');
            wrap.className = 'blog-section __synth_post_article';
            const img = document.createElement('img');
            img.src = `https://example.invalid/${tail}`;
            img.style.width = '800px';
            img.style.height = '800px';
            img.style.display = 'block';
            img.style.background = '#444';
            wrap.appendChild(img);
            // Place it right after the news-comments-container so it's
            // clearly "below the article".
            const ncc = document.querySelector('.news-comments-container');
            ncc.parentNode.insertBefore(wrap, ncc.nextSibling);
        }, PROBE_TAIL);
        // Walk forward through the real images and never touch the probe.
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(100);
        const imgs = await listQualifyingImages(page);
        // Our filter is naive — it queries .blog-section img — and would
        // include the synthetic probe if it weren't for the comments-top
        // bound the script applies. Verify the test's setup actually
        // exposes that probe to a class-only filter.
        expect(imgs.some(i => i.tail === PROBE_TAIL)).toBe(true);
        // Press i until we hit the no-op log. Collect every action log
        // along the way and assert the probe is never the target.
        const visited = [];
        for (let step = 0; step < 20; step++) {
            // The two log shapes for the `i` key are `[pb img] i -> ...`
            // (action) and `[pb img] i: no next image …` (end of list).
            // Note no space between `i` and `:` in the second one — match
            // both with a single character class.
            const got = page.waitForEvent('console', {
                predicate: m => /^\[pb img\] i[ :]/.test(m.text()),
                timeout: 5000,
            });
            await page.keyboard.press('i');
            const log = (await got).text();
            if (/no next image/.test(log)) break;
            visited.push(log);
            await waitForScrollSettled(page);
        }
        expect(visited.length).toBeGreaterThan(0);
        for (const log of visited) {
            expect(log).not.toContain(PROBE_TAIL);
        }
    });

    test('keys are ignored while typing in a text field', async ({ page }) => {
        await page.goto(ARTICLE_URL);
        await waitForInit(page);
        await waitForLayoutSettled(page);
        await page.evaluate(() => {
            const ta = document.createElement('textarea');
            ta.style.position = 'fixed';
            ta.style.top = '0';
            ta.style.left = '0';
            ta.style.zIndex = '99999';
            document.body.appendChild(ta);
            ta.focus();
        });
        const logs = [];
        const handler = msg => {
            const t = msg.text();
            if (t.startsWith('[pb img] i ') || t.startsWith('[pb img] I ')) logs.push(t);
        };
        page.on('console', handler);
        await page.keyboard.press('i');
        await page.keyboard.press('Shift+I');
        await page.waitForTimeout(400);
        page.off('console', handler);
        expect(logs).toEqual([]);
    });
});
