// ==UserScript==
// @name         GitHub: Show line counts for each commit
// @namespace    https://github.com/jshute96/userscripts
// @version      0.1.1
// @description  Shows lines added and removed for each commit, in commit history, pull request, and issue pages. Merge commits are grayed out.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://github.com/*
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
  'use strict';

  const log = (...args) => console.log('[line counts]', ...args);
  const CLASS = 'gh-line-counts';
  const CONCURRENCY = 4;

  // sha -> Promise of { additions, deletions, isMerge }, for this tab.
  // Commits never change, so results are also stored for good (one GM value
  // per sha, as [additions, deletions, isMerge]), shared across tabs and
  // reloads.
  const cache = new Map();
  const queue = [];
  let active = 0;

  const isCount = (n) => Number.isInteger(n) && n >= 0;

  function fetchStats(repoPath, sha) {
    if (!cache.has(sha)) {
      const stored = GM_getValue(sha);
      if (Array.isArray(stored) && isCount(stored[0]) && isCount(stored[1])) {
        const [additions, deletions, isMerge] = stored;
        cache.set(sha, Promise.resolve({ additions, deletions, isMerge }));
        return cache.get(sha);
      }
      cache.set(sha, new Promise((resolve, reject) => {
        queue.push({ repoPath, sha, resolve, reject });
        pump();
      }));
    }
    return cache.get(sha);
  }

  function pump() {
    while (active < CONCURRENCY && queue.length) {
      const job = queue.shift();
      active++;
      // The commit page answers with its JSON payload when asked for JSON.
      fetch(`${job.repoPath}/commit/${job.sha}`, { headers: { Accept: 'application/json' } })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
        .then((j) => {
          const route = j.payload && j.payload.commitRoute;
          const info = route && route.headerInfo;
          if (!info || !isCount(info.additions) || !isCount(info.deletions)) {
            throw new Error('no line counts in commit JSON');
          }
          const stats = {
            additions: info.additions,
            deletions: info.deletions,
            isMerge: (route.commit && route.commit.parents || []).length > 1,
          };
          GM_setValue(job.sha, [stats.additions, stats.deletions, stats.isMerge]);
          job.resolve(stats);
        })
        .catch((e) => {
          // No retry here, which would only add to any rate limiting. The
          // next page load (or GitHub drawing the row again) tries again.
          cache.delete(job.sha);
          job.reject(e);
        })
        .finally(() => {
          active--;
          pump();
        });
    }
  }

  // Each commit row we can annotate: the sha, the repo, and the element
  // our counts go in front of.
  function findRows() {
    const rows = [];
    // Commit history lists (React): /<owner>/<repo>/commits/..., and a
    // pull request's Commits tab, whose links change from /commits/<sha>
    // to /changes/<sha> when the client re-renders the rows.
    for (const row of document.querySelectorAll('[data-testid="commit-row-item"][data-commit-link]')) {
      const m = row.dataset.commitLink.match(/^(\/[^/]+\/[^/]+)\/(?:commit|pull\/\d+\/(?:commits|changes))\/([0-9a-f]{40})/);
      // The short-sha button, not the title link to the same commit.
      const shaLink = m && [...row.querySelectorAll(`a[href$="${m[2]}"]`)].find((a) => {
        const text = a.textContent.trim();
        return text.length >= 7 && m[2].startsWith(text);
      });
      if (shaLink) rows.push({ row, repoPath: m[1], sha: m[2], before: shaLink.parentElement });
    }
    // Pull request conversation timeline: the sha link at the right of
    // each pushed commit.
    for (const shaLink of document.querySelectorAll('.TimelineItem .text-right code a[href*="/pull/"]')) {
      const m = shaLink.getAttribute('href').match(/^(\/[^/]+\/[^/]+)\/pull\/\d+\/(?:commits|changes)\/([0-9a-f]{40})$/);
      const before = shaLink.closest('.text-right');
      if (m && before) rows.push({ row: shaLink.closest('.TimelineItem'), repoPath: m[1], sha: m[2], before });
    }
    // Issue timeline (React): "added a commit that references this issue",
    // with the short-sha link at the right. Its href is absolute, and may
    // name another repo.
    for (const shaLink of document.querySelectorAll('[class*="ReferencedEventInner-module"][class*="commitActions"] a[href*="/commit/"]')) {
      const m = new URL(shaLink.href).pathname.match(/^(\/[^/]+\/[^/]+)\/commit\/([0-9a-f]{40})$/);
      if (m) rows.push({ row: shaLink.parentElement, repoPath: m[1], sha: m[2], before: shaLink });
    }
    return rows;
  }

  function render(el, stats) {
    const fmt = (n) => n.toLocaleString('en-US');
    el.textContent = '';
    const add = document.createElement('span');
    add.className = `${CLASS}-add`;
    add.textContent = `+${fmt(stats.additions)}`;
    const del = document.createElement('span');
    del.className = `${CLASS}-del`;
    del.textContent = `-${fmt(stats.deletions)}`;
    el.append(add, del);
    el.classList.toggle(`${CLASS}-merge`, stats.isMerge);
  }

  // Log how many rows got counts, once per burst rather than per row.
  let shown = 0;
  let shownTimer = 0;
  function noteShown() {
    shown++;
    clearTimeout(shownTimer);
    shownTimer = setTimeout(() => {
      log(`showed counts for ${shown} commit${shown === 1 ? '' : 's'}`);
      shown = 0;
    }, 500);
  }

  // Fetch counts only for rows near the screen, so a long pull request
  // doesn't fetch every commit at once.
  const watching = new Set();
  const visible = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const el = entry.target;
      visible.unobserve(el);
      watching.delete(el);
      const { repo, sha } = el.dataset;
      fetchStats(repo, sha).then(
        (stats) => {
          if (el.dataset.sha !== sha) return;
          render(el, stats);
          noteShown();
        },
        (e) => log(`failed to get counts for ${sha.slice(0, 7)}:`, e.message),
      );
    }
  }, { rootMargin: '500px 0px' });

  function unwatch(el) {
    visible.unobserve(el);
    watching.delete(el);
  }

  function scan() {
    let added = 0;
    for (const { repoPath, sha, before } of findRows()) {
      let el = before.previousElementSibling;
      if (el && el.classList.contains(CLASS)) {
        if (el.dataset.sha === sha) continue;
        unwatch(el);
        el.remove(); // React reused the row for another commit
      }
      el = document.createElement('span');
      el.className = CLASS;
      el.dataset.repo = repoPath;
      el.dataset.sha = sha;
      before.before(el);
      visible.observe(el);
      watching.add(el);
      added++;
    }
    // Rows GitHub dropped (paging, in-page navigation) before they came
    // into view.
    for (const el of watching) if (!el.isConnected) unwatch(el);
    if (added) log(`found ${added} commit row${added === 1 ? '' : 's'}`);
  }

  const style = document.createElement('style');
  style.dataset.ghLineCounts = '';
  style.textContent = `
    .${CLASS} {
      display: inline-flex; align-items: center; gap: 4px;
      margin-right: 8px; font-size: 12px; font-weight: 600; white-space: nowrap;
    }
    .${CLASS}-add { color: var(--fgColor-success, #1a7f37); }
    .${CLASS}-del { color: var(--fgColor-danger, #d1242f); }
    .${CLASS}-merge, .${CLASS}-merge > * { color: var(--fgColor-muted, #59636e); font-weight: 400; }
  `;
  // On <html>, so it survives GitHub swapping out <head> or <body>.
  document.documentElement.append(style);

  // Our own changes (adding a span, filling it in) don't need a re-scan.
  const ours = (n) => n.nodeType === 1 && n.closest(`.${CLASS}`);
  const isOurs = (m) => ours(m.target)
    || (m.addedNodes.length + m.removedNodes.length > 0
      && [...m.addedNodes, ...m.removedNodes].every(ours));

  let pending = false;
  new MutationObserver((mutations) => {
    if (pending || mutations.every(isOurs)) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; scan(); });
  }).observe(document.documentElement, { childList: true, subtree: true });

  log('init');
  scan();
})();
