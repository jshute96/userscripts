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
// browser through Playwright. Google detects the automation flags and
// blocks sign-in when launchPersistentContext is used. Instead,
// Chromium runs with a debugging port (scripts/open-browser.sh, which
// the first spec that needs it starts if it isn't running), the user
// logs in to test sites once, and it keeps running. Tests connect over
// CDP and reuse the existing authenticated context.
//
// A spec that needs no login (it serves saved pages, or its site
// works logged out and doesn't block a hidden browser) imports
// `tempBrowserTest` instead. That uses the harness's own browser: a
// hidden Chromium with SourceMonkey loaded, launched per Playwright
// worker and closed after the run. `--headed` shows it. TEMP_BROWSER=1
// (`pnpm test:temp`) runs every spec that way.
//
// Tests import from this file rather than `sourcemonkey/harness`
// directly:
//
//     import { test, expect } from '../../test/fixtures.js';
//     import { tempBrowserTest as test, expect } from '../../test/fixtures.js';
//
// Workflow:
//
//     # once: open the browser and log in to the test sites
//     scripts/open-browser.sh https://feedly.com
//     # then, with it running (or it's started for you)
//     pnpm test
//
//     # or all specs in throwaway browsers, with no browser to start first
//     pnpm test:temp

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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

// Whether something answers CDP at the endpoint.
async function cdpUp() {
  try {
    const res = await fetch(`${CDP_ENDPOINT}/json/version`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

// Starts the test browser (scripts/open-browser.sh) when it isn't
// running, so the first spec that needs it doesn't fail on the connect.
// Done here rather than before the run, so a run of temp-browser specs
// opens no window. Only for the default endpoint: PLAYWRIGHT_CDP names
// a browser of the user's own. Detached, so the browser outlives the
// worker and the run, and the next run reuses it.
async function ensureSharedBrowser() {
  if (process.env.PLAYWRIGHT_CDP || await cdpUp()) return;
  console.log(`Test browser isn't running on ${CDP_ENDPOINT}. Launching it now.`);
  // Its output goes to a file rather than a pipe, which would tie the
  // browser to this worker. Read back if it doesn't come up.
  const logFile = path.join(os.tmpdir(), 'userscripts-test-browser.log');
  const out = fs.openSync(logFile, 'w');
  const child = spawn('bash', [path.join(REPO_ROOT, 'scripts/open-browser.sh')], {
    detached: true,
    stdio: ['ignore', out, out],
  });
  fs.closeSync(out);
  child.unref();
  // open-browser.sh execs Chromium, so an exit means it failed to start.
  let exited = false;
  child.on('exit', () => { exited = true; });
  const deadline = Date.now() + 15000;
  while (!exited && Date.now() < deadline) {
    if (await cdpUp()) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  const output = fs.readFileSync(logFile, 'utf8').trim().split('\n').slice(-10).join('\n');
  throw new Error(
    (exited ? 'scripts/open-browser.sh failed to start the test browser.'
      : `The test browser didn't answer on ${CDP_ENDPOINT} within 15 seconds.`) +
    ` Its output (${logFile}):\n${output}`
  );
}

// The user-launched browser, for the default mode.
const sharedBrowser = {
  // Connect to the user-launched Chromium over CDP, starting it first
  // if it isn't running. We never close it — that would discard the
  // manual login.
  browser: [async ({}, use) => {
    await ensureSharedBrowser();
    let browser;
    try {
      browser = await chromium.connectOverCDP(CDP_ENDPOINT);
    } catch (err) {
      throw new Error(
        `Could not connect to Chromium at ${CDP_ENDPOINT}.\n` +
        (process.env.PLAYWRIGHT_CDP ? 'Start the browser PLAYWRIGHT_CDP names first, or set' : 'Or set') +
        ` TEMP_BROWSER=1 for a throwaway browser with no logins (\`pnpm test:temp\`).\n` +
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

// The harness's `loadUserscript`, with the script's collection root
// (plus this repo as a fallback localRoot) so a `@require` for `lib/x.js`
// reads the local `lib/x.js`, exactly as SourceMonkey does when the
// collection is installed as a directory. Also prints what the script
// reports — started, skipped with the rule that missed, threw — the
// way the console forwarding above prints its logs.
async function loadUserscriptFixture({ loadUserscript, host }, use) {
  host.on('start', (r) => console.log(`  script-start: ${r.name} on ${r.url}`));
  host.on('skip', (r) => console.log(`  script-skipped: ${r.name} on ${r.url}: ${r.reason}`));
  host.on('script-error', (r) => console.log(`  script-error: ${r.name}: ${r.message}`));
  await use((file, options = {}) => {
    const collectionRoot = findCollectionRoot(file);
    const localRoots = collectionRoot !== REPO_ROOT ? [REPO_ROOT] : [];
    return loadUserscript(file, { collectionRoot, localRoots, ...options });
  });
}

// The harness opens a fresh page for each test and closes it after,
// with any tabs opened during the test (a script's GM_openInTab, say),
// which keeps injected scripts page-scoped. In the shared browser that
// includes a tab the user opens by hand while a test runs.
const page = async ({ page }, use) => {
  forwardConsole(page);
  await use(page);
};

// In the harness's own browser.
export const tempBrowserTest = harnessTest.extend({
  page,
  loadUserscript: loadUserscriptFixture,
});

// In the user-launched browser. Playwright runs the two kinds of spec
// in separate workers, since their worker fixtures differ.
const sharedBrowserTest = harnessTest.extend({
  ...sharedBrowser,
  page,
  loadUserscript: loadUserscriptFixture,
});

export const test = TEMP_BROWSER ? tempBrowserTest : sharedBrowserTest;

export { expect } from '@playwright/test';
