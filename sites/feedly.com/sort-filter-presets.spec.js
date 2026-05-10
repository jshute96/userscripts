// Tests for sort-filter-presets.user.js.
//
// These tests need a Feedly login in the persistent profile. Run the
// browser launcher in one terminal and leave it running:
//
//     scripts/open-browser.sh https://feedly.com
//
// Log in once (the profile dir persists the session). Then in a
// second terminal:
//
//     npm test
//
// You can override the feed under test with the FEEDLY_FEED_URL env
// var; otherwise we use a public-ish feed the user is subscribed to.

const path = require('path');
const { test, expect } = require('../../test/fixtures');

const SCRIPT_PATH = path.join(__dirname, 'sort-filter-presets.user.js');

// A subscription/feed page in the user's Feedly. Override via env var
// for ad-hoc testing of a different feed.
const FEED_URL = process.env.FEEDLY_FEED_URL
    || 'https://feedly.com/i/subscription/content/feed%2Fhttps%3A%2F%2Fgarbageday.substack.com%2Ffeed%2F';

// Open the three-dots menu and read back the current Sort by / Filter
// by summary text from the main menu — the <p> sibling of each label
// span shows e.g. "Oldest" / "1 enabled". We force a fresh open from
// a closed state because polling readers may catch the userscript
// mid-flow (e.g. with a submenu still showing).
async function readMenuState(page) {
    const moreBtn = page.locator('.StreamPage header button[aria-haspopup="listbox"]');
    // Press Escape until the popup fully collapses. Toggling the
    // trigger button doesn't reliably dismiss from a submenu state.
    for (let i = 0; i < 5 && (await moreBtn.getAttribute('aria-expanded')) === 'true'; i++) {
        await page.keyboard.press('Escape');
        await page.waitForTimeout(100);
    }
    await moreBtn.click();
    // Filter the menuitems to those whose own descendants include the
    // label text. The submenu breadcrumb's role="menuitem" button has
    // no descendant text (just an SVG), so this reliably picks the
    // main-menu row even if remnants of a submenu are still mounting.
    const sortItem = page.locator('[role="menuitem"]', { hasText: 'Sort by' }).first();
    await expect(sortItem).toBeVisible();
    const sortValue = (await sortItem.locator('p').innerText()).trim();
    const filterItem = page.locator('[role="menuitem"]', { hasText: 'Filter by' }).first();
    const filterValue = (await filterItem.locator('p').innerText()).trim();
    // Close before returning so the next poll tick starts clean.
    await page.keyboard.press('Escape');
    // "1 enabled" / "0 enabled" — we only care whether the unread
    // filter is on, and the only filter we set is Unread Only.
    return { sort: sortValue, filter: filterValue };
}

// applyPreset() in the userscript is fire-and-forget from the click
// handler, so we can't simply await the click. Wait for the userscript
// to log its completion line before reading state.
async function clickPresetAndWait(page, preset) {
    const done = page.waitForEvent('console', {
        predicate: msg => msg.text() === `[feedly presets] preset applied: ${preset}`,
        timeout: 15000,
    });
    await page.locator(`button[data-jshute-preset="${preset}"]`).click();
    await done;
}

test.describe('feedly sort/filter presets', () => {
    test.beforeEach(async ({ loadUserscript }) => {
        await loadUserscript(SCRIPT_PATH);
    });

    test('injects Oldest and Newest buttons in the header toolbar', async ({ page }) => {
        await page.goto(FEED_URL);
        // The header has to render before our MutationObserver finds it.
        await expect(page.locator('.StreamPage header')).toBeVisible();
        const oldest = page.locator('button[data-jshute-preset="oldest"]');
        const newest = page.locator('button[data-jshute-preset="newest"]');
        await expect(oldest).toBeVisible();
        await expect(newest).toBeVisible();
        await expect(oldest).toHaveText('Oldest');
        await expect(newest).toHaveText('Newest');
    });

    test('Newest preset sets Sort=Newest, Filter=0 enabled', async ({ page }) => {
        await page.goto(FEED_URL);
        await clickPresetAndWait(page, 'newest');
        const state = await readMenuState(page);
        expect(state.sort).toBe('Newest');
        expect(state.filter).toMatch(/^0/);
    });

    test('Oldest preset sets Sort=Oldest, Filter≥1 enabled', async ({ page }) => {
        await page.goto(FEED_URL);
        await clickPresetAndWait(page, 'oldest');
        const state = await readMenuState(page);
        expect(state.sort).toBe('Oldest');
        // We expect at least Unread Only enabled. Other filters may
        // already be on for this user; we only care that ours is set.
        expect(state.filter).not.toMatch(/^0/);
    });
});
