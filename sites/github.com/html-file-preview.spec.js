// Tests for html-file-preview.user.js.
//
// Live: these load public pages on github.com, logged out, so they
// depend on GitHub (and can fail when it rate-limits the hidden
// browser). The main page is the demo checked in beside this script,
// examples/html-file-preview/index.html.
//
//     pnpm test sites/github.com/html-file-preview.spec.js

import path from 'node:path';
import { tempBrowserTest as test, expect } from '../../test/fixtures.js';

const SCRIPT_PATH = path.join(import.meta.dirname, 'html-file-preview.user.js');
const DIR = 'https://github.com/jshute96/userscripts/blob/main/sites/github.com/examples/html-file-preview';
const DEMO = `${DIR}/index.html`;
// A file that is all script: an empty body and one <script>.
const BLANK = 'https://github.com/jshute96/SeeWhatISee/blob/main/src/offscreen.html';

const SECTION = 'section[class*="blobContentSection"]';
const TAB = '#gh-html-preview-tab';
const FRAME = '#gh-html-preview-pane iframe';

async function open(page, loadUserscript, reports, url) {
  await loadUserscript(SCRIPT_PATH);
  await page.goto(url);
  await reports.waitForStart();
}

// The preview's document, once its content is in.
async function preview(page) {
  await expect(page.locator(`${FRAME}[srcdoc]`)).toHaveCount(1, { timeout: 15000 });
  return page.frameLocator(FRAME);
}

test.describe('HTML file preview', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1000 });
  });

  test('opens on Preview, sandboxed, with the code hidden', async ({ page, loadUserscript, reports }) => {
    await open(page, loadUserscript, reports, DEMO);
    const frame = await preview(page);
    await expect(page.locator(TAB)).toHaveAttribute('data-selected', '');
    await expect(page.locator(SECTION)).toBeHidden();
    await expect(page.locator(FRAME)).toHaveAttribute('sandbox',
      'allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation');
    await expect(frame.locator('h1')).toHaveText('HTML preview demo');
    expect(reports.errors()).toEqual([]);
  });

  test('loads same-repo styles and images, and blocks the rest', async ({ page, loadUserscript, reports }) => {
    await open(page, loadUserscript, reports, DEMO);
    const frame = await preview(page);
    // css/demo.css, inlined.
    await expect(frame.locator('.banner')).toHaveCSS('background-image', /linear-gradient/);
    // url(stripes.svg) in it, rebased onto the stylesheet's directory.
    await expect(frame.locator('.striped')).toHaveCSS('background-image', /\/css\/stripes\.svg/);
    // logo.svg, beside the file (a public repo, so it loads without cookies).
    await expect.poll(() => frame.locator('img.logo').evaluate((img) => img.naturalWidth), { timeout: 10000 })
      .toBeGreaterThan(0);
    // Another site's image, blocked by GitHub's CSP.
    const outside = frame.locator('img[src*="wikimedia"]');
    await expect.poll(() => outside.evaluate((img) => img.complete), { timeout: 10000 }).toBe(true);
    expect(await outside.evaluate((img) => img.naturalWidth)).toBe(0);
  });

  test('runs no scripts', async ({ page, loadUserscript, reports }) => {
    await open(page, loadUserscript, reports, DEMO);
    const frame = await preview(page);
    await expect(frame.locator('#script-status')).toHaveText(/^Scripts didn't run/);
    await frame.locator('#counter').click();
    await expect(frame.locator('#counter')).toHaveText('Clicked 0 times');
    expect(await page.locator(FRAME).getAttribute('srcdoc')).not.toMatch(/<script/i);
  });

  test('rewrites links', async ({ page, loadUserscript, reports }) => {
    await open(page, loadUserscript, reports, DEMO);
    const frame = await preview(page);
    const link = (text) => frame.getByRole('link', { name: text, exact: true });
    await expect(link('A page beside this one')).toHaveAttribute('href', `${DIR}/other.html`);
    await expect(link('A page beside this one')).toHaveAttribute('target', '_top');
    await expect(link('A file two directories up')).toHaveAttribute('href',
      'https://github.com/jshute96/userscripts/blob/main/sites/github.com/html-file-preview.user.js');
    await expect(link('An outside site')).toHaveAttribute('target', '_top');
    await expect(link('An outside site in a new tab')).toHaveAttribute('target', '_blank');
    await expect(link('An outside site in a new tab')).toHaveAttribute('rel', 'noopener');
    await expect(link('A link within this page')).toHaveAttribute('href', 'about:srcdoc#table');
    // javascript: loses its href, so it's no longer a link.
    await expect(frame.locator('a', { hasText: 'Show an alert' })).not.toHaveAttribute('href', /.*/);
  });

  test('a relative link opens GitHub\'s view of that file, on Preview', async ({ page, loadUserscript, reports }) => {
    await open(page, loadUserscript, reports, DEMO);
    const frame = await preview(page);
    await frame.getByRole('link', { name: 'A page beside this one', exact: true }).click();
    await page.waitForURL(`${DIR}/other.html`);
    const other = await preview(page);
    await expect(other.locator('h2')).toHaveText('Another page');
    await expect(page.locator(TAB)).toHaveAttribute('data-selected', '');
  });

  test('switches between Preview and Code', async ({ page, loadUserscript, reports }) => {
    await open(page, loadUserscript, reports, DEMO);
    await preview(page);
    await page.locator('ul[aria-label="File view"] button', { hasText: 'Code' }).click();
    await expect(page.locator(SECTION)).toBeVisible();
    await expect(page.locator(TAB)).not.toHaveAttribute('data-selected', '');
    await page.locator(`${TAB} button`).click();
    await expect(page.locator(SECTION)).toBeHidden();
    await expect(page.locator(TAB)).toHaveAttribute('data-selected', '');
  });

  test('fills the window, and the page stops scrolling', async ({ page, loadUserscript, reports }) => {
    await open(page, loadUserscript, reports, DEMO);
    await preview(page);
    const frameBox = page.locator(FRAME);
    await expect.poll(() => frameBox.evaluate((f) => f.offsetHeight)).toBeGreaterThan(400);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe('hidden');
    // The frame ends inside the window.
    expect(await frameBox.evaluate((f) => f.getBoundingClientRect().bottom <= innerHeight)).toBe(true);

    // Too short to leave 400px: the frame gets 400px, and the page scrolls.
    await page.setViewportSize({ width: 1280, height: 600 });
    await expect.poll(() => frameBox.evaluate((f) => f.offsetHeight)).toBe(400);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).not.toBe('hidden');
  });

  test('a file with nothing to show opens on Code, and its Preview says why', async ({ page, loadUserscript, reports }) => {
    await open(page, loadUserscript, reports, BLANK);
    await expect(page.locator(TAB)).toHaveCount(1);
    await expect(page.locator(SECTION)).toBeVisible({ timeout: 10000 });
    await expect(page.locator(TAB)).not.toHaveAttribute('data-selected', '');
    await page.locator(`${TAB} button`).click();
    await expect(page.locator('.gh-html-preview-note'))
      .toHaveText('No visible content to preview without running scripts.');
    await expect(page.locator(FRAME)).toHaveCount(0);
  });
});
