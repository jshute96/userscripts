// Tests for upload-to-strava.user.js.
//
// These cover the Garmin toolbar buttons and the Strava menu item.
//
// GM storage and GM_openInTab run for real here (the harness supplies
// the manager's half), so the script starts as it would installed, and
// a test can answer a GM_xmlhttpRequest itself. This is still NOT
// coverage of the transfer, which needs a Strava session as well as a
// Garmin one. See CLAUDE.md → Testing.
//
// Needs a Garmin Connect login in the persistent profile. Run the
// browser launcher in one terminal and leave it running:
//
//     scripts/open-browser.sh https://connect.garmin.com/app/home
//
// Log in once, then in a second terminal:
//
//     pnpm test

import path from 'node:path';
import { test, expect } from '../../test/fixtures.js';

const SCRIPT_PATH = path.join(import.meta.dirname, 'upload-to-strava.user.js');
const HOME_URL = 'https://connect.garmin.com/app/home';
const STRAVA_URL = 'https://www.strava.com/dashboard';
const STRAVA_ITEM_ID = 'jshute-strava-upload-from-garmin';
const ACTIVITIES_BUTTON_ID = 'jshute-garmin-activities-btn';
const UPLOAD_BUTTON_ID = 'jshute-garmin-upload-to-strava-btn';

test.describe('Garmin Connect → Strava: Upload new activities with one click', () => {
  test.beforeEach(async ({ loadUserscript }) => {
    // Nothing is seeded: what counts as new is read off Strava through
    // GM_xmlhttpRequest, which really runs here but needs a Strava
    // session, so the badge fetch fails harmlessly and no row is
    // badged. These specs cover the buttons and the menu item, not the
    // diff.
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

  // Two installed copies of the script in one document, which is what
  // the guard is written against. `copy` is what makes the second load
  // a separate script rather than a replacement of the first: its own
  // id, its own storage, as a second install would have.
  test('a second copy stands down and says so on screen', async ({ page, loadUserscript }) => {
    // beforeEach already loaded one copy; this is the duplicate.
    await loadUserscript(SCRIPT_PATH, { copy: 'second-install' });
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

  test('"Upload from Garmin" stays put when Garmin says sign in', async ({ page, gm }) => {
    // The click now checks Garmin *before* navigating, so a check that
    // can't get past the sign-in page must leave the tab where it was.
    // Answering the one request the check starts with is enough to
    // reach that decision without a real Garmin session. The answer
    // comes from the test rather than from a patched global: the
    // script's `GM_xmlhttpRequest` is a binding in its own scope, and
    // in its own world, so nothing the page assigns could reach it.
    await page.goto(STRAVA_URL);
    await expect(page.locator('#' + STRAVA_ITEM_ID)).toHaveCount(1, { timeout: 10000 });
    gm.interceptRequests(() => ({
      kind: 'load',
      response: {
        status: 200, statusText: 'OK', responseText: '', response: '',
        responseHeaders: '', responseURL: 'https://connect.garmin.com/signin/',
        finalUrl: 'https://connect.garmin.com/signin/',
      },
    }));

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
    expect(gm.requests().map((r) => r.url)).toEqual([
      'https://connect.garmin.com/app/activities',
      'https://connect.garmin.com/app/activities',
    ]);
    // This tab stayed where it was; the sign-in page was offered in one
    // of its own, through GM_openInTab. The harness opens that for
    // real and closes it when the test ends.
    expect(page.url()).toBe(before);
    expect(gm.openedTabs().map((t) => t.url))
      .toEqual(['https://connect.garmin.com/signin/']);
  });
});
