// Tests for activity-tcx-download.user.js.
//
// Needs a Garmin Connect login in the persistent profile. The default
// activity ID below is the one the script was developed against; override
// via the GARMIN_ACTIVITY_ID env var to test against your own.
//
//     scripts/open-browser.sh https://connect.garmin.com/app/home
//     npm test

const path = require('path');
const { test, expect } = require('../../test/fixtures');

const SCRIPT_PATH = path.join(__dirname, 'activity-tcx-download.user.js');
const ACTIVITY_ID = process.env.GARMIN_ACTIVITY_ID || '22814530018';
const ACTIVITY_URL = `https://connect.garmin.com/app/activity/${ACTIVITY_ID}`;
const BUTTON_ID = 'jshute-garmin-tcx-download-btn';

test.describe('Garmin Connect: TCX download button on activity page', () => {
    test.beforeEach(async ({ loadUserscript }) => {
        await loadUserscript(SCRIPT_PATH);
    });

    test('inserts a download button to the right of the gear ("More…") icon', async ({ page }) => {
        await page.goto(ACTIVITY_URL);
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
        await page.goto(ACTIVITY_URL);
        const btn = page.locator('#' + BUTTON_ID);
        await expect(btn).toBeVisible({ timeout: 15000 });

        const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
        await btn.click();
        const download = await downloadPromise;
        // Garmin names the file activity_<id>.tcx
        expect(download.suggestedFilename()).toBe(`activity_${ACTIVITY_ID}.tcx`);
    });
});
