#!/usr/bin/env node
// Preflight check for `npm test`. Verifies the test browser is running
// on CDP port 9233, and launches it if not. Without this, a cold-start
// `npm test` runs every spec to failure on connectOverCDP — slow and
// noisy.
//
// Env vars:
//   PLAYWRIGHT_CDP — CDP endpoint to probe (default http://127.0.0.1:9233;
//                    must match what scripts/open-browser.sh uses and
//                    what test/fixtures.js reads).

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CDP = process.env.PLAYWRIGHT_CDP || 'http://127.0.0.1:9233';

async function probeCdp() {
  try {
    const res = await fetch(`${CDP}/json/version`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForCdp(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probeCdp()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  if (await probeCdp()) return;
  console.log(`Test browser isn't running on ${CDP} — launching it now…`);
  const script = path.join(ROOT, 'scripts/open-browser.sh');
  // Detached + ignored stdio so the child survives after preflight exits.
  // The opener exec's Chromium directly, so the unrefed child IS the
  // browser; killing preflight won't take it down.
  const child = spawn('bash', [script], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  if (!(await waitForCdp())) {
    console.error(
      `\nBrowser didn't come up on ${CDP} within 15s.\n` +
      `Try running scripts/open-browser.sh manually to see what went wrong.\n`
    );
    process.exit(1);
  }
  console.log(`Browser is up on ${CDP}. Proceeding.`);
}

main().catch((err) => {
  console.error(`test-preflight: ${err?.message ?? err}`);
  process.exit(1);
});
