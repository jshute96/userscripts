// ==UserScript==
// @name         Hacker News: Better comment navigation
// @namespace    https://github.com/jshute96/userscripts
// @version      1.0.9
// @description  Improve comment navigation with keyboard shortcuts and additional links
// @author       Jeff Shute <jshute@gmail.com>
// @match        https://news.ycombinator.com/item*
// @grant        none
// @run-at       document-idle
// @updateURL    https://github.com/jshute96/userscripts/raw/refs/heads/main/sites/news.ycombinator.com/better-comment-navigation.user.js
// @downloadURL  https://github.com/jshute96/userscripts/raw/refs/heads/main/sites/news.ycombinator.com/better-comment-navigation.user.js
// ==/UserScript==

(function () {
    'use strict';

    const TAG = '[hn nav]';

    if (window.__hnNavLinksLoaded) {
        console.log(TAG, 'already loaded; skipping duplicate run');
        return;
    }
    window.__hnNavLinksLoaded = true;

    // Order in which links are rendered in each .navs row.
    const ORDER = ['down', 'up', 'next', 'prev', 'parent', 'parent-next', 'root', 'root-next'];

    // name -> { key, suffix (rendered as " (X)" with X underlined), action, fallback }
    const KEYS = {
        'down':        { key: 'j', suffix: 'j', action: 'scroll-next' },
        'up':          { key: 'k', suffix: 'k', action: 'scroll-prev' },
        'next':        { key: 'h', suffix: 'h' },
        'prev':        { key: 'l', suffix: 'l' },
        'parent':      { key: 'p', suffix: 'p' },
        'parent-next': { key: 'n', suffix: 'n', fallback: 'next' },
        'root':        { key: 'r', suffix: 'r' },
        'root-next':   { key: 'm', suffix: 'm', fallback: 'next' },
    };

    console.log(TAG, 'initializing');

    function readOriginalLinks(navs) {
        // Returns {name: href} for HN's original anchor-style nav links.
        const map = {};
        navs.querySelectorAll('a.clicky[aria-hidden="true"][href^="#"]').forEach(a => {
            const label = a.textContent.replace(/\s*\([^()]*\)\s*$/, '').trim();
            if (label && KEYS[label]) map[label] = a.getAttribute('href');
        });
        return map;
    }

    function buildNavsByCommentId() {
        const byId = {};
        document.querySelectorAll('span.navs').forEach(navs => {
            const togg = navs.querySelector('a.togg');
            if (togg && togg.id) byId[togg.id] = navs;
        });
        return byId;
    }

    function makeUnderline(text) {
        const u = document.createElement('u');
        u.style.textDecoration = 'underline';
        u.textContent = text;
        return u;
    }

    function decorateLabel(name) {
        const cfg = KEYS[name];
        const frag = document.createDocumentFragment();
        frag.appendChild(document.createTextNode(name + ' ('));
        frag.appendChild(makeUnderline(cfg.suffix));
        frag.appendChild(document.createTextNode(')'));
        return frag;
    }

    function makeNavLink(name, href) {
        const a = document.createElement('a');
        a.href = href;
        a.className = 'clicky';
        a.setAttribute('aria-hidden', 'true');
        a.dataset.navName = name;
        a.appendChild(decorateLabel(name));
        return a;
    }

    function makeScrollLink(name) {
        const a = document.createElement('a');
        a.href = 'javascript:void(0)';
        a.className = 'clicky';
        a.setAttribute('aria-hidden', 'true');
        a.dataset.navName = name;
        a.appendChild(decorateLabel(name));
        a.addEventListener('click', e => {
            e.preventDefault();
            const direction = KEYS[name].action === 'scroll-next' ? 'next' : 'prev';
            const fromRow = a.closest('tr.athing.comtr');
            jumpItemFrom(fromRow, direction);
        });
        return a;
    }

    function rebuildNav(navs, hrefs) {
        const togg = navs.querySelector('a.togg');
        const onstory = navs.querySelector('.onstory');
        navs.textContent = '';

        for (const name of ORDER) {
            const cfg = KEYS[name];
            let el = null;
            if (cfg.action === 'scroll-next' || cfg.action === 'scroll-prev') {
                el = makeScrollLink(name);
            } else if (hrefs[name]) {
                el = makeNavLink(name, hrefs[name]);
            }
            if (!el) continue;
            navs.appendChild(document.createTextNode(' | '));
            navs.appendChild(el);
        }
        navs.appendChild(document.createTextNode(' '));
        if (togg) navs.appendChild(togg);
        if (onstory) navs.appendChild(onstory);
    }

    function rebuildAll() {
        const allNavs = document.querySelectorAll('span.navs');
        if (!allNavs.length) {
            console.log(TAG, 'no .navs spans found');
            return;
        }
        const byId = buildNavsByCommentId();

        // Capture original hrefs first (rebuild mutates the DOM).
        const captured = new Map();
        allNavs.forEach(navs => captured.set(navs, readOriginalLinks(navs)));

        // Compute parent-next and root-next from captured originals.
        captured.forEach((hrefs, navs) => {
            if (!hrefs.parent) return;
            const parentId = hrefs.parent.slice(1);
            const rootId = (hrefs.root || hrefs.parent).slice(1);
            const parentNavs = byId[parentId];
            const rootNavs = byId[rootId];
            const parentNext = parentNavs ? captured.get(parentNavs)?.next : null;
            const rootNext = rootNavs ? captured.get(rootNavs)?.next : null;
            if (parentNext) hrefs['parent-next'] = parentNext;
            if (rootNext)   hrefs['root-next'] = rootNext;
        });

        let count = 0;
        captured.forEach((hrefs, navs) => {
            rebuildNav(navs, hrefs);
            count++;
        });
        console.log(TAG, `rebuilt ${count} nav rows`);
    }

    function findCurrentRow() {
        // First comtr whose div.comment intersects the viewport.
        const all = document.querySelectorAll('tr.athing.comtr');
        const vh = window.innerHeight;
        for (const tr of all) {
            const c = tr.querySelector('div.comment');
            if (!c) continue;
            const rect = c.getBoundingClientRect();
            if (rect.bottom > 0 && rect.top < vh) return tr;
        }
        return null;
    }

    function findCurrentNavs() {
        const row = findCurrentRow();
        if (!row) return null;
        return row.querySelector('span.navs');
    }

    function isTypingTarget(el) {
        if (!el) return false;
        const tag = el.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
        if (el.isContentEditable) return true;
        return false;
    }

    function nameForKey(key) {
        for (const [name, cfg] of Object.entries(KEYS)) {
            if (cfg.key === key) return name;
        }
        return null;
    }

    function commentRows() {
        return document.querySelectorAll('tr.athing.comtr');
    }

    function jumpItemFrom(fromRow, direction) {
        const rows = [...commentRows()];
        if (!rows.length) {
            console.log(TAG, 'no comment rows found');
            return;
        }
        const idx = fromRow ? rows.indexOf(fromRow) : -1;
        const target = direction === 'next'
            ? (idx >= 0 ? rows[idx + 1] : rows[0])
            : (idx > 0 ? rows[idx - 1] : null);
        if (!target) {
            console.log(TAG, `no ${direction} item to scroll to`);
            return;
        }
        console.log(TAG, `scrolling to ${direction} item id=${target.id || '?'}`);
        target.scrollIntoView({ block: 'start' });
    }

    function jumpItem(direction) {
        // Keyboard path: navigate relative to the first on-screen comment.
        jumpItemFrom(findCurrentRow(), direction);
    }

    function clickByName(navs, name) {
        const a = navs.querySelector(`a[data-nav-name="${name}"]`);
        return a;
    }

    function onKeyDown(e) {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (isTypingTarget(e.target)) return;

        const name = nameForKey(e.key);
        if (!name) return;
        const cfg = KEYS[name];

        if (cfg.action === 'scroll-next') {
            e.preventDefault();
            jumpItem('next');
            return;
        }
        if (cfg.action === 'scroll-prev') {
            e.preventDefault();
            jumpItem('prev');
            return;
        }

        const navs = findCurrentNavs();
        if (!navs) {
            console.log(TAG, `key "${e.key}" pressed but no nav row visible on screen`);
            return;
        }
        let link = clickByName(navs, name);
        let resolvedName = name;
        if (!link && cfg.fallback) {
            link = clickByName(navs, cfg.fallback);
            if (link) resolvedName = `${name} -> ${cfg.fallback}`;
        }
        if (!link) {
            const togg = navs.querySelector('a.togg');
            const id = togg ? togg.id : '?';
            const present = [...navs.querySelectorAll('a[data-nav-name]')].map(a => a.dataset.navName);
            console.log(TAG, `key "${e.key}" -> "${name}" not on current comment (id=${id}); present: [${present.join(', ')}]`);
            return;
        }
        e.preventDefault();
        console.log(TAG, `key "${e.key}" -> ${resolvedName} -> ${link.getAttribute('href')}`);
        link.click();
    }

    rebuildAll();
    document.addEventListener('keydown', onKeyDown);
    console.log(TAG, 'keys: j=down, k=up, h=next, l=prev, p=parent, n=parent-next, r=root, m=root-next');
})();
