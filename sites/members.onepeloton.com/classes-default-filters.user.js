// ==UserScript==
// @name         Peloton Classes: Default filters
// @namespace    https://github.com/jshute96/userscripts
// @version      2.1.0
// @description  Rewrite Peloton category-tab links (and intercept home-page discipline tiles) so navigating to any /classes/<category> page lands with default filters preset (Difficulty=Intermediate+Advanced, has-workout=Not Taken).
// @author       Jeff Shute <jshute@gmail.com>
// @match        https://members.onepeloton.com/classes*
// @match        https://members.onepeloton.com/home*
// @exclude      https://members.onepeloton.com/classes/player/*
// @grant        none
// @run-at       document-idle
// @noframes
// @updateURL    https://github.com/jshute96/userscripts/raw/refs/heads/main/sites/members.onepeloton.com/classes-default-filters.user.js
// @downloadURL  https://github.com/jshute96/userscripts/raw/refs/heads/main/sites/members.onepeloton.com/classes-default-filters.user.js
// ==/UserScript==

(function () {
    'use strict';

    const TAG = '[peloton filters]';

    if (window.__pelotonFiltersLoaded) {
        console.log(TAG, 'already loaded; skipping duplicate run');
        return;
    }
    window.__pelotonFiltersLoaded = true;

    console.log(TAG, 'init');

    // Filter params we splice into every category-tab href. Peloton's
    // listing pages encode multi-valued filters as JSON arrays in the
    // query string. The difficulty_level value is accepted (and just
    // ignored) on categories that don't expose a Difficulty section
    // such as Stretching, so we don't need per-category logic.
    const DIFFICULTY_LEVEL = JSON.stringify(['intermediate', 'advanced']);
    const HAS_WORKOUT = JSON.stringify(['false']);

    function isCategoryNavHref(href) {
        if (!href) return false;
        // Same-origin paths under /classes only. We deliberately leave
        // absolute-URL anchors alone (they're rare and would bypass the
        // SPA router anyway).
        if (!/^\/classes(\/|\?|$)/.test(href)) return false;
        // Class-detail links (`?classId=…&modal=classDetailsModal`)
        // share the /classes/<slug> prefix but open a single class
        // overlay — they shouldn't carry category-level filters.
        if (/[?&]classId=/.test(href)) return false;
        return true;
    }

    function buildFilteredHref(href) {
        const [pathPart, queryPart = ''] = href.split('?');
        const params = new URLSearchParams(queryPart);
        params.set('difficulty_level', DIFFICULTY_LEVEL);
        params.set('has_workout', HAS_WORKOUT);
        return pathPart + '?' + params.toString();
    }

    // Label → slug map for the home-page discipline tiles. The tiles
    // are React buttons (no anchors) so we can't reach them via the
    // href-rewrite path; we look up the slug by the visible <h1>
    // text. Most labels match the slug after lower-casing, but
    // "Tread Bootcamp" notably maps to plain `bootcamp` (Peloton's
    // original Bootcamp class type), and the "Bike"/"Row" variants
    // get explicit slugs. Derived by walking the /classes nav and
    // pairing each tab's text against its `/classes/<slug>` href.
    const DISCIPLINE_SLUGS = {
        'strength':       'strength',
        'pilates':        'pilates',
        'yoga':           'yoga',
        'stretching':     'stretching',
        'cycling':        'cycling',
        'cardio':         'cardio',
        'meditation':     'meditation',
        'walking':        'walking',
        'running':        'running',
        'rowing':         'rowing',
        'outdoor':        'outdoor',
        'tread bootcamp': 'bootcamp',
        'bike bootcamp':  'bike_bootcamp',
        'row bootcamp':   'row_bootcamp',
    };

    function slugForDisciplineLabel(label) {
        if (!label) return null;
        return DISCIPLINE_SLUGS[label.trim().toLowerCase()] || null;
    }

    function rewriteCategoryHref(a) {
        const href = a.getAttribute('href');
        if (!isCategoryNavHref(href)) return false;
        // Idempotent — both params already present means we (or someone
        // else) already rewrote this href.
        if (/[?&]difficulty_level=/.test(href) && /[?&]has_workout=/.test(href)) {
            return false;
        }
        a.setAttribute('href', buildFilteredHref(href));
        return true;
    }

    function rewriteAllCategoryLinks() {
        let count = 0;
        for (const a of document.querySelectorAll('a[href^="/classes"]')) {
            if (rewriteCategoryHref(a)) count++;
        }
        if (count > 0) console.log(TAG, 'rewrote', count, 'category link(s)');
    }

    // React re-renders the category nav on each route change (and on
    // initial hydration), so we observe DOM changes and re-walk. We
    // coalesce to one pass per animation frame to avoid hammering the
    // DOM during big renders.
    let scheduled = false;
    function schedule() {
        if (scheduled) return;
        scheduled = true;
        requestAnimationFrame(() => {
            scheduled = false;
            rewriteAllCategoryLinks();
        });
    }

    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    schedule(); // initial pass

    // Peloton's category tabs are React Link components: they capture
    // the `href` prop at render time and route through their own
    // onClick handler using the captured value, so our DOM-href rewrite
    // is invisible to a plain left-click. The rewrite still matters for
    // right-click "Copy link" and middle-click / Cmd+click "Open in new
    // tab" (those use the live DOM href), but for a regular click we
    // need to take over the navigation ourselves.
    //
    // Capture-phase listener fires before React's bubble-phase onClick.
    // We preventDefault + stopPropagation so React never sees the
    // event, then do a hard navigation to the filtered URL. The hard
    // reload is acceptable here — Peloton's per-category page-init is
    // already ~1.5s, comparable to its in-app SPA transition.
    document.addEventListener('click', function (e) {
        // Preserve modifier-key semantics (open in new tab/window/etc).
        // Those code paths use the DOM href, which we've already
        // rewritten, so they get filters too.
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
            return;
        }
        const a = e.target && e.target.closest && e.target.closest('a');
        if (!a) return;
        const href = a.getAttribute('href');
        if (!isCategoryNavHref(href)) return;
        e.preventDefault();
        e.stopPropagation();
        const target = (/[?&]difficulty_level=/.test(href) &&
                        /[?&]has_workout=/.test(href))
            ? href
            : buildFilteredHref(href);
        console.log(TAG, 'category click → navigating to', target);
        location.assign(target);
    }, true);

    // Home-page discipline tiles are <div role="button"
    // data-test-id="fitnessDisciplinePortalCard"> rather than anchors.
    // React handles their click in its own bubble-phase handler and
    // navigates via the Next.js router; we intercept the same way as
    // the category-tab anchors above — capture-phase, preventDefault,
    // hard-navigate to the filtered /classes/<slug> URL.
    document.addEventListener('click', function (e) {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
            return;
        }
        const card = e.target && e.target.closest &&
            e.target.closest('[data-test-id="fitnessDisciplinePortalCard"]');
        if (!card) return;
        const labelEl = card.querySelector('h1');
        const label = labelEl ? labelEl.textContent : '';
        const slug = slugForDisciplineLabel(label);
        if (!slug) {
            console.log(TAG, 'discipline tile click: unknown label', JSON.stringify(label),
                        '— letting React handle it');
            return;
        }
        e.preventDefault();
        e.stopPropagation();
        const target = buildFilteredHref('/classes/' + slug);
        console.log(TAG, 'discipline tile click →', label, '→', target);
        location.assign(target);
    }, true);
})();
