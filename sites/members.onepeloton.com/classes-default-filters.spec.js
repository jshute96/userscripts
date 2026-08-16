// Tests for classes-default-filters.user.js.
//
// These tests need a Peloton Members login in the persistent profile.
// Run the browser launcher in one terminal and leave it running:
//
//     scripts/open-browser.sh https://members.onepeloton.com/classes/strength
//
// Log in once (the profile dir persists the session). Then in a
// second terminal:
//
//     npm test

const path = require('path');
const { test, expect } = require('../../test/fixtures');
const { injectGmStubs } = require('../../test/gm-stubs');

const SCRIPT_PATH = path.join(__dirname, 'classes-default-filters.user.js');

const EXPECTED_DIFFICULTY = encodeURIComponent(
  JSON.stringify(['intermediate', 'advanced']));
const EXPECTED_HAS_WORKOUT = encodeURIComponent(JSON.stringify(['false']));

// Match a category-tab anchor for a given slug. The same /classes/<slug>
// path also appears in class-card links (with `classId=…`); we exclude
// those so we get the nav tab.
function tabSelector(slug) {
  return `a[href^="/classes/${slug}"]:not([href*="classId="])`;
}

// Read the rewritten href on a visible category tab, asserting that
// it carries both filter params. Returns the href so individual tests
// can do further checks.
async function readTabHref(page, slug) {
  const tab = page.locator(tabSelector(slug)).first();
  await expect(tab).toBeVisible();
  const href = await tab.getAttribute('href');
  expect(href).toMatch(new RegExp(`difficulty_level=${EXPECTED_DIFFICULTY}`));
  expect(href).toMatch(new RegExp(`has_workout=${EXPECTED_HAS_WORKOUT}`));
  return href;
}

test.describe('peloton classes default filters', () => {
  // The script reads its saved config from GM storage at init, so
  // without stubs `GM_getValue` throws and the whole IIFE aborts —
  // no observer, no href rewriting, every test here failing on an
  // unrewritten href. Seeding nothing is what we want: with no saved
  // config the script falls back to HARDCODED_DEFAULTS, which is
  // what EXPECTED_DIFFICULTY / EXPECTED_HAS_WORKOUT below encode.
  test.beforeEach(async ({ page, loadUserscript }) => {
    await injectGmStubs(page, { values: {} });
    await loadUserscript(SCRIPT_PATH);
  });

  test('rewrites category-tab hrefs to embed filter params', async ({ page }) => {
    await page.goto('https://members.onepeloton.com/classes/strength');
    // The tabs render asynchronously after hydration; the
    // MutationObserver in the userscript picks them up on its next
    // animation frame. waitFor handles either ordering.
    for (const slug of ['strength', 'yoga', 'cardio', 'stretching']) {
      await readTabHref(page, slug);
    }
  });

  test('does not rewrite class-detail links (those with classId)', async ({ page }) => {
    await page.goto('https://members.onepeloton.com/classes/strength');
    // Wait for the listings to render so class-card anchors exist.
    await expect(page.locator('a[href*="classId="]').first()).toBeVisible({ timeout: 15000 });
    const detailHrefs = await page.$$eval('a[href*="classId="]',
      els => els.map(e => e.getAttribute('href')));
    expect(detailHrefs.length).toBeGreaterThan(0);
    // None of them should carry our filter params — those are for
    // category-level listings, not single-class overlays.
    for (const h of detailHrefs) {
      expect(h).not.toMatch(/difficulty_level=/);
      expect(h).not.toMatch(/has_workout=/);
    }
  });

  test('clicking a category tab lands on the filtered URL', async ({ page }) => {
    await page.goto('https://members.onepeloton.com/classes/strength');
    await readTabHref(page, 'yoga'); // ensures rewrite has happened
    // The click handler is capture-phase + location.assign — that
    // triggers a full navigation. Wait for the URL to update.
    await Promise.all([
      page.waitForURL(/\/classes\/yoga\?.*difficulty_level=/, { timeout: 15000 }),
      page.locator(tabSelector('yoga')).first().click(),
    ]);
    const url = page.url();
    expect(url).toMatch(new RegExp(`difficulty_level=${EXPECTED_DIFFICULTY}`));
    expect(url).toMatch(new RegExp(`has_workout=${EXPECTED_HAS_WORKOUT}`));
  });

  test('Stretching (no Difficulty section) still loads with has_workout filter', async ({ page }) => {
    // Stretching's Filter dialog has no Difficulty section. Peloton
    // silently ignores `difficulty_level` for this category but
    // honours `has_workout`, so the filter-count badge should read
    // "1" once the page is loaded.
    await page.goto('https://members.onepeloton.com/classes/strength');
    await readTabHref(page, 'stretching');
    await Promise.all([
      page.waitForURL(/\/classes\/stretching\?.*has_workout=/, { timeout: 15000 }),
      page.locator(tabSelector('stretching')).first().click(),
    ]);
    // Filter button shows a count badge once filters are active.
    // The badge mounts when the classes API call returns, so allow
    // some time.
    const badge = page.locator(
      'button[data-test-id="filterButton"] [data-test-id="filterCount"],' +
      ' button[data-test-id="mobileFilterButton"] [data-test-id="filterCount"]'
    ).first();
    await expect(badge).toBeVisible({ timeout: 15000 });
    await expect(badge).toHaveText('1');
  });
});
