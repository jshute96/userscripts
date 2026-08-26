// Tests for rescale-recent-efforts.user.js.
//
// Needs a Strava login in the persistent profile. No segment id is
// hardcoded — the tests take the first starred segment on
// /athlete/segments/starred, since a starred segment is one the athlete
// has ridden and so has efforts to plot. Override for ad-hoc runs with
// STRAVA_SEGMENT_ID.
//
//     scripts/open-browser.sh https://www.strava.com
//     pnpm test
//
// Whether a given segment has outliers worth capping depends on the
// athlete's own efforts and changes as they ride it, so nothing here
// asserts a particular cap, tick set, or count. The assertions are
// relational: wherever the script leaves the chart, it has to be a
// chart that reads correctly.

const path = require('path');
const { test, expect } = require('../../test/fixtures');

const SCRIPT_PATH = path.join(__dirname, 'rescale-recent-efforts.user.js');
const CHART = '[data-testid="segment-recent-efforts"]';
const SETTLED = /page settled/;
const RESCALED = /capped at /;
// Every verdict the script can reach. Waiting for one of these is waiting for
// the script to have run, which "page settled" alone does not promise.
const DECIDED = /capped at |leaving the chart alone|no outliers|too few to rescale|unreadable/;

let cachedSegmentId = null;
let cachedCandidates = null;

async function segmentCandidates(page) {
  if (process.env.STRAVA_SEGMENT_ID) return [process.env.STRAVA_SEGMENT_ID];
  if (cachedCandidates) return cachedCandidates;
  await page.goto('https://www.strava.com/athlete/segments/starred');
  // Match on the href shape rather than a selector: the page's own navigation
  // links to /athlete/segments/starred, which an `a[href*="/segments/"]`
  // matches first and which carries no segment id.
  cachedCandidates = await page.evaluate(() => [...new Set(
    [...document.querySelectorAll('a[href^="/segments/"]')]
      .map((a) => (a.getAttribute('href').match(/^\/segments\/(\d+)/) || [])[1])
      .filter(Boolean))].slice(0, 5));
  if (!cachedCandidates.length) {
    throw new Error(
      'No starred segments found on /athlete/segments/starred. Are you logged in ' +
      'to Strava in the persistent profile? Set STRAVA_SEGMENT_ID to pick one directly.'
    );
  }
  return cachedCandidates;
}

// Open a segment whose chart actually plots efforts. Starring a segment does
// not mean having ridden it, and with no efforts there is no chart to test.
async function openSegmentChart(page) {
  const ids = cachedSegmentId ? [cachedSegmentId] : await segmentCandidates(page);
  for (const id of ids) {
    await page.goto(`https://www.strava.com/segments/${id}`);
    try {
      await page.waitForSelector(`${CHART} circle.visx-circle`, { timeout: 20000 });
      cachedSegmentId = id;
      return id;
    } catch {
      // No efforts plotted on this one; try the next starred segment.
    }
  }
  throw new Error(
    `None of these starred segments plots any efforts: ${ids.join(', ')}. ` +
    `Set STRAVA_SEGMENT_ID to a segment you have ridden.`
  );
}

// Collect the script's own log lines, and let a test wait for one.
function watchLogs(page) {
  const lines = [];
  page.on('console', (m) => {
    const text = m.text();
    if (text.includes('[strava-efforts]')) lines.push(text.replace(/^.*\[strava-efforts\] /, ''));
  });
  return {
    lines,
    async waitFor(re, timeout = 20000) {
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

// Everything the assertions need, read straight off the rendered chart.
const readChart = () => {
  const svg = [...document.querySelectorAll('[data-testid="segment-recent-efforts"] svg')]
    .find((s) => s.querySelector('.visx-axis-left'));
  if (!svg) return null;
  const axisLines = [...svg.querySelectorAll('.visx-axis-line')];
  const vertical = axisLines.find((l) => l.getAttribute('x1') === l.getAttribute('x2'));
  const horizontal = axisLines.find((l) => l.getAttribute('y1') === l.getAttribute('y2'));
  const plotWidth = Number(horizontal.getAttribute('x2'));
  const parse = (label) => {
    if (label === '0s') return 0;
    const m = /^(\d+):([0-5]\d)$/.exec(label);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  return {
    plotBottom: Number(vertical.getAttribute('y2')),
    plotWidth,
    circles: [...svg.querySelectorAll('circle.visx-circle')].map((c) => Number(c.getAttribute('cy'))),
    pinned: [...svg.querySelectorAll('[data-jshute-pinned]')].map((c) => Number(c.getAttribute('cy'))),
    edited: svg.querySelectorAll('[data-jshute-attrs]').length,
    hiddenTicks: [...svg.querySelectorAll('.visx-axis-left .visx-axis-tick')]
      .filter((g) => g.style.display === 'none').length,
    ticks: [...svg.querySelectorAll('.visx-axis-left .visx-axis-tick')]
      .filter((g) => g.style.display !== 'none')
      .map((g) => ({ seconds: parse(g.querySelector('tspan').textContent.trim()),
                     y: Number(g.querySelector('text').getAttribute('y')) })),
    // The date axis's year brackets sit at a constant y and carry no time.
    // Treating them as values was a real bug; this is the regression guard.
    bracketYs: [...svg.querySelectorAll('line')]
      .filter((l) => l.getAttribute('y1') === l.getAttribute('y2') &&
                     Number(l.getAttribute('x2')) - Number(l.getAttribute('x1')) < 0.9 * plotWidth)
      .map((l) => l.getAttribute('y1')),
  };
};

test.describe('Strava: rescale the segment efforts chart', () => {
  test('leaves the chart internally consistent', async ({ page, loadUserscript }) => {
    const logs = watchLogs(page);
    await loadUserscript(SCRIPT_PATH);
    await openSegmentChart(page);
    await logs.waitFor(DECIDED);

    const chart = await page.evaluate(readChart);
    expect(chart).not.toBeNull();

    // Every tick reads as a time, and later times sit lower on the chart.
    expect(chart.ticks.length).toBeGreaterThan(1);
    for (const tick of chart.ticks) expect(tick.seconds).not.toBeNull();
    for (let i = 1; i < chart.ticks.length; i++) {
      expect(chart.ticks[i].seconds).toBeGreaterThan(chart.ticks[i - 1].seconds);
      expect(chart.ticks[i].y).toBeGreaterThan(chart.ticks[i - 1].y);
    }

    // No effort is drawn outside the plot.
    for (const cy of chart.circles) {
      expect(cy).toBeGreaterThanOrEqual(0);
      expect(cy).toBeLessThanOrEqual(chart.plotBottom);
    }

    // The year brackets are still where the date axis drew them.
    for (const y of chart.bracketYs) expect(Number(y)).toBeLessThan(20);
  });

  test('pins outliers on the axis when it rescales', async ({ page, loadUserscript }) => {
    const logs = watchLogs(page);
    await loadUserscript(SCRIPT_PATH);
    await openSegmentChart(page);
    const verdict = await logs.waitFor(DECIDED);
    test.skip(!RESCALED.test(verdict), `nothing to cap on this segment: ${verdict}`);

    const chart = await page.evaluate(readChart);
    expect(chart.pinned.length).toBeGreaterThan(0);
    // Pinned efforts are centered on the axis line, and marked but not restyled.
    for (const cy of chart.pinned) expect(cy).toBeCloseTo(chart.plotBottom, 1);
  });

  test('undoes every edit when it stands down', async ({ page, loadUserscript }) => {
    const logs = watchLogs(page);
    await loadUserscript(SCRIPT_PATH);
    await openSegmentChart(page);
    await logs.waitFor(DECIDED);

    // Strip the chart down to too few efforts to rescale. The script should
    // stand down and put back everything an earlier pass changed.
    await page.evaluate(() => {
      const svg = [...document.querySelectorAll('[data-testid="segment-recent-efforts"] svg')]
        .find((s) => s.querySelector('.visx-axis-left'));
      [...svg.querySelectorAll('circle.visx-circle')].slice(2).forEach((c) => c.remove());
    });
    await logs.waitFor(/too few to rescale/);

    const chart = await page.evaluate(readChart);
    expect(chart.edited).toBe(0);
    expect(chart.pinned.length).toBe(0);
    expect(chart.hiddenTicks).toBe(0);
  });

  test('stays off pages that are not segment pages', async ({ page, loadUserscript }) => {
    const logs = watchLogs(page);
    await loadUserscript(SCRIPT_PATH);
    await page.goto('https://www.strava.com/dashboard');
    await page.waitForTimeout(3000);
    await page.evaluate(() => document.body.appendChild(document.createElement('div')));
    await page.waitForTimeout(1500);

    expect(logs.lines).toContain('init');
    expect(logs.lines.filter((l) => SETTLED.test(l))).toEqual([]);
  });
});
