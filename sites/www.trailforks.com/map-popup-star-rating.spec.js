// Tests for map-popup-star-rating.user.js.
//
//     scripts/open-browser.sh https://www.trailforks.com
//     pnpm test
//
// No login is needed — trail ratings are public. Trails are clicked by
// calling the map's own tfmap_feature_click() on a rendered feature rather
// than clicking pixels: the trail lines are a few pixels wide and where they
// land depends on the viewport, which would make the test flaky for reasons
// that have nothing to do with the script.
//
// Nothing asserts a particular trail's rating — those change as people vote.
// The assertions are about shape: a row appears, it reads as a rating, its
// stars agree with its number, and it appears exactly once.

const path = require('path');
const { test, expect } = require('../../test/fixtures');

const SCRIPT_PATH = path.join(__dirname, 'map-popup-star-rating.user.js');
// A region map, which is where Trailforks still uses the older popup this
// script fills in. Override for ad-hoc runs.
const REGION_MAP = process.env.TRAILFORKS_REGION_MAP ||
  'https://www.trailforks.com/region/grouse-ridge-23804/map/';
// The general map, which uses the newer detail panel that already shows a
// rating and which the script must leave alone.
const GENERAL_MAP = 'https://www.trailforks.com/map/?lat=39.4359&lon=-120.6368&z=13';

const ROW = '.jshute-tf-rating-row';
const POPUP = '#mapWindowContent .marker_info';
// Every verdict the script can reach for one trail.
const DECIDED = /rating added|rating request failed|rating request errored|no rating widget/;

// Collect the script's own log lines, and let a test wait for one.
function watchLogs(page) {
  const lines = [];
  page.on('console', (m) => {
    const text = m.text();
    if (text.includes('[tf-rating]')) lines.push(text.replace(/^.*\[tf-rating\] /, ''));
  });
  return {
    lines,
    async waitFor(re, timeout = 30000) {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const hit = lines.find((l) => re.test(l));
        if (hit) return hit;
        await page.waitForTimeout(100);
      }
      throw new Error(`No log line matching ${re} — saw: ${JSON.stringify(lines)}`);
    },
  };
}

// Wait until the map has drawn trails we can click.
async function trailIds(page, limit = 6) {
  await page.waitForFunction(() => window.map && typeof window.tfmap_feature_click === 'function',
                             null, { timeout: 30000 });
  const ids = await page.waitForFunction((n) => {
    const feats = window.map.queryRenderedFeatures({ layers: ['trails'] })
      .filter((f) => f.properties && f.properties.type === 'trail' && f.properties.name);
    const seen = [...new Set(feats.map((f) => f.properties.id))].slice(0, n);
    return seen.length ? seen : false;
  }, limit, { timeout: 30000 });
  return ids.jsonValue();
}

// Open one trail's popup and wait for the script to reach a verdict on it.
async function openTrail(page, logs, id) {
  const before = logs.lines.length;
  await page.evaluate((trailId) => {
    const f = window.map.queryRenderedFeatures({ layers: ['trails'] })
      .find((x) => x.properties && String(x.properties.id) === String(trailId));
    window.tfmap_feature_click(f);
  }, id);
  await page.waitForSelector(POPUP, { timeout: 20000 });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const hit = logs.lines.slice(before).find((l) => DECIDED.test(l));
    if (hit) return hit;
    await page.waitForTimeout(100);
  }
  throw new Error(`No verdict for trail ${id} — saw: ${JSON.stringify(logs.lines.slice(before))}`);
}

// The rating row as the reader sees it, plus how far the gold stars are filled.
const readRow = () => {
  const rows = document.querySelectorAll('.jshute-tf-rating-row');
  if (!rows.length) return { count: 0 };
  const row = rows[0];
  const list = row.closest('ul.infolist');
  const fill = row.querySelector('.jshute-tf-stars > span');
  return {
    count: rows.length,
    text: row.innerText.replace(/\s+/g, ' ').trim(),
    // The script puts the rating above the rows the site itself renders.
    isFirst: list.firstElementChild === row,
    fillPercent: fill ? parseFloat(fill.style.width) : null,
  };
};

test.describe('Trailforks: star rating in map trail popups', () => {
  test('adds a readable rating row to the popup', async ({ page, loadUserscript }) => {
    const logs = watchLogs(page);
    await loadUserscript(SCRIPT_PATH);
    await page.goto(REGION_MAP);
    await logs.waitFor(/init/);

    const ids = await trailIds(page);
    let rated = null;
    for (const id of ids) {
      await openTrail(page, logs, id);
      const row = await page.evaluate(readRow);
      expect(row.count).toBe(1);
      expect(row.isFirst).toBe(true);
      // Either a rating, or an honest statement that there isn't one.
      expect(row.text).toMatch(/^Rating: (\d\.\d\d \(\d+ votes?\)|not rated)$/);
      if (/\d\.\d\d/.test(row.text)) { rated = row; break; }
    }

    test.skip(!rated, `none of these trails has been rated: ${ids.join(', ')}`);

    // The stars agree with the number beside them.
    const avg = Number(/(\d\.\d\d)/.exec(rated.text)[1]);
    expect(avg).toBeGreaterThan(0);
    expect(avg).toBeLessThanOrEqual(5);
    expect(rated.fillPercent).toBeCloseTo(avg / 5 * 100, 1);
    // A vote count of zero would have rendered as "not rated".
    expect(Number(/\((\d+) votes?\)/.exec(rated.text)[1])).toBeGreaterThan(0);
  });

  test('adds the row once per popup, including on a cached trail', async ({ page, loadUserscript }) => {
    const logs = watchLogs(page);
    await loadUserscript(SCRIPT_PATH);
    await page.goto(REGION_MAP);
    await logs.waitFor(/init/);

    const [first, second] = await trailIds(page, 2);
    await openTrail(page, logs, first);
    await openTrail(page, logs, second);
    // Back to the first, which is now answered from the cache — a different
    // code path into the same insertion.
    await openTrail(page, logs, first);
    expect(logs.lines).toContain(`cache hit for trail ${first}`);

    // Give a duplicate insertion time to happen before counting.
    await page.waitForTimeout(1000);
    expect((await page.evaluate(readRow)).count).toBe(1);
  });

  // The row is built from a separate request that can land at any time, so
  // the thing worth pinning down is that the number shown belongs to the trail
  // whose popup it was inserted into. Checked against the trail's own page,
  // which is a source the script doesn't use.
  test('shows the rating of the trail the popup is for', async ({ page, loadUserscript }) => {
    const logs = watchLogs(page);
    await loadUserscript(SCRIPT_PATH);
    await page.goto(REGION_MAP);
    await logs.waitFor(/init/);

    const ids = await trailIds(page);
    let shown = null;
    for (const id of ids) {
      await openTrail(page, logs, id);
      const row = await page.evaluate(readRow);
      if (/\d\.\d\d/.test(row.text)) { shown = row; break; }
    }
    test.skip(!shown, `none of these trails has been rated: ${ids.join(', ')}`);

    const onTrailPage = await page.evaluate(async () => {
      const href = document.querySelector('#mapWindowContent .marker_info a.viewtrail').href;
      const html = await (await fetch(href, { credentials: 'same-origin' })).text();
      const ul = new DOMParser().parseFromString(html, 'text/html')
        .querySelector('.star-rating ul[data-type="trail"]');
      return { href, score: parseFloat(ul.getAttribute('data-score')) };
    });

    expect(Number(/(\d\.\d\d)/.exec(shown.text)[1])).toBeCloseTo(onTrailPage.score / 20, 1);
  });

  test('leaves the newer detail panel alone', async ({ page, loadUserscript }) => {
    const logs = watchLogs(page);
    await loadUserscript(SCRIPT_PATH);
    await page.goto(GENERAL_MAP);
    await logs.waitFor(/init/);

    const [id] = await trailIds(page, 1);
    await page.evaluate((trailId) => {
      const f = window.map.queryRenderedFeatures({ layers: ['trails'] })
        .find((x) => x.properties && String(x.properties.id) === String(trailId));
      window.tfmap_feature_click(f);
    }, id);

    // The site's own panel shows a rating here, so the script must stay out.
    await page.waitForSelector('#tfMapTrailinfoBody .tf-detailpanel__rating', { timeout: 30000 });
    await page.waitForTimeout(2000);
    expect(await page.locator(ROW).count()).toBe(0);
    expect(logs.lines.filter((l) => DECIDED.test(l))).toEqual([]);
  });
});
