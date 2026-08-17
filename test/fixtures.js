// Shared Playwright fixtures for userscript tests.
//
// We do NOT launch the browser from Playwright. Google detects the
// automation flags and blocks sign-in when launchPersistentContext is
// used. Instead, the user starts Chromium manually with a debugging
// port (see scripts/open-browser.sh), logs in to test sites once, and
// leaves it running. Tests connect over CDP and reuse the existing
// authenticated context.
//
// Tests should import from this file rather than `@playwright/test`
// directly:
//
//     const { test, expect } = require('../../test/fixtures');
//
// Workflow:
//
//     # one shell, leave running
//     scripts/open-browser.sh https://feedly.com
//     # second shell, after logging in once
//     pnpm test

const fs = require('fs');
const path = require('path');
const base = require('@playwright/test');
const { chromium } = require('@playwright/test');

const REPO_ROOT = path.resolve(__dirname, '..');
// Port 9233 is project-specific — distinct from SeeWhatISee's 9222
// so both can run at the same time without tests hitting the wrong
// browser. Override via PLAYWRIGHT_CDP if needed.
const CDP_ENDPOINT = process.env.PLAYWRIGHT_CDP || 'http://127.0.0.1:9233';

function readUserscriptBody(scriptPath) {
  const src = fs.readFileSync(scriptPath, 'utf8');
  // Strip the metadata block; Tampermonkey directives are no-ops in
  // raw browser context. Whatever follows is the IIFE we want to run.
  return src.replace(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==\s*/, '');
}

// Mirror the @run-at document-idle behavior. addInitScript runs at
// document_start, before any DOM exists; wrap so the script body only
// executes after window 'load' (the closest equivalent to
// Tampermonkey's document-idle).
function wrapForDocumentIdle(body) {
  return `
    (function () {
      function __jshute_userscript_start() {
        ${body}
      }
      if (document.readyState === 'complete') {
        __jshute_userscript_start();
      } else {
        window.addEventListener('load', __jshute_userscript_start, { once: true });
      }
    })();
  `;
}

const test = base.test.extend({
  // Connect to the user-launched Chromium over CDP. The browser must
  // already be running (scripts/open-browser.sh). We never close it
  // — that would discard the manual login.
  browser: async ({}, use) => {
    let browser;
    try {
      browser = await chromium.connectOverCDP(CDP_ENDPOINT);
    } catch (err) {
      throw new Error(
        `Could not connect to Chromium at ${CDP_ENDPOINT}.\n` +
        `Run \`scripts/open-browser.sh\` in another terminal first.\n` +
        `Original error: ${err.message}`
      );
    }
    await use(browser);
    // For a CDP-attached browser, browser.close() only severs the
    // CDP connection — the underlying Chromium process keeps
    // running. So this *is* the disconnect call; the user's
    // manually-launched session and login state are preserved.
    await browser.close();
  },

  // Reuse the persistent context that the manual launch already
  // created. CDP exposes it as the first context on the browser.
  context: async ({ browser }, use) => {
    const contexts = browser.contexts();
    if (contexts.length === 0) {
      throw new Error('No browser context found over CDP. Is the browser fully started?');
    }
    await use(contexts[0]);
    // Don't close the context — it's the user's persistent profile.
  },

  // Open a fresh page for each test, and close it after. Avoids
  // accumulating tabs and keeps init scripts page-scoped.
  page: async ({ context }, use) => {
    const page = await context.newPage();
    // Forward in-page console output to the test runner. Userscripts
    // log with `[name]` prefixes for debugging; surfacing these in
    // test output makes failures much easier to diagnose.
    page.on('console', msg => {
      const text = msg.text();
      // Skip Feedly's own noisy info logs unless they hint at an
      // error; keep anything from a userscript-style `[name]` tag.
      if (/^\[[^\]]+\]/.test(text) || msg.type() === 'error') {
        console.log(`  page-${msg.type()}: ${text}`);
      }
    });
    page.on('pageerror', err => {
      console.log(`  page-error: ${err.message}`);
    });
    await use(page);
    await page.close();
  },

  // Inject a userscript into the test page. Page-scoped so it
  // disappears when the page closes — no leftover scripts in the
  // user's persistent context between runs.
  loadUserscript: async ({ page }, use) => {
    await use(async (scriptPath) => {
      const abs = path.isAbsolute(scriptPath)
        ? scriptPath
        : path.join(REPO_ROOT, scriptPath);
      const wrapped = wrapForDocumentIdle(readUserscriptBody(abs));
      await page.addInitScript({ content: wrapped });
    });
  },
});

module.exports = {
  test,
  expect: base.expect,
  REPO_ROOT,
  CDP_ENDPOINT,
};
