// Tests for activity-tcx-download.user.js.
//
// Needs a Garmin Connect login in the persistent profile. The tests
// pick whichever activity appears first on /app/activities — no need to
// hardcode an ID. Override via GARMIN_ACTIVITY_ID for ad-hoc runs.
//
//     scripts/open-browser.sh https://connect.garmin.com/app/home
//     pnpm test

const path = require('path');
const { test, expect } = require('../../test/fixtures');

const SCRIPT_PATH = path.join(__dirname, 'activity-tcx-download.user.js');
const BUTTON_ID = 'jshute-garmin-tcx-download-btn';

// Cache the discovered activity id across tests in this worker so we
// only visit /app/activities once.
let cachedActivityId = null;
async function getActivityId(page) {
  if (cachedActivityId) return cachedActivityId;
  if (process.env.GARMIN_ACTIVITY_ID) {
    cachedActivityId = process.env.GARMIN_ACTIVITY_ID;
    return cachedActivityId;
  }
  await page.goto('https://connect.garmin.com/app/activities');
  const href = await page.locator('a[href*="/app/activity/"]').first()
    .getAttribute('href', { timeout: 30000 });
  const m = href && href.match(/\/app\/activity\/(\d+)/);
  if (!m) {
    throw new Error(
      `Couldn't find an activity link on /app/activities (href=${href}). ` +
      `Are you logged in to Garmin Connect in the persistent profile?`
    );
  }
  cachedActivityId = m[1];
  return cachedActivityId;
}

test.describe('Garmin Connect: TCX download button on activity page', () => {
  test.beforeEach(async ({ loadUserscript }) => {
    await loadUserscript(SCRIPT_PATH);
  });

  test('inserts a download button to the right of the gear ("More…") icon', async ({ page }) => {
    const activityId = await getActivityId(page);
    await page.goto(`https://connect.garmin.com/app/activity/${activityId}`);
    const btn = page.locator('#' + BUTTON_ID);
    await expect(btn).toBeVisible({ timeout: 15000 });

    const placement = await page.evaluate((id) => {
      const b = document.getElementById(id);
      // Same gear lookup the userscript uses.
      const container = document.querySelector('[class*="ActivitySettingsMenu_menuContainer"]');
      const gear = container.querySelector('button[class*="Menu_menuBtn"]');
      const br = b.getBoundingClientRect();
      const gr = gear.getBoundingClientRect();
      return { btnX: br.x, gearX: gr.x, sameRow: Math.abs(br.y - gr.y) < 30 };
    }, BUTTON_ID);
    expect(placement.btnX).toBeGreaterThan(placement.gearX);
    expect(placement.sameRow).toBe(true);
  });

  test('click triggers a TCX download for the activity', async ({ page }) => {
    const activityId = await getActivityId(page);
    await page.goto(`https://connect.garmin.com/app/activity/${activityId}`);
    const btn = page.locator('#' + BUTTON_ID);
    await expect(btn).toBeVisible({ timeout: 15000 });

    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await btn.click();
    const download = await downloadPromise;
    // Garmin names the file activity_<id>.tcx
    expect(download.suggestedFilename()).toBe(`activity_${activityId}.tcx`);
  });
});
