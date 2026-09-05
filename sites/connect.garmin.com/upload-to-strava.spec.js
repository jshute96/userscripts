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
//     pnpm test

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
    // Nothing is seeded: what counts as new is now read off Strava
    // through GM_xmlhttpRequest, which the fixture has no fake for, so
    // the badge fetch fails harmlessly and no row is badged. These
    // specs cover the buttons and the menu item, not the diff.
    await injectGmStubs(page);
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

  // There is no test for clicking Upload to Strava. Everything past the
  // click is GM_xmlhttpRequest against Garmin's API, and a fake for that
  // would be a fake of the entire feature — see CLAUDE.md → Testing.

  // The guard reads the DOM rather than GM storage, so a second
  // addInitScript is a genuine second copy in one document.
  test('a second copy stands down and says so on screen', async ({ page, loadUserscript }) => {
    // beforeEach already loaded one copy; this is the duplicate.
    await loadUserscript(SCRIPT_PATH);
    await page.goto(HOME_URL);

    const status = page.locator('#jshute-garmin-strava-status');
    await expect(status).toBeVisible({ timeout: 10000 });
    await expect(status).toContainText('Two copies');
    // Red, not the neutral progress background — this is an error.
    await expect(status).toHaveCSS('background-color', 'rgba(140, 26, 26, 0.94)');

    // The copy that stood down did so before initializing: one set of
    // buttons, and one status panel rather than two.
    await expect(page.locator('#' + ACTIVITIES_BUTTON_ID)).toHaveCount(1);
    await expect(page.locator('#' + UPLOAD_BUTTON_ID)).toHaveCount(1);
    await expect(status).toHaveCount(1);
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
    expect(menu.href).toBe('https://www.strava.com/upload/select#upload-from-garmin');
  });

  test('"Upload from Garmin" stays put when Garmin says sign in', async ({ page }) => {
    // The click now checks Garmin *before* navigating, so a check that
    // can't get past the sign-in page must leave the tab where it was.
    // Faking the one request the check starts with is enough to reach
    // that decision without a real Garmin session.
    await page.goto(STRAVA_URL);
    await expect(page.locator('#' + STRAVA_ITEM_ID)).toHaveCount(1, { timeout: 10000 });
    await page.evaluate(() => {
      window.__probes = [];
      window.GM_xmlhttpRequest = ({ url, onload }) => {
        window.__probes.push(url);
        onload({
          status: 200, finalUrl: 'https://connect.garmin.com/signin/', responseText: '',
        });
      };
    });

    let opened = 0;
    page.context().on('page', () => { opened += 1; });
    const before = page.url();
    // The item is inside a closed drop-down, so click it directly rather
    // than through the locator's visibility check.
    await page.evaluate((id) => document.getElementById(id).querySelector('a').click(),
      STRAVA_ITEM_ID);

    const status = page.locator('#jshute-garmin-strava-status');
    await expect(status).toContainText("not signed in to Garmin", { timeout: 10000 });
    // Every probe failure gets a second look before we believe it —
    // Garmin bounces the first request of a run to /signin often enough
    // that one attempt is not evidence of a lapsed session.
    expect(await page.evaluate(() => window.__probes)).toEqual([
      'https://connect.garmin.com/app/activities',
      'https://connect.garmin.com/app/activities',
    ]);
    expect(page.url()).toBe(before);
    // The sign-in page is offered in a tab of its own — through
    // GM_openInTab, which the stubs record rather than open.
    expect(opened).toBe(0);
    expect(await page.evaluate(() => window.__gmStubs.openedTabs.map(t => t.url)))
      .toEqual(['https://connect.garmin.com/signin/']);
  });
});
