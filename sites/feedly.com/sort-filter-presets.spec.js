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
// The tests pick whichever feed appears first on /i/feedIndex — no
// need to hardcode a subscription URL. Override via FEEDLY_FEED_URL
// for ad-hoc runs.

const path = require('path');
const { test, expect } = require('../../test/fixtures');

const SCRIPT_PATH = path.join(__dirname, 'sort-filter-presets.user.js');

// Cache the discovered feed URL across tests in this worker so we
// only visit /i/feedIndex once.
let cachedFeedUrl = null;
async function getFeedUrl(page) {
  if (cachedFeedUrl) return cachedFeedUrl;
  if (process.env.FEEDLY_FEED_URL) {
    cachedFeedUrl = process.env.FEEDLY_FEED_URL;
    return cachedFeedUrl;
  }
  await page.goto('https://feedly.com/i/feedIndex');
  const href = await page.locator('a[href*="/i/subscription/content/feed"]').first()
    .getAttribute('href', { timeout: 30000 });
  if (!href) {
    throw new Error(
      "Couldn't find a subscription/feed link on /i/feedIndex. " +
      "Are you logged in to Feedly in the persistent profile?"
    );
  }
  cachedFeedUrl = new URL(href, 'https://feedly.com').href;
  return cachedFeedUrl;
}

// Open the three-dots menu and read back the current Sort by / Filter
// by summary text from the main menu — the <p> sibling of each label
// span shows e.g. "Oldest" / "1 enabled". We force a fresh open from
// a closed state because polling readers may catch the userscript
// mid-flow (e.g. with a submenu still showing).
async function readMenuState(page) {
  const moreBtn = page.locator('.FeedPage header button[aria-haspopup="listbox"]');
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
    await page.goto(await getFeedUrl(page));
    // The header has to render before our MutationObserver finds it.
    await expect(page.locator('.FeedPage header')).toBeVisible();
    const oldest = page.locator('button[data-jshute-preset="oldest"]');
    const newest = page.locator('button[data-jshute-preset="newest"]');
    await expect(oldest).toBeVisible();
    await expect(newest).toBeVisible();
    await expect(oldest).toHaveText('Oldest');
    await expect(newest).toHaveText('Newest');
  });

  test('Newest preset sets Sort=Newest, Filter=0 enabled', async ({ page }) => {
    await page.goto(await getFeedUrl(page));
    await clickPresetAndWait(page, 'newest');
    const state = await readMenuState(page);
    expect(state.sort).toBe('Newest');
    expect(state.filter).toMatch(/^0/);
  });

  test('Oldest preset sets Sort=Oldest, Filter≥1 enabled', async ({ page }) => {
    await page.goto(await getFeedUrl(page));
    await clickPresetAndWait(page, 'oldest');
    const state = await readMenuState(page);
    expect(state.sort).toBe('Oldest');
    // We expect at least Unread Only enabled. Other filters may
    // already be on for this user; we only care that ours is set.
    expect(state.filter).not.toMatch(/^0/);
  });
});
