// Playwright config for the userscripts repo.
//
// Tests for individual userscripts live next to the script itself
// (e.g. sites/feedly.com/sort-filter-presets.spec.js). Shared fixtures
// and helpers live in test/. Tests attach to a Chromium that the user
// launches manually via scripts/open-browser.sh — see test/fixtures.js
// for why (Google blocks sign-in when Playwright launches Chromium).

const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    // Each site's userscript has its tests next to the script.
    testMatch: 'sites/**/*.spec.js',

    // We share a single browser context (the user's logged-in profile)
    // across all tests, so parallel workers would step on each other.
    fullyParallel: false,
    workers: 1,

    use: {
        // Generous timeouts; SPA renders can be slow on cold start.
        actionTimeout: 10000,
        navigationTimeout: 30000,
    },

    reporter: [['list']],
    timeout: 60000,
});
