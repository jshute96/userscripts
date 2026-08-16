// Tests for upload-to-strava.user.js.
//
// These cover the Garmin toolbar buttons and the Strava menu item.
//
// The script uses GM storage on its init path, and the fixture runs the
// raw body with no userscript manager, so these specs inject the fakes
// from test/gm-stubs.js first. That is enough to let the script start;
// it is NOT coverage of the transfer itself, which needs two tabs and a
// real manager to carry values between them. See CLAUDE.md → Testing.
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
const { injectGmStubs } = require('../../test/gm-stubs');

const SCRIPT_PATH = path.join(__dirname, 'upload-to-strava.user.js');
const HOME_URL = 'https://connect.garmin.com/app/home';
const STRAVA_URL = 'https://www.strava.com/dashboard';
const STRAVA_ITEM_ID = 'jshute-strava-upload-from-garmin';
const ACTIVITIES_BUTTON_ID = 'jshute-garmin-activities-btn';
const UPLOAD_BUTTON_ID = 'jshute-garmin-upload-to-strava-btn';

test.describe('Garmin Connect → Strava: Upload new activities with one click', () => {
  test.beforeEach(async ({ page, loadUserscript }) => {
    // Must come first: the stubs have to exist when the body runs.
    // A seeded history keeps the badges deterministic — without it
    // loadSeen() returns null and nothing is badged.
    await injectGmStubs(page, { values: { seenActivityIds: [] } });
    await loadUserscript(SCRIPT_PATH);
  });

  test('inserts Activities and Upload to Strava after the nav toggle', async ({ page }) => {
    await page.goto(HOME_URL);
    const activities = page.locator('#' + ACTIVITIES_BUTTON_ID);
    const upload = page.locator('#' + UPLOAD_BUTTON_ID);
    await expect(activities).toBeVisible({ timeout: 10000 });
    await expect(activities).toHaveText('Activities');
    await expect(upload).toBeVisible();
    await expect(upload).toHaveText('Upload to Strava');

    // Order in the toolbar: toggle, Activities, Upload to Strava.
    const order = await page.evaluate(([aId, dId]) => {
      const a = document.getElementById(aId);
      const d = document.getElementById(dId);
      const toggle = document.querySelector('button[class*="TopHeaderBarView_navToggle"]');
      return {
        activitiesAfterToggle: !!(toggle && toggle.nextElementSibling === a),
        uploadAfterActivities: !!(a && a.nextElementSibling === d),
      };
    }, [ACTIVITIES_BUTTON_ID, UPLOAD_BUTTON_ID]);
    expect(order).toEqual({ activitiesAfterToggle: true, uploadAfterActivities: true });
  });

  test('upgrades to Garmin secondary-button styling once a reference button renders', async ({ page }) => {
    await page.goto(HOME_URL);
    const btn = page.locator('#' + UPLOAD_BUTTON_ID);
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

  test('Activities navigates this tab to the activities list', async ({ page }) => {
    await page.goto(HOME_URL);
    const btn = page.locator('#' + ACTIVITIES_BUTTON_ID);
    await expect(btn).toBeVisible({ timeout: 10000 });
    await btn.click();
    await page.waitForURL('**/app/activities*', { timeout: 10000 });
  });

  test('Upload to Strava navigates to the list when clicked elsewhere', async ({ page }) => {
    // Off the activities list there is nothing to diff against, so the
    // button only gets you there — no tabs opened, no transfer started.
    await page.goto(HOME_URL);
    const btn = page.locator('#' + UPLOAD_BUTTON_ID);
    await expect(btn).toBeVisible({ timeout: 10000 });

    let opened = 0;
    page.context().on('page', () => { opened += 1; });
    await btn.click();
    await page.waitForURL('**/app/activities*', { timeout: 10000 });
    expect(opened).toBe(0);
  });

  test('adds "Upload from Garmin" above "Upload activity" in Strava\'s upload menu', async ({ page }) => {
    await page.goto(STRAVA_URL);
    const item = page.locator('#' + STRAVA_ITEM_ID);
    await expect(item).toHaveCount(1, { timeout: 10000 });

    const menu = await page.evaluate((id) => {
      const list = document.querySelector('li.upload-menu ul.options');
      const ours = document.getElementById(id);
      return {
        isFirst: !!(list && list.firstElementChild === ours),
        labels: [...list.querySelectorAll('li > a')].map(a => a.textContent.trim()),
        href: ours.querySelector('a').getAttribute('href'),
      };
    }, STRAVA_ITEM_ID);

    expect(menu.isFirst).toBe(true);
    expect(menu.labels.slice(0, 2)).toEqual(['Upload from Garmin', 'Upload activity']);
    expect(menu.href).toBe('https://connect.garmin.com/app/activities#upload-from-garmin');
  });
});
