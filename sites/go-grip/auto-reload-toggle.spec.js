// Tests for auto-reload-toggle.user.js.
//
// Runs a real go-grip server on a scratch directory (a markdown page
// showing an SVG image, plus an unrelated file), edits those files, and
// checks what the page does with each reload signal, with auto-reload
// on and off. Skipped when go-grip isn't installed.
//
//     scripts/open-browser.sh     # one terminal, leave running
//     pnpm test sites/go-grip/auto-reload-toggle.spec.js

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '../../test/fixtures.js';

const SCRIPT_PATH = path.join(import.meta.dirname, 'auto-reload-toggle.user.js');
const STORAGE_KEY = 'go-grip-auto-reload';
const BUTTON = '#go-grip-reload-toggle';
// The ports the script's @match covers.
const PORTS = [6419, 6420, 6421, 6422];

const hasGoGrip = !spawnSync('go-grip', ['--help']).error;

const MARKDOWN = '# Test page\n\nVersion 1\n\n![image](image.svg)\n';
const svg = (color) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="${color}"/></svg>\n`;

let dir;
let server;
let origin;

function portFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, () => probe.close(() => resolve(true)));
  });
}

const file = (name) => path.join(dir, name);
const write = (name, content) => fs.writeFileSync(file(name), content);

// The image check compares Last-Modified with the page's load time, in
// whole seconds. After a reload, an image edited in that same second
// still looks new to the reloaded page. Moving its mtime back (a
// metadata-only change, which go-grip doesn't signal) stands in for
// time passing.
function backdate(name) {
  const past = new Date(Date.now() - 10_000);
  fs.utimesSync(file(name), past, past);
}

test.describe('go-grip auto-reload toggle', () => {
  test.skip(!hasGoGrip, 'go-grip is not installed');

  test.beforeAll(async () => {
    let port;
    for (const p of PORTS) {
      if (await portFree(p)) {
        port = p;
        break;
      }
    }
    test.skip(!port, `no free port among ${PORTS.join(', ')}`);
    origin = `http://localhost:${port}`;

    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'go-grip-test-'));
    write('test.md', MARKDOWN);
    write('image.svg', svg('red'));
    write('other.txt', 'one\n');
    for (const name of ['test.md', 'image.svg', 'other.txt']) backdate(name);

    server = spawn('go-grip', ['-b=false', '-p', String(port), 'test.md'], {
      cwd: dir,
      stdio: 'ignore',
    });
    await expect.poll(async () => {
      try {
        return (await fetch(`${origin}/test.md`)).ok;
      } catch (e) {
        return false;
      }
    }, { timeout: 10_000 }).toBe(true);
  });

  test.afterAll(() => {
    server?.kill();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  test.beforeEach(() => {
    write('test.md', MARKDOWN);
    write('image.svg', svg('red'));
    for (const name of ['test.md', 'image.svg']) backdate(name);
  });

  // Opens the page with auto-reload on or off, and returns helpers that
  // watch the script's log lines.
  async function openPage(page, loadUserscript, { enabled }) {
    const logs = [];
    page.on('console', (msg) => logs.push(msg.text()));

    // Wait for a line matching re, printed at or after index from.
    // Returns the index just past it.
    async function waitLog(re, from) {
      let found = -1;
      await expect.poll(() => {
        found = logs.slice(from).findIndex((line) => re.test(line));
        return found;
      }, { message: `log matching ${re}` }).toBeGreaterThanOrEqual(0);
      return from + found + 1;
    }

    // Make a file change, and report what the page did with go-grip's
    // signal: 'reloaded', 'unchanged' or 'blocked'. Without a reload,
    // also waits out the reconnect that follows (the server closes the
    // socket after each signal), which the script checks the same way.
    async function change(edit) {
      const from = logs.length;
      edit();
      const outcome = /\[go-grip reload\] (page unchanged|page changed|blocked reload).*\(file changed\)/;
      const at = await waitLog(outcome, from);
      const line = logs[at - 1];
      if (line.includes('page changed')) {
        await waitLog(/\[go-grip reload\] button added/, at);
        return 'reloaded';
      }
      const reconnect = await waitLog(/\(server reconnected\)/, at);
      // Nothing changed between the signal and the reconnect, so the
      // reconnect's check must agree.
      expect(logs[reconnect - 1]).toContain(line.includes('unchanged') ? 'page unchanged' : 'blocked reload');
      return line.includes('unchanged') ? 'unchanged' : 'blocked';
    }

    await loadUserscript(SCRIPT_PATH);
    await page.goto(`${origin}/test.md`);
    await page.evaluate(([key, value]) => localStorage.setItem(key, value),
      [STORAGE_KEY, enabled ? 'on' : 'off']);
    const from = logs.length;
    await page.reload();
    await waitLog(/\[go-grip reload\] button added/, from);
    return { logs, waitLog, change };
  }

  const button = (page) => page.locator(BUTTON);
  const bodyText = (page) => page.locator('.container-inner');

  test.afterEach(async ({ page }) => {
    // Leave no setting behind on a port the user may use themselves.
    await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY).catch(() => {});
  });

  test('on: skips no-op signals, reloads for real edits', async ({ page, loadUserscript, reports }) => {
    const { change } = await openPage(page, loadUserscript, { enabled: true });
    await expect(button(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(button(page)).toHaveAttribute('title', 'Auto-reload: On');

    // Unrelated file, and the page's own file rewritten unchanged.
    expect(await change(() => write('other.txt', 'two\n'))).toBe('unchanged');
    expect(await change(() => write('test.md', MARKDOWN))).toBe('unchanged');

    // Real edits to the markdown and to the image.
    expect(await change(() => write('test.md', MARKDOWN.replace('Version 1', 'Version 2')))).toBe('reloaded');
    await expect(bodyText(page)).toContainText('Version 2');
    expect(await change(() => write('image.svg', svg('blue')))).toBe('reloaded');
    backdate('image.svg');

    // Still on after the reloads, and quiet again for unrelated edits.
    await expect(button(page)).toHaveAttribute('aria-pressed', 'true');
    expect(await change(() => write('other.txt', 'three\n'))).toBe('unchanged');
    expect(reports.errors()).toEqual([]);
  });

  test('off: shows the dot for real edits only, clicks reload once', async ({ page, loadUserscript, reports }) => {
    const { logs, waitLog, change } = await openPage(page, loadUserscript, { enabled: false });
    await expect(button(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(button(page)).toHaveAttribute('title', 'Auto-reload: Off');

    // No-op signals: no dot.
    expect(await change(() => write('other.txt', 'four\n'))).toBe('unchanged');
    expect(await change(() => write('test.md', MARKDOWN))).toBe('unchanged');
    await expect(button(page)).not.toHaveClass(/pending/);

    // A real markdown edit: the dot, and the page keeps the old text.
    expect(await change(() => write('test.md', MARKDOWN.replace('Version 1', 'Version 2')))).toBe('blocked');
    await expect(button(page)).toHaveClass(/pending/);
    await expect(button(page)).toHaveAttribute('title', 'Reload updated page\nAuto-reload: Off');
    await expect(bodyText(page)).toContainText('Version 1');

    // Changed back: nothing to show, so the dot goes.
    expect(await change(() => write('test.md', MARKDOWN))).toBe('unchanged');
    await expect(button(page)).not.toHaveClass(/pending/);

    // A real image edit: the dot again.
    expect(await change(() => write('image.svg', svg('blue')))).toBe('blocked');
    await expect(button(page)).toHaveClass(/pending/);

    // Clicking with the dot reloads once, and auto-reload stays off.
    let from = logs.length;
    await button(page).click();
    await waitLog(/\[go-grip reload\] init, auto-reload off/, from);
    await waitLog(/\[go-grip reload\] button added/, from);
    backdate('image.svg');
    await expect(button(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(button(page)).not.toHaveClass(/pending/);

    // The next click turns auto-reload on, without a reload.
    from = logs.length;
    await button(page).click();
    await expect(button(page)).toHaveAttribute('aria-pressed', 'true');
    expect(logs.slice(from).some((line) => line.includes('init,'))).toBe(false);
    expect(await change(() => write('test.md', MARKDOWN.replace('Version 1', 'Version 3')))).toBe('reloaded');
    await expect(bodyText(page)).toContainText('Version 3');
    expect(reports.errors()).toEqual([]);
  });

  test('toggling off and on is remembered across reloads', async ({ page, loadUserscript }) => {
    const { logs, waitLog } = await openPage(page, loadUserscript, { enabled: true });
    await button(page).click();
    await expect(button(page)).toHaveAttribute('aria-pressed', 'false');
    let from = logs.length;
    await page.reload();
    await waitLog(/\[go-grip reload\] init, auto-reload off/, from);
    await expect(button(page)).toHaveAttribute('aria-pressed', 'false');

    await button(page).click();
    from = logs.length;
    await page.reload();
    await waitLog(/\[go-grip reload\] init, auto-reload on/, from);
    await expect(button(page)).toHaveAttribute('aria-pressed', 'true');
  });
});
