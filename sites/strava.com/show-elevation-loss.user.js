// ==UserScript==
// @name         Strava: Show elevation gain *and loss* for each segment
// @namespace    https://github.com/jshute96/userscripts
// @version      0.3.3
// @description  Strava shows climbing but never descending. This adds Elevation Loss next to Elevation Gain on the segment and activity pages.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://www.strava.com/activities/*
// @match        https://www.strava.com/segments/*
// @grant        none
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[strava-elev]';
  // Ignore altitude wobbles smaller than this before counting them as climbing
  // or descending. Barometric/GPS jitter otherwise inflates both totals.
  const NOISE_THRESHOLD_M = 1;
  const FEET_PER_METRE = 3.28084;
  const ROW_DONE = 'data-jshute-elev-row';
  const STATS_DONE = 'data-jshute-elev-stats';
  const STREAM_WAIT_MS = 20000;
  const POLL_MS = 250;

  // ---------------------------------------------------------------- shared

  // Total climbing and total descending over a slice of an elevation stream.
  // Note this is neither net loss nor max-min: on a climb, max-min is the gain,
  // and net loss is zero however much descending the ride actually did.
  function gainLoss(elevation, startIndex, endIndex) {
    const from = startIndex == null ? 0 : startIndex;
    const to = endIndex == null ? elevation.length - 1 : endIndex;
    if (!(from >= 0) || !(to > from) || to >= elevation.length) return null;
    let gain = 0;
    let loss = 0;
    let reference = elevation[from];
    for (let i = from + 1; i <= to; i++) {
      const delta = elevation[i] - reference;
      if (Math.abs(delta) < NOISE_THRESHOLD_M) continue;
      if (delta > 0) gain += delta;
      else loss -= delta;
      reference = elevation[i];
    }
    return { gain, loss };
  }

  // Streams are metres; the page's own unit label says what the athlete sees,
  // so reuse it and our numbers can never disagree with the page's units.
  function unitFactor(label) {
    return /feet|foot|\bft\b/i.test(label || '') ? FEET_PER_METRE : 1;
  }

  function debounced(fn, ms) {
    let pending = null;
    return () => {
      if (pending) return;
      pending = setTimeout(() => { pending = null; fn(); }, ms);
    };
  }

  // Poll for data the page fetches asynchronously, then run `then` once.
  function whenReady(get, then, what) {
    const deadline = Date.now() + STREAM_WAIT_MS;
    const tick = () => {
      const value = get();
      if (value) return then(value);
      if (Date.now() > deadline) {
        console.log(TAG, `gave up waiting for ${what}; nothing changed`);
        return;
      }
      setTimeout(tick, POLL_MS);
    };
    tick();
  }

  // ------------------------------------------------------- activity pages

  function altitudeStream() {
    try {
      const streams = window.pageView && pageView.streams && pageView.streams();
      const altitude = streams && streams.getStream && streams.getStream('altitude');
      return altitude && altitude.length ? altitude : null;
    } catch (err) {
      return null;
    }
  }

  // Every effort on the page is preloaded with the stream indices it spans, so
  // no per-row request is needed — see the .md for how this was verified.
  function effortsById() {
    const map = new Map();
    const add = (model) => {
      const effort = model && model.toJSON ? model.toJSON() : model;
      if (effort && effort.id != null) map.set(String(effort.id), effort);
    };
    try {
      const efforts = window.pageView && pageView.segmentEfforts && pageView.segmentEfforts();
      if (!efforts) return map;
      if (efforts.each) efforts.each(add);
      // Efforts the athlete hid live in their own table, and in a plain array
      // hanging off the same collection rather than in the collection itself.
      if (Array.isArray(efforts.hiddenSegmentEfforts)) efforts.hiddenSegmentEfforts.forEach(add);
    } catch (err) {
      console.log(TAG, 'could not read segment efforts:', err);
    }
    return map;
  }

  function plainText(html) {
    return String(html == null ? '' : html).replace(/<[^>]*>/g, '').trim();
  }

  // Strava's published total climbing for the segment, or null where they report
  // 0 — correct for the pure descents that make up most of those, but wrong on
  // the occasional categorised climb. See the .md.
  function stravaGain(effort) {
    const value = parseFloat(plainText(effort.elev_gain));
    return isFinite(value) && value > 0 ? value : null;
  }

  function elevationSpan(row) {
    const stats = row.querySelector('td.name-col .stats');
    if (!stats) return null;
    // Our own marker first: once decorated the span no longer carries Strava's
    // title, and without this it would look like a span we had never seen.
    return stats.querySelector(`span[${ROW_DONE}]`) ||
      stats.querySelector('span[title="Elevation difference"]') ||
      Array.from(stats.querySelectorAll('span'))
        .find((s) => /elevation/i.test(s.getAttribute('title') || '')) || null;
  }

  function unitFromAbbr(element) {
    const abbr = element && element.querySelector('abbr.unit');
    if (!abbr) return null;
    return { factor: unitFactor(abbr.getAttribute('title')), labelHtml: abbr.outerHTML };
  }

  // Gain is Strava's own figure wherever they publish a non-zero one; the loss,
  // and the gain they report as 0, are ours. Each says so on hover.
  function effortFigures(effort, altitude) {
    const totals = gainLoss(altitude, effort.start_index, effort.end_index);
    if (!totals) return null;
    const published = stravaGain(effort);
    // gainIsOurs also decides conversion: Strava's gain is already in display
    // units, ours is metres.
    return {
      gain: published == null ? totals.gain : published,
      loss: totals.loss,
      gainIsOurs: published == null,
    };
  }

  function decorateRow(row, efforts, altitude) {
    const effort = efforts.get(String(row.getAttribute('data-segment-effort-id')));
    if (!effort) return false;
    const span = elevationSpan(row);
    // Mark the element whose content we own, not the row: Strava re-renders the
    // stats without replacing the row, and a marker on the row would then claim
    // work that had just been wiped out.
    if (!span || span.hasAttribute(ROW_DONE)) return false;
    const unit = unitFromAbbr(span);
    if (!unit) return false;
    const figures = effortFigures(effort, altitude);
    if (!figures) return false;

    const gain = Math.round(figures.gain * (figures.gainIsOurs ? unit.factor : 1));
    const loss = Math.round(figures.loss * unit.factor);
    // Two child spans so gain and loss can each say where they came from; the
    // outer span drops Strava's "Elevation difference" title, which no longer
    // describes what is in it.
    const part = (html, title) => {
      const el = document.createElement('span');
      el.innerHTML = html;
      el.setAttribute('title', title);
      return el;
    };
    // Tooltips name the quantity as well as its source: unlike the segment
    // page's stats, nothing on this row labels the numbers.
    span.textContent = '';
    span.appendChild(part(`+${gain}${unit.labelHtml}`, figures.gainIsOurs
      ? 'Elevation gain (summed from this ride; Strava reports 0)'
      : 'Elevation gain (from segment)'));
    span.appendChild(document.createTextNode(' '));
    span.appendChild(part(`−${loss}${unit.labelHtml}`, 'Elevation loss (summed from this ride)'));
    span.removeAttribute('title');
    span.setAttribute(ROW_DONE, figures.gainIsOurs ? 'computed-gain' : '1');
    return true;
  }

  // Strava's own elev_difference should land near our max-min for the same
  // slice. If it doesn't, our units or the stream's meaning have changed, and
  // the numbers we print would be quietly wrong — so say so once.
  let sanityChecked = false;
  function sanityCheck(rows, efforts, altitude) {
    if (sanityChecked) return;
    const ratios = [];
    for (const row of rows) {
      const effort = efforts.get(String(row.getAttribute('data-segment-effort-id')));
      const unit = effort && unitFromAbbr(elevationSpan(row));
      if (!unit) continue;
      const shown = parseFloat(plainText(effort.elev_difference));
      const slice = altitude.slice(effort.start_index, effort.end_index + 1);
      if (!isFinite(shown) || shown <= 0 || slice.length < 2) continue;
      const range = (Math.max.apply(null, slice) - Math.min.apply(null, slice)) * unit.factor;
      if (range > 0) ratios.push(shown / range);
    }
    if (ratios.length < 3) return;
    sanityChecked = true;
    ratios.sort((a, b) => a - b);
    const median = ratios[Math.floor(ratios.length / 2)];
    if (median < 0.75 || median > 1.33) {
      console.warn(TAG, `elevation figures may be wrong: Strava's own elev_difference ` +
        `is ${median.toFixed(2)}x our altitude range, expected about 1. Check whether ` +
        `the stream units or elev_difference's meaning changed.`);
    }
  }

  // ----------------------------------------------------- column alignment

  // The stats line under each segment name holds four figures — Strava's
  // distance and average grade, and the gain/loss pair we write. They are
  // plain inline spans, so each row's numbers start wherever the previous
  // one happened to end. Giving each figure a fixed width, sized to the
  // widest example anywhere on the page, turns them into right-justified
  // columns that line up down the table.
  const COL_ATTR = 'data-jshute-elev-col';
  const COLS = ['dist', 'gain', 'loss', 'grade'];
  const ALIGN_STYLE_ID = 'jshute-elev-align';

  function ensureAlignStyle() {
    if (document.getElementById(ALIGN_STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = ALIGN_STYLE_ID;
    // Width comes from a custom property so re-measuring is one property set
    // per column rather than an inline style write on every row.
    style.textContent = COLS.map((name) => `
      td.name-col .stats [${COL_ATTR}="${name}"] {
        display: inline-block;
        white-space: nowrap;
        text-align: right;
        width: var(--jshute-elev-w-${name}, auto);
      }`).join('\n');
    (document.head || document.documentElement).appendChild(style);
  }

  // Keyed by what each figure is, not by position, so a row missing one of
  // them still lines the rest up.
  function statCells(row) {
    const stats = row.querySelector('td.name-col .stats');
    if (!stats) return null;
    const cells = {};
    for (const span of stats.querySelectorAll('span')) {
      const title = span.getAttribute('title') || '';
      if (/^distance/i.test(title)) cells.dist = span;
      else if (/^elevation gain/i.test(title)) cells.gain = span;
      else if (/^elevation loss/i.test(title)) cells.loss = span;
      else if (/^average grade/i.test(title)) cells.grade = span;
    }
    return cells;
  }

  let alignedWidths = {};
  function alignColumns() {
    const rows = document.querySelectorAll('tr[data-segment-effort-id]');
    if (!rows.length) return;
    ensureAlignStyle();
    const found = {};
    for (const row of rows) {
      const cells = statCells(row);
      if (!cells) continue;
      for (const name of COLS) {
        const el = cells[name];
        if (!el) continue;
        // Only write the attribute when it is missing. Our observer watches
        // childList only, so an attribute write can't wake it today — but a
        // no-op setAttribute still queues a mutation record, and the day
        // someone adds `attributes: true` this becomes a re-measure loop.
        if (el.getAttribute(COL_ATTR) !== name) el.setAttribute(COL_ATTR, name);
        (found[name] || (found[name] = [])).push(el);
      }
    }
    // Drop the current widths so each figure reports its natural size, measure
    // them all, then write the maxima back: one read pass, one write pass.
    // The custom properties live on <html>, outside the observer's subtree.
    const root = document.documentElement.style;
    for (const name of COLS) root.removeProperty(`--jshute-elev-w-${name}`);
    const widths = {};
    for (const name of COLS) {
      if (!found[name]) continue;
      widths[name] = Math.ceil(Math.max.apply(null,
        found[name].map((el) => el.getBoundingClientRect().width)));
    }
    const changed = COLS.some((name) => widths[name] !== alignedWidths[name]);
    for (const name of COLS) {
      if (widths[name]) root.setProperty(`--jshute-elev-w-${name}`, `${widths[name]}px`);
    }
    if (changed) {
      alignedWidths = widths;
      console.log(TAG, 'aligned stat columns to ' +
        COLS.filter((n) => widths[n]).map((n) => `${n} ${widths[n]}px`).join(', '));
    }
  }

  function applyToActivity(altitude) {
    const efforts = effortsById();
    if (!efforts.size) return 0;
    const rows = Array.from(document.querySelectorAll('tr[data-segment-effort-id]'));
    sanityCheck(rows, efforts, altitude);
    let changed = 0;
    for (const row of rows) {
      if (decorateRow(row, efforts, altitude)) changed++;
    }
    return changed;
  }

  function initActivity() {
    console.log(TAG, 'init on', location.pathname);
    whenReady(altitudeStream, (altitude) => {
      const changed = applyToActivity(altitude);
      alignColumns();
      const ours = document.querySelectorAll(`span[${ROW_DONE}="computed-gain"]`).length;
      console.log(TAG, `gain/loss shown on ${changed} effort row(s)` +
        (ours ? `; ${ours} used our own gain because Strava reports 0 for the segment` : ''));
      const rerun = debounced(() => {
        const more = applyToActivity(altitude);
        alignColumns();
        if (more) console.log(TAG, `updated ${more} more effort row(s) after a re-render`);
      }, 100);
      new MutationObserver(rerun).observe(document.body, { childList: true, subtree: true });
    }, 'the activity altitude stream (pageView.streams().getStream("altitude"))');
  }

  // -------------------------------------------------------- segment pages

  // The segment page is Next.js; its payload carries the same elevation stream
  // that draws the profile chart, so nothing extra is fetched here either.
  function segmentElevation() {
    try {
      const props = window.__NEXT_DATA__ && __NEXT_DATA__.props && __NEXT_DATA__.props.pageProps;
      const elevation = props && props.streams && props.streams.elevation;
      return Array.isArray(elevation) && elevation.length ? elevation : null;
    } catch (err) {
      return null;
    }
  }

  function statsList() {
    return document.querySelector('ul[class*="SegmentStats_stats"]');
  }

  function statLabel(item) {
    const label = item.querySelector('[class*="Stat_statLabel"]');
    return label ? label.textContent.trim() : '';
  }

  function applyToSegment(elevation) {
    const list = statsList();
    if (!list) return false;
    const items = Array.from(list.querySelectorAll('li'));
    const gainItem = items.find((li) => /elevation gain/i.test(statLabel(li)));
    if (!gainItem) return false;
    const valueEl = gainItem.querySelector('[class*="Stat_statValue"]');
    if (!valueEl) return false;

    // "1,452 m" -> unit "m"; also tells us whether to convert from metres. The
    // sign is stripped first so a lost marker can't produce "++1,452 m".
    const shown = valueEl.textContent.trim().replace(/^[+−-]\s*/, '');
    const unit = (shown.match(/^[\d.,]+\s*(.*)$/) || [])[1] || '';
    const factor = unitFactor(unit);
    const totals = gainLoss(elevation, 0, elevation.length - 1);
    if (!totals) return false;
    const amount = (metres) => `${Math.round(metres * factor).toLocaleString()}${unit ? ' ' + unit : ''}`;

    // The two edits are checked independently: React can replace the gain stat
    // while our cloned loss survives, and coupling them would leave the new gain
    // unsigned forever.
    const done = [];

    // Mark the value we rewrite, not the list: React replaces these on re-render
    // and a marker on the container would claim work that had just been undone.
    if (!valueEl.hasAttribute(STATS_DONE)) {
      // Strava stores 0 gain for some segments that plainly climb — see the .md.
      // Summing the same profile they publish gain from reproduces their figure
      // to within ~12 m elsewhere, so it is the sane thing to show for "0 m".
      const substitute = !(parseFloat(shown.replace(/,/g, '')) > 0);
      // Sign it so the pair reads as a direction, not two magnitudes.
      valueEl.textContent = `+${substitute ? amount(totals.gain) : shown}`;
      if (substitute) {
        valueEl.setAttribute('title',
          'Elevation gain (summed from segment profile; Strava reports 0)');
      }
      valueEl.setAttribute(STATS_DONE, '1');
      done.push(`gain ${valueEl.textContent}${substitute ? ' (ours)' : ''}`);
    }

    if (!items.some((li) => /elevation loss/i.test(statLabel(li)))) {
      // Clone the neighbouring stat so the CSS-module class hashes come along.
      const item = gainItem.cloneNode(true);
      item.querySelector('[class*="Stat_statLabel"]').textContent = 'Elevation Loss';
      const cloneValue = item.querySelector('[class*="Stat_statValue"]');
      cloneValue.textContent = `−${amount(totals.loss)}`;
      cloneValue.setAttribute('title', 'Elevation loss (summed from segment profile)');
      cloneValue.removeAttribute(STATS_DONE);  // Inherited from the clone source.
      item.removeAttribute('data-testid');
      gainItem.insertAdjacentElement('afterend', item);
      done.push(`loss ${cloneValue.textContent}`);
    }

    if (!done.length) return false;
    console.log(TAG, `segment stats: ${done.join(', ')}`);
    return true;
  }

  function initSegment() {
    console.log(TAG, 'init on', location.pathname);
    whenReady(() => (statsList() ? segmentElevation() : null), (elevation) => {
      applyToSegment(elevation);
      // React re-renders the stats row (and swaps segments without a reload).
      const rerun = debounced(() => applyToSegment(segmentElevation() || elevation), 150);
      new MutationObserver(rerun).observe(document.body, { childList: true, subtree: true });
    }, 'the segment elevation stream (__NEXT_DATA__.props.pageProps.streams.elevation)');
  }

  // ------------------------------------------------------------------ init

  function init() {
    if (document.querySelector('tr[data-segment-effort-id]')) return initActivity();
    if (/^\/segments\/\d+/.test(location.pathname)) return initSegment();
    // Anything else (segment search, an activity with no efforts) is not ours.
  }

  init();
})();
