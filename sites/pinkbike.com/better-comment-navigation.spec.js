// Tests for better-comment-navigation.user.js.
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
// Override the article under test with PINKBIKE_ARTICLE_URL if the
// default ever stops being available. The article only has to have
// at least two top-level threads with replies (which any moderately
// active news post will).

const path = require('path');
const { test, expect } = require('../../test/fixtures');

const SCRIPT_PATH = path.join(__dirname, 'better-comment-navigation.user.js');

const ARTICLE_URL = process.env.PINKBIKE_ARTICLE_URL
    || 'https://www.pinkbike.com/news/new-vision-same-mountain-mammoth-mountain-to-reimagine-bike-park.html';

// Wait for the script's `keys:` init line — confirms the handler is
// registered before any keypress is dispatched. Pair it with a goto.
async function waitForInit(page) {
    await page.waitForEvent('console', {
        predicate: msg => /^\[pb nav\] keys:/.test(msg.text()),
        timeout: 15000,
    });
}

// Dispatch a key and wait for the userscript's matching action log.
// Returns the matched log text so callers can extract the target id.
async function pressAndWait(page, key, logPattern) {
    const got = page.waitForEvent('console', {
        predicate: msg => logPattern.test(msg.text()),
        timeout: 5000,
    });
    await page.keyboard.press(key);
    const msg = await got;
    return msg.text();
}

// Find a comment id by structural position (no hardcoded cm-ids).
// Selector is evaluated on the page and returns the element's id.
async function commentIdAt(page, selector) {
    return page.evaluate(sel => document.querySelector(sel)?.id, selector);
}

test.describe('pinkbike better comment navigation', () => {
    test.beforeEach(async ({ loadUserscript }) => {
        await loadUserscript(SCRIPT_PATH);
    });

    test('j advances to the next comment in document order', async ({ page }) => {
        await page.goto(ARTICLE_URL);
        await waitForInit(page);
        // Scroll the first comment to viewport top so findCurrentRow()
        // resolves to it.
        await page.evaluate(() => {
            document.querySelector('.cmcont').scrollIntoView({ block: 'start' });
        });
        await page.waitForTimeout(200);

        const firstId = await commentIdAt(page, '.cmcont');
        const secondId = await commentIdAt(page, '.cmcont + .cmcont, .cmcont ~ .cmcont');
        const log = await pressAndWait(page, 'j', /^\[pb nav\] next -> /);
        expect(log).toContain(`next -> ${secondId}`);
        // Sanity: that really is the comment after the first.
        expect(secondId).not.toBe(firstId);
    });

    test('k moves back to the previous comment', async ({ page }) => {
        await page.goto(ARTICLE_URL);
        await waitForInit(page);
        // Scroll the second cmcont to the top, then press k.
        const secondId = await page.evaluate(() => {
            const second = document.querySelectorAll('.cmcont')[1];
            second.scrollIntoView({ block: 'start' });
            return second.id;
        });
        await page.waitForTimeout(200);
        const firstId = await commentIdAt(page, '.cmcont');
        const log = await pressAndWait(page, 'k', /^\[pb nav\] prev -> /);
        expect(log).toContain(`prev -> ${firstId}`);
        expect(firstId).not.toBe(secondId);
    });

    test('p from a reply jumps to its thread root', async ({ page }) => {
        await page.goto(ARTICLE_URL);
        await waitForInit(page);
        // Bring the first reply to the top.
        const { replyId, rootId } = await page.evaluate(() => {
            const reply = document.querySelector('.cmcont.commentreply2');
            reply.scrollIntoView({ block: 'start' });
            const root = reply.closest('.ppcont').querySelector('.cmcont:not(.commentreply2)');
            return { replyId: reply.id, rootId: root.id };
        });
        await page.waitForTimeout(200);
        const log = await pressAndWait(page, 'p', /^\[pb nav\] parent /);
        expect(log).toBe(`[pb nav] parent ${replyId} -> ${rootId}`);
    });

    test('p on a root comment is a no-op (logged, no jump)', async ({ page }) => {
        await page.goto(ARTICLE_URL);
        await waitForInit(page);
        const rootId = await page.evaluate(() => {
            const root = document.querySelector('.cmcont:not(.commentreply2)');
            root.scrollIntoView({ block: 'start' });
            return root.id;
        });
        await page.waitForTimeout(200);
        const log = await pressAndWait(page, 'p', /^\[pb nav\] p ignored/);
        expect(log).toBe(`[pb nav] p ignored: ${rootId} is already a root`);
    });

    test('n jumps to the next thread root', async ({ page }) => {
        await page.goto(ARTICLE_URL);
        await waitForInit(page);
        const { firstRootId, secondRootId } = await page.evaluate(() => {
            const threads = document.querySelectorAll('.ppcont');
            const a = threads[0].querySelector('.cmcont:not(.commentreply2)');
            const b = threads[1].querySelector('.cmcont:not(.commentreply2)');
            a.scrollIntoView({ block: 'start' });
            return { firstRootId: a.id, secondRootId: b.id };
        });
        await page.waitForTimeout(200);
        const log = await pressAndWait(page, 'n', /^\[pb nav\] next-root /);
        expect(log).toBe(`[pb nav] next-root ${firstRootId} -> ${secondRootId}`);
    });

    test('c lands with the comments header at the top of the viewport', async ({ page }) => {
        await page.goto(ARTICLE_URL);
        await waitForInit(page);
        // Start scrolled to the very top of the article.
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(200);

        const log = await pressAndWait(page, 'c', /^\[pb nav\] c -> /);
        // The fix targets the comments wrapper, not the bare #commenttop
        // span — make sure that's what got logged.
        expect(log).toMatch(/news-comments/);

        // Wait for smooth scroll to settle: poll scrollY until two
        // consecutive samples match.
        let last = -1, stable = 0;
        for (let i = 0; i < 50 && stable < 3; i++) {
            const y = await page.evaluate(() => Math.round(window.scrollY));
            if (y === last) stable++; else { stable = 0; last = y; }
            await page.waitForTimeout(60);
        }

        // After the jump, the comments-container's top edge should be
        // at (or just above) the viewport top. We allow a few pixels
        // for browser rounding; we mainly care that we didn't land in
        // the related-articles / deals filler above the comments.
        const top = await page.evaluate(() => {
            const el = document.querySelector('.news-comments-container');
            return Math.round(el.getBoundingClientRect().top);
        });
        expect(top).toBeGreaterThan(-5);
        expect(top).toBeLessThan(20);
    });

    test('keys are ignored while typing in a text field', async ({ page }) => {
        await page.goto(ARTICLE_URL);
        await waitForInit(page);
        // Inject and focus a textarea (Pinkbike's own reply box needs a
        // login). Then collect any [pb nav] logs while we type a key
        // that would otherwise navigate.
        await page.evaluate(() => {
            const ta = document.createElement('textarea');
            ta.id = '__test_input';
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
            if (t.startsWith('[pb nav]') && !t.startsWith('[pb nav] keys:') &&
                !t.startsWith('[pb nav] init')) {
                logs.push(t);
            }
        };
        page.on('console', handler);
        await page.keyboard.press('j');
        await page.waitForTimeout(400);
        page.off('console', handler);
        expect(logs).toEqual([]);
    });
});
