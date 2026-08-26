// ==UserScript==
// @name         Strava: Rescale segment my-efforts graph to handle outliers better
// @namespace    https://github.com/jshute96/userscripts
// @version      0.1.5
// @description  Strava's Recent Efforts graph scales its y-axis (time) to include your slowest ride. Rescale the graph so a few slow outliers don't flatten everything else.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://www.strava.com/*
// @grant        window.onurlchange
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[strava-efforts]';

  // The capped axis has to cover at least this multiple of the PR time, and at
  // least enough to include this fraction of the efforts, whichever is larger.
  // The PR multiple keeps a segment where every ride is slow from being blown
  // up into meaningless noise; the coverage keeps a segment with a long tail of
  // genuinely-slow rides from pinning half of them.
  const PR_MULTIPLE = 2;
  const COVERAGE = 0.8;

  // Rescaling always pins something — the coverage rule guarantees it — so it has
  // to earn its keep. Below this much extra vertical resolution, a chart is
  // already readable and is left exactly as Strava drew it. Set to 1 to always
  // rescale.
  const MIN_GAIN = 1.5;

  // Where we stash the value we computed, and the value Strava had before it,
  // so a re-render (React rewrites the chart on hover) is distinguishable from
  // our own edit and never gets transformed twice.
  const DST = 'data-jshute-dst';
  const SRC = 'data-jshute-src';
  // Which attributes a value was written to, so an edit can be undone without
  // the undo code having to know what kind of element it is looking at.
  const ATTRS = 'data-jshute-attrs';
  const PINNED = 'data-jshute-pinned';

  const CHART = '[data-testid="segment-recent-efforts"]';
  const SEGMENT_PATH = /^\/segments\/\d+\/?$/;
  const DEBOUNCE_MS = 50;
  // Strava server-renders this chart and React hydrates it afterwards. Editing
  // a tick's text before that finishes is a hydration mismatch, which makes
  // React throw away the server's markup for the whole page and re-render it
  // client-side. So the first pass waits for the load event and then for the
  // document to stop changing, which is hydration finishing.
  const HYDRATION_QUIET_MS = 500;
  // Strava is not a quiet page — a map, ads, and lazy-loaded panels all mutate
  // the document. Waiting for quiet that may never come would mean silently
  // never rescaling, so the wait is capped: past this, apply anyway and accept
  // the small risk of a hydration mismatch.
  const HYDRATION_MAX_MS = 4000;
  // The chart is server-rendered, so it is normally there on the first look.
  // Only complain once waiting has gone on long enough to mean it moved.
  const WAITING_WARN_MS = 10000;

  // Nice tick steps, in seconds. Chosen so labels land on whole minutes once
  // the spread is big enough for that to read well.
  const TICK_STEPS = [1, 2, 5, 10, 15, 20, 30, 60, 120, 180, 300, 600, 900, 1800, 3600];

  let applying = false;
  let pending = null;
  let waitingSince = 0;
  let warned = false;
  let lastPath = null;
  let lastReported = null;
  let settled = false;
  let waitStarted = 0;

  // ---------------------------------------------------------------- values

  // Strava labels the axis "0s" at zero and "M:SS" above it. Match that, so a
  // relabeled tick is indistinguishable from one we left alone. (Their own
  // formatter mangles negative ticks into strings like "-1:0-5:00", which is
  // why the stock chart sometimes has a garbled label above "0s".)
  function formatTime(seconds) {
    const t = Math.round(seconds);
    if (t === 0) return '0s';
    const sign = t < 0 ? '-' : '';
    const a = Math.abs(t);
    const s = String(a % 60).padStart(2, '0');
    const m = Math.floor(a / 60);
    if (m < 60) return `${sign}${m}:${s}`;
    return `${sign}${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}:${s}`;
  }

  function parseTime(label) {
    if (label === '0s') return 0;
    const m = /^(\d+):([0-5]\d)$/.exec(label);
    if (m) return Number(m[1]) * 60 + Number(m[2]);
    const h = /^(\d+):([0-5]\d):([0-5]\d)$/.exec(label);
    if (h) return Number(h[1]) * 3600 + Number(h[2]) * 60 + Number(h[3]);
    return null;
  }

  // The value we last wrote, or the current one if Strava has since replaced
  // it. Recording both is what makes re-applying after a re-render safe: our
  // own output is never mistaken for a fresh time to transform again.
  function sourceValue(el, attr) {
    const now = el.getAttribute(attr);
    if (now !== null && now === el.getAttribute(DST)) {
      const src = el.getAttribute(SRC);
      if (src !== null) return Number(src);
    }
    el.setAttribute(SRC, now);
    return Number(now);
  }

  // A tick's position and its label have to be read and written as one unit:
  // Strava's y against our relabeled text (or the reverse) yields a scale that
  // is wrong in a way nothing downstream can detect.
  function tickNodes(g) {
    const text = g.querySelector('text');
    const tspan = g.querySelector('tspan');
    return text && tspan ? { text, tspan } : null;
  }

  function tickState(n) {
    return JSON.stringify({ y: n.text.getAttribute('y'), label: n.tspan.textContent.trim() });
  }

  function tickSource(g) {
    const n = tickNodes(g);
    if (!n) return null;
    const now = tickState(n);
    if (g.getAttribute(DST) === now) {
      const src = g.getAttribute(SRC);
      if (src) return JSON.parse(src);
    }
    g.setAttribute(SRC, now);
    return JSON.parse(now);
  }

  function writeTick(g, y, seconds) {
    const n = tickNodes(g);
    if (!n) return;
    const now = JSON.stringify({ y: String(y), label: formatTime(seconds) });
    // setAttribute notifies the observer even when the value is unchanged, so
    // a write we do not need is a write that wakes us up again forever.
    if (g.getAttribute(DST) === now) return;
    const { y: ty, label } = JSON.parse(now);
    n.text.setAttribute('y', ty);
    n.tspan.textContent = label;
    g.setAttribute(DST, now);
  }

  function writeValue(el, attrs, value) {
    const text = String(value);
    if (el.getAttribute(DST) === text && attrs.every((a) => el.getAttribute(a) === text)) return;
    for (const attr of attrs) el.setAttribute(attr, text);
    el.setAttribute(DST, text);
    el.setAttribute(ATTRS, attrs.join(','));
  }

  // Put the chart back exactly as Strava drew it.
  //
  // Needed because deciding *not* to rescale is not the same as never having
  // rescaled: React can hand the same nodes to a different segment's chart
  // during a client-side navigation, and hidden ticks or moved dots would
  // otherwise survive onto a chart nobody rescaled.
  //
  // Only edits that are still ours are undone — an element whose value no
  // longer matches what we wrote has been re-rendered by React since, and
  // React's value is the right one to leave in place.
  function restore(svg) {
    let undone = 0;

    for (const g of svg.querySelectorAll('.visx-axis-left .visx-axis-tick')) {
      if (g.style.display) {
        g.style.display = '';
        undone++;
      }
      const n = tickNodes(g);
      const src = g.getAttribute(SRC);
      if (n && src && g.getAttribute(DST) === tickState(n)) {
        const original = JSON.parse(src);
        n.text.setAttribute('y', original.y);
        n.tspan.textContent = original.label;
        undone++;
      }
      g.removeAttribute(DST);
      g.removeAttribute(SRC);
    }

    for (const el of svg.querySelectorAll(`[${ATTRS}]`)) {
      const attrs = el.getAttribute(ATTRS).split(',');
      const src = el.getAttribute(SRC);
      if (src !== null && el.getAttribute(attrs[0]) === el.getAttribute(DST)) {
        for (const attr of attrs) el.setAttribute(attr, src);
        undone++;
      }
      el.removeAttribute(ATTRS);
      el.removeAttribute(DST);
      el.removeAttribute(SRC);
    }

    for (const el of svg.querySelectorAll(`[${PINNED}]`)) el.removeAttribute(PINNED);
    return undone;
  }

  // Leave the chart as Strava drew it, undoing any earlier pass first.
  function standDown(svg, message) {
    const undone = restore(svg);
    report(undone ? `${message}; undid ${undone} earlier edit(s)` : message);
    return false;
  }

  // Smallest value at or below which `fraction` of the times fall.
  function percentile(sorted, fraction) {
    const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
    return sorted[i];
  }

  // The chart is re-examined on every re-render, so say something only when
  // the answer changes.
  function report(message) {
    if (message === lastReported) return;
    lastReported = message;
    console.log(TAG, message);
  }

  // ---------------------------------------------------------------- chart

  function findChart(section) {
    for (const svg of section.querySelectorAll('svg')) {
      if (svg.querySelector('.visx-axis-left') && svg.querySelector('circle.visx-circle')) return svg;
    }
    return null;
  }

  // Why there is no chart to work on. Strava legitimately draws no chart for a
  // segment you have never ridden, and shows a subscriber upsell in its place
  // for non-subscribers — neither is a broken selector, and calling them one
  // turns the "markup changed" warning into a cry of wolf.
  function noChartReason(section) {
    if (!section) return `no ${CHART} section on this segment page — has the markup changed?`;
    if (section.querySelector('.visx-axis-left')) {
      return 'the efforts chart is drawn but plots no efforts; nothing to rescale';
    }
    return 'the efforts section holds no chart — no efforts on this segment, a subscriber ' +
      'upsell in its place, or the markup has changed';
  }

  // Recover Strava's own time-to-pixel mapping from the axis it drew. Reading
  // the rendered axis rather than the page's data keeps this correct after a
  // client-side navigation to another segment, where the embedded JSON still
  // describes the segment the tab was opened on.
  function readScale(svg) {
    const ticks = [];
    for (const g of svg.querySelectorAll('.visx-axis-left .visx-axis-tick')) {
      const src = tickSource(g);
      if (!src) continue;
      const seconds = parseTime(src.label);
      if (seconds === null) continue;
      ticks.push({ seconds, y: Number(src.y) });
    }
    if (ticks.length < 2) return null;
    const first = ticks[0];
    const last = ticks[ticks.length - 1];
    if (last.seconds === first.seconds) return null;
    const pixelsPerSecond = (last.y - first.y) / (last.seconds - first.seconds);
    const atZero = first.y - first.seconds * pixelsPerSecond;
    return {
      toY: (t) => atZero + t * pixelsPerSecond,
      toTime: (y) => (y - atZero) / pixelsPerSecond,
    };
  }

  // Horizontal rules that carry a time: the dashed PR line, and the solid line
  // tracking whichever effort is hovered. Both span the full plot.
  //
  // The width test is what separates them from the date axis's year brackets —
  // the short rules drawn under "2020", "2021" and so on. Those sit at a
  // constant y in their own group, so treating them as values moves them all
  // to one place and draws a gapped line across the chart.
  function valueLines(svg) {
    const width = plotWidth(svg);
    const lines = [];
    for (const line of svg.querySelectorAll('line')) {
      if (line.classList.contains('visx-axis-line')) continue;
      // Test the span before reading the value, so lines we do not own never
      // get marked up.
      const x1 = Number(line.getAttribute('x1'));
      const x2 = Number(line.getAttribute('x2'));
      if (!(x1 <= 1) || !(x2 >= 0.9 * width)) continue;
      const y1 = sourceValue(line, 'y1');
      if (!Number.isFinite(y1) || y1 !== Number(line.getAttribute('y2')) || y1 <= 0) continue;
      lines.push(line);
    }
    return lines;
  }

  function apply(svg) {
    const scale = readScale(svg);
    if (!scale) return standDown(svg, 'axis ticks unreadable — have the tick labels changed format?');

    const circles = Array.from(svg.querySelectorAll('circle.visx-circle'));
    if (circles.length < 3) {
      return standDown(svg, `only ${circles.length} effort(s) plotted, too few to rescale`);
    }
    const times = circles.map((c) => scale.toTime(sourceValue(c, 'cy')));

    // The PR is drawn as two stacked circles at one date, so count each column
    // once or it skews the percentile.
    const seen = new Set();
    const sorted = [];
    circles.forEach((c, i) => {
      const key = c.getAttribute('cx');
      if (seen.has(key)) return;
      seen.add(key);
      sorted.push(times[i]);
    });
    sorted.sort((a, b) => a - b);
    const fastest = sorted[0];
    const slowest = sorted[sorted.length - 1];

    const lines = valueLines(svg);
    const prLine = lines.find((l) => l.hasAttribute('stroke-dasharray'));
    const prTime = prLine ? scale.toTime(sourceValue(prLine, 'y1')) : fastest;

    const cap = Math.max(PR_MULTIPLE * prTime, percentile(sorted, COVERAGE));
    if (cap >= slowest) {
      return standDown(svg, `no outliers: slowest ${formatTime(slowest)} is within the cap ${formatTime(cap)}`);
    }

    // The top of Strava's band is left alone — the space above it is where the
    // hover tooltip is drawn. The bottom is not reserved for anything, though:
    // Strava simply puts the slowest effort there, leaving a fixed margin down
    // to the axis. Running all the way to the axis instead centers pinned
    // efforts on it, and gives the rest of the chart the extra height.
    const top = scale.toY(fastest);
    const bottom = plotBottom(svg);
    const perSecond = (bottom - top) / (cap - fastest);
    const gain = (cap - fastest) === 0 ? 1 : (slowest - fastest) / (cap - fastest);
    if (gain < MIN_GAIN) {
      return standDown(svg, `capping at ${formatTime(cap)} would only gain ${gain.toFixed(2)}x, leaving the chart alone`);
    }
    const toY = (t) => top + (Math.min(t, cap) - fastest) * perSecond;

    applying = true;
    try {
      let pinned = 0;
      circles.forEach((circle, i) => {
        writeValue(circle, ['cy'], toY(times[i]));
        // Pinned efforts are marked but not restyled: sitting on the axis is
        // already what makes them read as pinned, and coloring them in would
        // draw the eye to the least interesting rides on the chart.
        if (times[i] > cap) {
          pinned++;
          if (!circle.hasAttribute(PINNED)) circle.setAttribute(PINNED, '1');
        }
      });

      for (const line of lines) writeValue(line, ['y1', 'y2'], toY(scale.toTime(sourceValue(line, 'y1'))));

      // The "PR 1:24" caption sits at fixed offsets beside its line, so shift
      // it by however far the line moved rather than rescaling its position.
      if (prLine) {
        const shift = toY(prTime) - scale.toY(prTime);
        for (const text of prLine.parentNode.querySelectorAll('text')) {
          writeValue(text, ['y'], sourceValue(text, 'y') + shift);
        }
      }

      const summary = `capped at ${formatTime(cap)} (PR ${formatTime(prTime)}, slowest ${formatTime(slowest)})`;
      const drawn = relabelAxis(svg, (t) => top + (t - fastest) * perSecond, (y) => fastest + (y - top) / perSecond);
      const perSecondBefore = scale.toY(1) - scale.toY(0);
      const resolution = perSecond / perSecondBefore;
      report(`${summary}; ${pinned} effort(s) pinned, ${drawn} tick(s) drawn, ` +
        `${resolution.toFixed(2)}x resolution (${gain.toFixed(2)}x from capping)`);
    } finally {
      applying = false;
    }
    return true;
  }

  // Reuse Strava's own tick nodes rather than adding any: repositioned and
  // relabeled, with the leftovers hidden. Nothing is inserted into React's
  // tree, so a re-render has nothing of ours to trip over.
  //
  // Ticks use the uncapped scale and cover the whole plot, exactly as Strava's
  // do — the cap moves efforts, not the axis they are read against.
  function relabelAxis(svg, axisY, axisTime) {
    const groups = Array.from(svg.querySelectorAll('.visx-axis-left .visx-axis-tick'));
    if (!groups.length) return 0;

    const bottom = plotBottom(svg);
    // A range of exactly N steps needs N+1 ticks to label both ends, so the
    // step has to fit in one fewer interval than we have nodes for. Without
    // the -1 the bottom tick is computed and then silently dropped.
    const intervals = Math.max(1, groups.length - 1);
    const step = TICK_STEPS.find((s) => (axisTime(bottom) - axisTime(0)) / s <= intervals) ||
      TICK_STEPS[TICK_STEPS.length - 1];

    const wanted = [];
    const first = Math.max(0, Math.ceil(axisTime(0) / step) * step);
    for (let t = first; wanted.length < groups.length; t += step) {
      const y = axisY(t);
      if (y > bottom) break;
      if (y >= 0) wanted.push({ seconds: t, y });
    }

    groups.forEach((g, i) => {
      const tick = wanted[i];
      if (!tick) {
        g.style.display = 'none';
        return;
      }
      g.style.display = '';
      writeTick(g, tick.y, tick.seconds);
    });
    return wanted.length;
  }

  // The plot area's extent, read off the two lines visx draws for the axes, so
  // nothing strays into the date labels below or the PR caption to the right.
  function plotBottom(svg) {
    for (const line of svg.querySelectorAll('.visx-axis-line')) {
      if (line.getAttribute('x1') === line.getAttribute('x2')) return Number(line.getAttribute('y2'));
    }
    return (Number(svg.getAttribute('height')) || 400) * 0.825;
  }

  function plotWidth(svg) {
    for (const line of svg.querySelectorAll('.visx-axis-line')) {
      if (line.getAttribute('y1') === line.getAttribute('y2')) return Number(line.getAttribute('x2'));
    }
    return Number(svg.getAttribute('width')) || 0;
  }

  // ---------------------------------------------------------------- driving

  function onSegmentPage() {
    return SEGMENT_PATH.test(location.pathname);
  }

  function tick() {
    if (!onSegmentPage()) return;
    const section = document.querySelector(CHART);
    const svg = section && findChart(section);
    if (!svg) {
      if (!waitingSince) waitingSince = Date.now();
      if (!warned && Date.now() - waitingSince > WAITING_WARN_MS) {
        warned = true;
        console.log(TAG, `${WAITING_WARN_MS}ms and still nothing to work on: ${noChartReason(section)}`);
      }
      return;
    }
    if (waitingSince) {
      console.log(TAG, 'found the Your Recent Efforts chart');
      waitingSince = 0;
      warned = false;
    }
    apply(svg);
  }

  function settle(reason) {
    clearTimeout(pending);
    pending = null;
    settled = true;
    console.log(TAG, `page settled (${reason}), hydration should be done`);
    tick();
  }

  function schedule() {
    // The observer watches the whole document, so this runs on every Strava
    // page. Everything below only makes sense on a segment page; without this
    // check the rest of the site pays for timers it can never use, and logs a
    // "page settled" line for a chart that does not exist there.
    if (!onSegmentPage()) return;
    if (applying) return;
    if (settled) {
      if (pending) return;
      pending = setTimeout(() => { pending = null; tick(); }, DEBOUNCE_MS);
      return;
    }
    // Not settled yet: restart the timer on every mutation, so the first pass
    // happens only once the page has gone quiet — but never wait past the
    // deadline, or a page that never goes quiet never gets rescaled.
    if (!waitStarted) waitStarted = Date.now();
    if (Date.now() - waitStarted >= HYDRATION_MAX_MS) {
      settle(`no quiet ${HYDRATION_QUIET_MS}ms within ${HYDRATION_MAX_MS}ms`);
      return;
    }
    clearTimeout(pending);
    pending = setTimeout(() => settle('quiet'), HYDRATION_QUIET_MS);
  }

  function onUrlChange() {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    waitingSince = 0;
    warned = false;
    // A new chart is about to render, so wait for quiet again — and drop the
    // fast-path timer the previous page left armed, which would otherwise fire
    // into the middle of that render, the very thing the wait exists to avoid.
    settled = false;
    waitStarted = 0;
    clearTimeout(pending);
    pending = null;
    // Decisions are reported once each; a new segment deserves to be told
    // about even when its verdict reads the same as the last one's.
    lastReported = null;
    if (onSegmentPage()) schedule();
  }

  console.log(TAG, 'init');
  // React redraws the chart on hover and on resize, which puts Strava's own
  // coordinates back; re-apply whenever it does.
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['cy', 'y', 'y1', 'y2', 'width'],
  });
  window.addEventListener('urlchange', onUrlChange);
  lastPath = location.pathname;
  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, { once: true });
})();
