// Tests for spelling-bee.user.js — the definition-popup half.
//
// Needs the shared browser running (scripts/open-browser.sh); a
// nytimes.com login isn't required, since the tests plant their own
// found-word element rather than relying on today's puzzle.
//
// `GM_xmlhttpRequest` runs for real, so these tests hit the LIVE
// definition services: a failure can mean a source is down, not just
// that the script broke. Read the forwarded `[spelling-bee]` logs to
// tell which.

import path from 'node:path';
import { test, expect } from '../../test/fixtures.js';

const SCRIPT_PATH = path.join(import.meta.dirname, 'spelling-bee.user.js');
const PAGE_URL = 'https://www.nytimes.com/puzzles/spelling-bee';
const PRIMARY_HOST = 'freedictionaryapi.com';
const FALLBACK_HOST = 'api.datamuse.com';

// Plant a word the script will wire up (it watches for `li > .sb-anagram`),
// pinned to a corner so it's hoverable regardless of what the page shows.
async function plantWord(page, word) {
  await page.evaluate((word) => {
    let ul = document.getElementById('sb-test-words');
    if (!ul) {
      ul = document.createElement('ul');
      ul.id = 'sb-test-words';
      ul.style.cssText = 'position:fixed;top:8px;left:8px;z-index:2147483647;background:#fff;list-style:none;margin:0;padding:4px;';
      document.body.appendChild(ul);
    }
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.className = 'sb-anagram';
    span.textContent = word;
    li.appendChild(span);
    ul.appendChild(li);
  }, word);
  const span = page.locator('#sb-test-words .sb-anagram', { hasText: word });
  await expect(span).toHaveAttribute('data-sb-lookup-added', /.*/);
  return span;
}

// Hover the word and wait for the popup's iframe to render its answer.
async function lookUp(page, word) {
  const span = await plantWord(page, word);
  await span.hover();
  const popup = page.frameLocator('.sb-lookup-popup iframe');
  await expect(popup.locator('body')).toBeVisible();
  return popup;
}

// The hosts the script asked for, in order, as the harness recorded
// them: `GM_xmlhttpRequest` really runs here, so these are the
// requests the extension would have made.
function requestHosts(gm) {
  return gm.requests().map((r) => new URL(r.url).hostname);
}

test.describe('definition popup', () => {
  test('shows a definition from the primary source', async ({ page, loadUserscript, gm }) => {
    await loadUserscript(SCRIPT_PATH);
    await page.goto(PAGE_URL);

    const popup = await lookUp(page, 'tile');
    await expect(popup.locator('h2.word')).toHaveText('tile');
    // IPA pronunciation only comes from the primary source.
    await expect(popup.locator('.phonetic')).toContainText('taɪl');
    await expect(popup.locator('h3.pos').first()).toHaveText('noun');
    await expect(popup.locator('.def').first()).toContainText(/slab of clay/);
    await expect(popup.locator('p.credit')).toContainText('Wiktionary');
    await expect(popup.locator('p.credit')).toContainText('Free Dictionary API');

    expect(requestHosts(gm)).toEqual([PRIMARY_HOST]);
  });

  test('falls back to Datamuse, then stops trying the failing source first',
    async ({ page, loadUserscript, gm }) => {
    gm.failHosts(PRIMARY_HOST);
    await loadUserscript(SCRIPT_PATH);
    await page.goto(PAGE_URL);

    const popup = await lookUp(page, 'tile');
    await expect(popup.locator('h2.word')).toHaveText('tile');
    await expect(popup.locator('.phonetic')).toHaveCount(0);
    await expect(popup.locator('h3.pos').first()).toHaveText('noun');
    await expect(popup.locator('.def').first()).toContainText(/slab of clay/);
    await expect(popup.locator('p.credit')).toContainText('Datamuse');

    // Three attempts at the primary (initial + 2 cache-busting retries),
    // then the fallback.
    expect(requestHosts(gm)).toEqual(
      [PRIMARY_HOST, PRIMARY_HOST, PRIMARY_HOST, FALLBACK_HOST]);

    // The next word goes to Datamuse straight away.
    const popup2 = await lookUp(page, 'loll');
    await expect(popup2.locator('h2.word')).toHaveText('loll');
    await expect(popup2.locator('h3.pos').first()).toHaveText('verb');
    const hosts = requestHosts(gm);
    expect(hosts.slice(4)).toEqual([FALLBACK_HOST]);
  });

  test('?sbDictSource pins lookups to one source', async ({ page, loadUserscript, gm }) => {
    await loadUserscript(SCRIPT_PATH);
    await page.goto(PAGE_URL + '?sbDictSource=datamuse');

    const popup = await lookUp(page, 'tile');
    await expect(popup.locator('.def').first()).toContainText(/slab of clay/);
    expect(requestHosts(gm)).toEqual([FALLBACK_HOST]);
  });

  test('reports an unknown word after asking every source', async ({ page, loadUserscript, gm }) => {
    await loadUserscript(SCRIPT_PATH);
    await page.goto(PAGE_URL);

    const popup = await lookUp(page, 'xyzzyq');
    await expect(popup.locator('p.msg')).toContainText('No definition found');
    expect(requestHosts(gm)).toEqual([PRIMARY_HOST, FALLBACK_HOST]);

    // Datamuse knows this word but has no `defs` for it.
    const popup2 = await lookUp(page, 'lalala');
    await expect(popup2.locator('p.msg')).toContainText('No definition found');
  });
});
