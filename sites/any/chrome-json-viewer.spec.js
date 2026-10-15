// Tests for chrome-json-viewer.user.js.
//
// No site or login needed: each test serves a file at a made-up URL with
// page.route, with the content type that decides whether Chrome shows it
// in its JSON viewer.
//
//     pnpm test sites/any/chrome-json-viewer.spec.js

import path from 'node:path';
import { tempBrowserTest as test, expect } from '../../test/fixtures.js';

const SCRIPT_PATH = path.join(import.meta.dirname, 'chrome-json-viewer.user.js');
const ORIGIN = 'https://chrome-json-viewer.test';

// Serve `body` at ORIGIN/`name` as `contentType`, open it with the
// script loaded, and wait for the script to start.
async function open(page, loadUserscript, reports, name, body, contentType = 'application/json') {
  await page.route(`${ORIGIN}/${name}`, (route) => route.fulfill({ contentType, body }));
  await loadUserscript(SCRIPT_PATH);
  await page.goto(`${ORIGIN}/${name}`);
  await reports.waitForStart();
}

const preText = (page) => page.locator('body > pre').evaluate((pre) => pre.textContent);
const tokens = (page, className) =>
  page.locator(`body > pre .${className}`).evaluateAll((els) => els.map((e) => e.textContent));

test.afterEach(async ({ reports }) => {
  expect(reports.errors()).toEqual([]);
});

test('pretty-prints JSON and replaces Chrome\'s toolbar', async ({ page, loadUserscript, reports }) => {
  await open(page, loadUserscript, reports, 'data.json', '{"a": 1, "b": [true, null]}');
  expect(await preText(page)).toBe('{\n  "a": 1,\n  "b": [\n    true,\n    null\n  ]\n}');
  await expect(page.locator('.json-viewer-bar input')).toBeChecked();
  await expect(page.locator('.json-viewer-bar input')).toBeEnabled();
  await expect(page.locator('.json-formatter-container')).toBeHidden();
});

test('the checkbox switches between formatted and original', async ({ page, loadUserscript, reports }) => {
  const original = '{"a": {"b": 2}}';
  await open(page, loadUserscript, reports, 'data.json', original);
  const box = page.locator('.json-viewer-bar input');
  await box.uncheck();
  expect(await preText(page)).toBe(original);
  await box.check();
  expect(await preText(page)).toBe('{\n  "a": {\n    "b": 2\n  }\n}');
});

test('keeps numbers and strings as written', async ({ page, loadUserscript, reports }) => {
  await open(page, loadUserscript, reports, 'data.json',
    '{"id": 12345678901234567890, "f": 1.0, "e": 1e3, "neg": -0.50, "s": "<a> & b"}');
  expect(await preText(page)).toBe(
    '{\n  "id": 12345678901234567890,\n  "f": 1.0,\n  "e": 1e3,\n  "neg": -0.50,\n  "s": "<a> & b"\n}');
});

test('highlights keys, strings, numbers and literals', async ({ page, loadUserscript, reports }) => {
  await open(page, loadUserscript, reports, 'data.json',
    '{"name": "x \\"q\\" y", "n": -1.5e3, "list": [1, "a:b", false, null]}');
  expect(await tokens(page, 'jv-key')).toEqual(['"name"', '"n"', '"list"']);
  expect(await tokens(page, 'jv-string')).toEqual(['"x \\"q\\" y"', '"a:b"']);
  expect(await tokens(page, 'jv-number')).toEqual(['-1.5e3', '1']);
  expect(await tokens(page, 'jv-literal')).toEqual(['false', 'null']);
});

test('greys out the checkbox for already formatted JSON', async ({ page, loadUserscript, reports }) => {
  const original = '{\n  "a": 1\n}\n';
  await open(page, loadUserscript, reports, 'data.json', original);
  await expect(page.locator('.json-viewer-bar input')).toBeDisabled();
  await expect(page.locator('.json-viewer-bar .note')).toHaveText('Already formatted');
  expect(await preText(page)).toBe(original);
  expect(await tokens(page, 'jv-key')).toEqual(['"a"']);
});

test('leaves invalid JSON as is, highlighted, with a note', async ({ page, loadUserscript, reports }) => {
  const original = '{\n  // a comment\n  "a": 1,\n}';
  await open(page, loadUserscript, reports, 'data.json', original);
  await expect(page.locator('.json-viewer-bar input')).toBeDisabled();
  await expect(page.locator('.json-viewer-bar .note')).toHaveText('Parsing failed');
  expect(await preText(page)).toBe(original);
  expect(await tokens(page, 'jv-comment')).toEqual(['// a comment']);
});

test('formats .json files served as plain text', async ({ page, loadUserscript, reports }) => {
  await open(page, loadUserscript, reports, 'config.json', '{"a":1}', 'text/plain');
  expect(await preText(page)).toBe('{\n  "a": 1\n}');
  await expect(page.locator('.json-viewer-bar')).toBeVisible();
});

test('leaves an HTML page at a .json URL alone', async ({ page, loadUserscript, reports }) => {
  await open(page, loadUserscript, reports, 'page.json', '<pre>{"a":1}</pre>', 'text/html');
  expect(await preText(page)).toBe('{"a":1}');
  await expect(page.locator('.json-viewer-bar')).toHaveCount(0);
});

// URL matching, through the manager's real header rules:
// loadUserscript's `url` option checks the URL against the script's
// @include and throws if the script wouldn't run.
test.describe('URL matching', () => {
  const MATCHES = [
    'https://example.com/data.json',
    'http://example.com/a/b/data.json',
    'https://example.com/DATA.JSON', // any case
    'https://example.com/data.json?raw=1',
    'https://example.com/data.json#key',
    'https://raw.githubusercontent.com/user/repo/refs/heads/main/tsconfig.json',
    'file:///home/user/project/package.json',
  ];
  const MISSES = [
    'https://example.com/',
    'https://example.com/api/items', // JSON API without a .json path
    'https://example.com/notes.txt',
    'https://example.com/data.jsonl',
    'https://example.com/data.json/', // a directory
    'https://example.com/search?q=data.json', // .json only in the query
    'https://example.com/page#data.json', // or only in the fragment
  ];

  for (const url of MATCHES) {
    test(`runs on ${url}`, async ({ loadUserscript }) => {
      await loadUserscript(SCRIPT_PATH, { url });
    });
  }
  for (const url of MISSES) {
    test(`skips ${url}`, async ({ loadUserscript }) => {
      await expect(loadUserscript(SCRIPT_PATH, { url })).rejects.toThrow(/No @match or @include covers this URL/);
    });
  }
});
