// Tests for download-activities-button.user.js.
//
// Needs a Garmin Connect login in the persistent profile. Run the
// browser launcher in one terminal and leave it running:
//
//     scripts/open-browser.sh https://connect.garmin.com/app/home
//
// Log in once, then in a second terminal:
//
//     npm test

const path = require('path');
const { test, expect } = require('../../test/fixtures');

const SCRIPT_PATH = path.join(__dirname, 'download-activities-button.user.js');
const HOME_URL = 'https://connect.garmin.com/app/home';
const BUTTON_ID = 'jshute-garmin-download-activities-btn';

test.describe('Garmin Connect: Download activities button', () => {
  test.beforeEach(async ({ loadUserscript }) => {
    await loadUserscript(SCRIPT_PATH);
  });

  test('inserts a button labeled "Download activities" next to the nav toggle', async ({ page }) => {
    await page.goto(HOME_URL);
    const btn = page.locator('#' + BUTTON_ID);
    await expect(btn).toBeVisible({ timeout: 10000 });
    await expect(btn).toHaveText('Download activities');
    // It should be the immediate next sibling of the nav toggle.
    const isImmediateSibling = await page.evaluate((id) => {
      const b = document.getElementById(id);
      const t = document.querySelector('button[class*="TopHeaderBarView_navToggle"]');
      return !!(b && t && t.nextElementSibling === b);
    }, BUTTON_ID);
    expect(isImmediateSibling).toBe(true);
  });

  test('upgrades to Garmin secondary-button styling once a reference button renders', async ({ page }) => {
    await page.goto(HOME_URL);
    const btn = page.locator('#' + BUTTON_ID);
    await expect(btn).toBeVisible({ timeout: 10000 });
    // Wait for the observer to upgrade the className. The "Edit
    // Home" button at the bottom of the page is the canonical
    // secondary-medium button we mimic.
    await expect.poll(
      async () => await btn.evaluate(b => b.className),
      { timeout: 15000 }
    ).toMatch(/Button_secondary/);
    const cs = await btn.evaluate(b => {
      const s = getComputedStyle(b);
      return { bg: s.backgroundColor, color: s.color, padding: s.padding };
    });
    // Edit Home computes to bg rgb(216,216,216), color rgb(16,16,16),
    // padding 8px 16px. Match those exactly.
    expect(cs.bg).toBe('rgb(216, 216, 216)');
    expect(cs.color).toBe('rgb(16, 16, 16)');
    expect(cs.padding).toBe('8px 16px');
  });

  test('click navigates this tab to /app/activities and opens Strava upload in a new tab', async ({ page, context }) => {
    await page.goto(HOME_URL);
    const btn = page.locator('#' + BUTTON_ID);
    await expect(btn).toBeVisible({ timeout: 10000 });

    const newPagePromise = context.waitForEvent('page', { timeout: 5000 });
    await btn.click();

    // The script's order: open Strava first, then navigate this tab.
    const newPage = await newPagePromise;
    await page.waitForURL('**/app/activities*', { timeout: 10000 });
    // The new tab's URL ends up at /upload/select OR /login (if the
    // profile isn't signed into Strava). Either way, it's strava.com.
    await newPage.waitForLoadState('domcontentloaded').catch(() => {});
    expect(newPage.url()).toMatch(/^https:\/\/(www\.)?strava\.com\//);
    await newPage.close();
  });
});
