// Shared Playwright fixtures for userscript tests.
//
// The manager's half comes from SourceMonkey's development harness
// (`sourcemonkey/harness`): a script is prepared with the extension's
// own install pipeline (header validation, `@match`, `@require` with
// the local `lib/` overrides, `@grant` bindings) and injected into the
// page behind its real prelude and GM runtime, with a Node host
// standing in for the service worker. So `GM_*` calls work, the header
// decides where the script runs, and a script's errors are reported
// against it. See docs/harness-guide.md in the SourceMonkey repo.
//
// What this file adds is the browser policy: we do NOT launch the
// browser from Playwright. Google detects the automation flags and
// blocks sign-in when launchPersistentContext is used. Instead, the
// user starts Chromium manually with a debugging port (see
// scripts/open-browser.sh), logs in to test sites once, and leaves it
// running. Tests connect over CDP and reuse the existing authenticated
// context.
//
// With TEMP_BROWSER=1, specs use the harness's own browser instead:
// a hidden Chromium with SourceMonkey loaded, launched per Playwright
// worker and closed after the run. It has no logins, so it suits specs
// that serve saved pages or need no sign-in. `--headed` shows it.
//
// Tests import from this file rather than `sourcemonkey/harness`
// directly:
//
//     import { test, expect } from '../../test/fixtures.js';
//
// Workflow:
//
//     # one shell, leave running
//     scripts/open-browser.sh https://feedly.com
//     # second shell, after logging in once
//     pnpm test
//
//     # or, with no browser to start first
//     pnpm test:temp

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { test as harnessTest } from 'sourcemonkey/harness';

export const REPO_ROOT = path.resolve(import.meta.dirname, '..');

// The collection a script belongs to: the nearest directory above it
// with a script_manifest.json. A sibling collection's specs import
// these fixtures too, and their scripts' `lib/` is their own.
function findCollectionRoot(file) {
  if (!file) return REPO_ROOT;
  let dir = path.dirname(path.resolve(file));
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'script_manifest.json'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  return REPO_ROOT;
}

// Port 9233 is project-specific — distinct from SeeWhatISee's 9222
// so both can run at the same time without tests hitting the wrong
// browser. Override via PLAYWRIGHT_CDP if needed.
export const CDP_ENDPOINT = process.env.PLAYWRIGHT_CDP || 'http://127.0.0.1:9233';
export const TEMP_BROWSER = process.env.TEMP_BROWSER === '1';

// Forward in-page console output to the test runner. Userscripts log
// with `[name]` prefixes for debugging; surfacing these in test output
// makes failures much easier to diagnose.
function forwardConsole(page) {
  page.on('console', msg => {
    const text = msg.text();
    // Skip the site's own noisy info logs unless they hint at an
    // error; keep anything from a userscript-style `[name]` tag.
    if (/^\[[^\]]+\]/.test(text) || msg.type() === 'error') {
      console.log(`  page-${msg.type()}: ${text}`);
    }
  });
  page.on('pageerror', err => {
    console.log(`  page-error: ${err.message}`);
  });
}

// The user-launched browser, for the default mode.
const sharedBrowser = {
  // Connect to the user-launched Chromium over CDP. The browser must
  // already be running (scripts/open-browser.sh). We never close it
  // — that would discard the manual login.
  browser: [async ({}, use) => {
    let browser;
    try {
      browser = await chromium.connectOverCDP(CDP_ENDPOINT);
    } catch (err) {
      throw new Error(
        `Could not connect to Chromium at ${CDP_ENDPOINT}.\n` +
        `Run \`scripts/open-browser.sh\` in another terminal first, or set TEMP_BROWSER=1\n` +
        `for a throwaway browser with no logins (\`pnpm test:temp\`).\n` +
        `Original error: ${err.message}`
      );
    }
    await use(browser);
    // For a CDP-attached browser, browser.close() only severs the
    // CDP connection — the underlying Chromium process keeps
    // running. So this *is* the disconnect call; the user's
    // manually-launched session and login state are preserved.
    await browser.close();
  }, { scope: 'worker' }],

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
};

export const test = harnessTest.extend({
  ...(TEMP_BROWSER ? {} : sharedBrowser),

  // A fresh page for each test, closed after, which keeps injected
  // scripts page-scoped. In the shared browser, only the test's own
  // page is closed: the harness's page would also close tabs the user
  // opened by hand during the run.
  page: TEMP_BROWSER
    ? async ({ page }, use) => {
      forwardConsole(page);
      await use(page);
    }
    : async ({ context }, use) => {
      const page = await context.newPage();
      forwardConsole(page);
      await use(page);
      await page.close();
    },

  // The harness's `loadUserscript`, with the script's collection root
  // (plus this repo as a fallback localRoot) so a `@require` for `lib/x.js`
  // reads the local `lib/x.js`, exactly as SourceMonkey does when the
  // collection is installed as a directory. Also prints what the script
  // reports — started, skipped with the rule that missed, threw — the
  // way the console forwarding above prints its logs.
  loadUserscript: async ({ loadUserscript, host }, use) => {
    host.on('start', (r) => console.log(`  script-start: ${r.name} on ${r.url}`));
    host.on('skip', (r) => console.log(`  script-skipped: ${r.name} on ${r.url}: ${r.reason}`));
    host.on('script-error', (r) => console.log(`  script-error: ${r.name}: ${r.message}`));
    await use((file, options = {}) => {
      const collectionRoot = findCollectionRoot(file);
      const localRoots = collectionRoot !== REPO_ROOT ? [REPO_ROOT] : [];
      return loadUserscript(file, { collectionRoot, localRoots, ...options });
    });
  },
});

export { expect } from '@playwright/test';
