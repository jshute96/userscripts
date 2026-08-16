// ==UserScript==
// @name         Peloton: Default filters on class lists
// @namespace    https://github.com/jshute96/userscripts
// @version      3.0.3
// @description  Applies your preferred filters on class lists by default, so browsing starts from a useful view. Defaults are configurable per class type from the script menu.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://members.onepeloton.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @grant        window.onurlchange
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[peloton filters]';

  if (window.__pelotonFiltersLoaded) {
    console.log(TAG, 'already loaded; skipping duplicate run');
    return;
  }
  window.__pelotonFiltersLoaded = true;

  // Peloton is a SPA: navigating between /home, /classes/<category>,
  // /profile, etc. happens via pushState, no document reload. @match
  // is broadened to the site root so this script is present no matter
  // which page the user initially landed on. The two work mechanisms
  // below (document-level capture-phase click handlers, MutationObserver
  // for href rewrites) self-gate by element and run harmlessly on
  // pages that don't have category links or discipline tiles.
  console.log(TAG, 'init on', location.pathname);

  // -----------------------------------------------------------------
  // Configurable defaults
  // -----------------------------------------------------------------
  //
  // Saved config lives in GM storage under one key as a map:
  //
  //     {
  //         "_all":  { difficulty_level: '…', has_workout: '…', … },
  //         "yoga":  { duration: '…', instructor_id: '…', … },
  //         "cycling": { … },
  //     }
  //
  // Lookup order when rewriting a link to /classes/<slug>:
  //   1. configMap[slug]            (per-class-type saved config)
  //   2. configMap[ALL_KEY]         (saved global default)
  //   3. HARDCODED_DEFAULTS         (built-in fallback)
  //
  // Saves and resets happen from the Tampermonkey menu while viewing
  // a /classes/<slug> page. The "Set defaults" actions read the
  // current page's URL query string, drop a small set of non-filter
  // params (NON_FILTER_PARAMS), and stash the rest under the chosen
  // key.

  const STORAGE_KEY = 'peloton-filters:config';
  const ALL_KEY = '_all';

  // Built-in defaults — used when neither a per-category nor an _all
  // saved config exists.
  const HARDCODED_DEFAULTS = Object.freeze({
    difficulty_level: JSON.stringify(['intermediate', 'advanced']),
    has_workout: JSON.stringify(['false']),
  });

  // Query params we strip when capturing "the current page's filter
  // state" as saved defaults. categorySlug duplicates the path;
  // class_type_id is a per-category sub-filter not portable across
  // categories; modal/classId encode transient UI state (open modal,
  // open class overlay) we don't want to redo on every navigation.
  const NON_FILTER_PARAMS = new Set([
    'categorySlug',
    'class_type_id',
    'modal',
    'classId',
  ]);

  // -----------------------------------------------------------------
  // Config map (loaded once, mutated in place on save/reset)
  // -----------------------------------------------------------------
  function loadConfig() {
    const raw = GM_getValue(STORAGE_KEY, null);
    if (raw == null) return {};
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(raw); }
    catch (e) {
      console.log(TAG, 'config parse failed, resetting:', e);
      return {};
    }
  }

  let configMap = loadConfig();
  console.log(TAG, 'loaded saved config:', JSON.stringify(configMap));

  function persistConfig() {
    GM_setValue(STORAGE_KEY, configMap);
  }

  function configFor(slug) {
    if (slug && configMap[slug]) return configMap[slug];
    if (configMap[ALL_KEY]) return configMap[ALL_KEY];
    return HARDCODED_DEFAULTS;
  }

  // -----------------------------------------------------------------
  // Slug extraction
  // -----------------------------------------------------------------
  // The class video player lives at /classes/player/<id> — that's
  // never a "category" and we don't want menu items there.
  function slugFromPath(pathname) {
    const m = /^\/classes\/([^/?]+)/.exec(pathname);
    if (!m) return null;
    if (m[1] === 'player') return null;
    return m[1];
  }

  function prettifySlug(slug) {
    return slug.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  // -----------------------------------------------------------------
  // Href rewriting
  // -----------------------------------------------------------------
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
    const conf = configFor(slugFromPath(pathPart));
    const params = new URLSearchParams(queryPart);
    for (const [k, v] of Object.entries(conf)) params.set(k, v);
    const qs = params.toString();
    return qs ? pathPart + '?' + qs : pathPart;
  }

  function rewriteCategoryHref(a) {
    const href = a.getAttribute('href');
    if (!isCategoryNavHref(href)) return false;
    const target = buildFilteredHref(href);
    if (href === target) return false;
    a.setAttribute('href', target);
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
  //
  // We skip the class-player page: the video player mutates the DOM
  // every frame (timestamps, controls, progress bar), and there are
  // no category anchors there to rewrite. Avoid the per-frame rAF +
  // querySelectorAll cost entirely.
  const PLAYER_PATH_RE = /^\/classes\/player\//;
  const isPlayerPage = () => PLAYER_PATH_RE.test(location.pathname);

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    if (isPlayerPage()) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      rewriteAllCategoryLinks();
    });
  }

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  schedule(); // initial pass

  // -----------------------------------------------------------------
  // Click interception
  // -----------------------------------------------------------------
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
    const target = buildFilteredHref(href);
    console.log(TAG, 'category click → navigating to', target);
    location.assign(target);
  }, true);

  // Home-page discipline tiles are <div role="button"
  // data-test-id="fitnessDisciplinePortalCard"> rather than anchors.
  // React handles their click in its own bubble-phase handler and
  // navigates via the Next.js router; we intercept the same way as
  // the category-tab anchors above — capture-phase, preventDefault,
  // hard-navigate to the filtered /classes/<slug> URL.
  //
  // Label → slug map for the home-page discipline tiles. Most labels
  // match the slug after lower-casing, but "Tread Bootcamp" notably
  // maps to plain `bootcamp` (Peloton's original Bootcamp class
  // type), and the "Bike"/"Row" variants get explicit slugs. Derived
  // by walking the /classes nav and pairing each tab's text against
  // its `/classes/<slug>` href.
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

  // -----------------------------------------------------------------
  // Menu commands (save / reset defaults)
  // -----------------------------------------------------------------
  function captureCurrentParams() {
    const kept = {};
    const dropped = {};
    for (const [k, v] of new URLSearchParams(location.search)) {
      if (NON_FILTER_PARAMS.has(k)) dropped[k] = v;
      else kept[k] = v;
    }
    return { kept, dropped };
  }

  function saveDefaultsFor(key, displayName) {
    const { kept, dropped } = captureCurrentParams();
    console.log(TAG, 'saving defaults for', displayName,
          '— captured:', JSON.stringify(kept),
          Object.keys(dropped).length
            ? `(dropped non-filter params: ${JSON.stringify(dropped)})`
            : '(no params dropped)');
    configMap[key] = kept;
    persistConfig();
    console.log(TAG, 'new config:', JSON.stringify(configMap));
    rewriteAllCategoryLinks();
    refreshMenu();
  }

  function clearDefaultsFor(slug) {
    const was = configMap[slug];
    console.log(TAG, 'clearing saved defaults for', slug,
          '(was:', JSON.stringify(was) + ')');
    delete configMap[slug];
    persistConfig();
    console.log(TAG, 'new config:', JSON.stringify(configMap));
    rewriteAllCategoryLinks();
    refreshMenu();
  }

  function resetDefaults() {
    console.log(TAG, 'resetting all saved defaults (was:',
          JSON.stringify(configMap) + ')');
    configMap = {};
    GM_deleteValue(STORAGE_KEY);
    rewriteAllCategoryLinks();
    refreshMenu();
  }

  // Menu items only make sense on a /classes/<slug> page, so they're
  // rebuilt whenever the path changes.
  let menuIds = [];
  function clearMenuItems() {
    for (const id of menuIds) GM_unregisterMenuCommand(id);
    menuIds = [];
  }
  function logActiveConfigForCurrentPage() {
    const slug = slugFromPath(location.pathname);
    if (!slug) return;
    if (configMap[slug]) {
      console.log(TAG, 'on /classes/' + slug,
            '— using', slug, 'config:', JSON.stringify(configMap[slug]));
    } else if (configMap[ALL_KEY]) {
      console.log(TAG, 'on /classes/' + slug,
            '— using _all config:', JSON.stringify(configMap[ALL_KEY]));
    } else {
      console.log(TAG, 'on /classes/' + slug,
            '— no saved config; using defaults:',
            JSON.stringify(HARDCODED_DEFAULTS));
    }
  }

  function refreshMenu() {
    clearMenuItems();
    logActiveConfigForCurrentPage();
    const slug = slugFromPath(location.pathname);
    if (!slug) return;
    // `/classes/all` is the "all class types" landing page — its
    // filter state is exactly what the _all default should capture,
    // so the per-slug commands would be redundant (and misleading,
    // since "all" isn't really a class type).
    if (slug !== 'all') {
      menuIds.push(GM_registerMenuCommand(
        `Peloton filters: set defaults for ${prettifySlug(slug)}`,
        () => saveDefaultsFor(slug, slug)));
      if (configMap[slug]) {
        menuIds.push(GM_registerMenuCommand(
          `Peloton filters: clear saved defaults for ${prettifySlug(slug)}`,
          () => clearDefaultsFor(slug)));
      }
    }
    menuIds.push(GM_registerMenuCommand(
      'Peloton filters: set defaults for all class types',
      () => saveDefaultsFor(ALL_KEY, 'all class types')));
    menuIds.push(GM_registerMenuCommand(
      'Peloton filters: reset all saved defaults',
      () => resetDefaults()));
  }

  // `urlchange` fires on same-path history mutations too (opening a
  // class-detail modal rewrites only the query string), so only
  // rebuild when the path actually changed.
  let lastPath = location.pathname;
  function onUrlChange() {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    refreshMenu();
  }
  window.addEventListener('urlchange', onUrlChange);

  refreshMenu();
})();
