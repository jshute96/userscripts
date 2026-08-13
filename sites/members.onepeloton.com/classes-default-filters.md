# Peloton: Default filters on class lists

## Summary

Makes Peloton's class lists open with your preferred filters pre-applied.

Without this, class lists open unfiltered, showing all classes at all
difficulty levels, including classes you've already take.

This script makes those pages open with (configurable) default filters.

The script's defaults are to filter for **Not Taken** classes, and
exclude **Beginner** classes.

The userscript's context menu lets you set other defaults.

| Menu command | Effect |
| --- | --- |
| **Set defaults for \<class type\>** | Save the current page's filters for this class type only |
| **Set defaults for all class types** | Save them as the default for every class type |
| **Clear saved defaults for \<class type\>** | Drop this class type's override and fall back |
| **Reset all saved defaults** | Go back to the built-in defaults |

Defaults set per class type take priority over the global defaults.

## Visible changes

- Clicking any category tab on a `/classes/*` page (or a home-page
  discipline tile) navigates to e.g.
  `/classes/yoga?difficulty_level=["intermediate","advanced"]&has_workout=["false"]`,
  with the configured filters already active when the page renders.
- The userscript manager's menu offers up to four commands while viewing a
  `/classes/<slug>` page, in this order:
  - **Set defaults for <Class type>** — captures the current page's
    URL query params (minus a small set of non-filter params) and
    saves them under the current slug, so they only apply when
    navigating to that class type. Suppressed on `/classes/all`,
    since that page's defaults belong under the global `_all` key,
    not under a slug called "all".
  - **Clear saved defaults for <Class type>** — only shown when a
    per-slug config already exists for the current page. Deletes
    that one entry; the page falls back to the `_all` or hardcoded
    defaults on next navigation.
  - **Set defaults for all class types** — same capture, but stored
    under the special `_all` key as the global default applied to
    every class type that doesn't have its own override.
  - **Reset all saved defaults** — wipes the entire saved config;
    navigation falls back to the built-in defaults.
- Lookup order when rewriting a link to `/classes/<slug>`: the
  per-slug saved config, then the saved global "_all" config, then
  the built-in defaults.
- The dialog is never auto-opened — the page just lands filtered.
- Right-clicking → "Copy link" / "Open in new tab" / middle-click on a
  category tab also produces a filtered URL, because the DOM `href` is
  rewritten in addition to clicks being intercepted. (Home-page
  discipline tiles aren't anchors, so they don't expose a context-menu
  link to copy; only the plain-click path applies there.)
- Visiting bare `/classes/<category>` directly (typing the URL,
  bookmark, external link) is left alone — only navigation *via the
  in-page category tabs or home-page tiles* gets filters applied
  automatically.
- Class-detail links (`?classId=…&modal=classDetailsModal`) are not
  touched, since they open a single-class overlay rather than a
  filtered listing.

## Implementation

### What we observed

- Peloton's classes listing pages encode filter state in the query
  string: `difficulty_level=["intermediate","advanced"]` and
  `has_workout=["false"]` (JSON-array values, URL-encoded). Loading a
  URL with these params makes Peloton render that category's listing
  with the filters pre-applied. This works uniformly, including for
  categories whose Filter dialog lacks a Difficulty section
  (Stretching) — Peloton silently drops `difficulty_level` for those
  but honours `has_workout`.
- Other categories expose more filter params in the URL — `duration`,
  `instructor_id`, `class_type_id`, `equipment` and so on. The set
  varies per category. The script doesn't enumerate them: when
  capturing "current defaults" it just grabs every query param on the
  current URL and stores them verbatim, minus a small skip list. When
  rewriting a link, it appends whatever's stored under that slug.
- A few URL params should never be carried across category
  navigations: `categorySlug` (duplicates the path), `class_type_id`
  (per-category sub-filter not portable across categories), `modal`
  and `classId` (transient UI state — open modal, open class
  overlay). These are listed in `NON_FILTER_PARAMS` and stripped
  during capture. The capture log line prints which params were
  dropped so the skip list is easy to extend if Peloton adds new
  non-filter params.
- Earlier observation showed that switching categories via the in-page
  tabs does **not** preserve filter state — Peloton resets to the new
  category's defaults. Earlier iterations of this script tried to
  re-apply filters by walking the dialog after each navigation; that
  raced with Peloton's own page-init reset, intermittently leaving
  difficulty options off. The URL-rewriting approach sidesteps the
  race entirely: filters are applied during the new page's initial
  render, not by post-hoc dialog clicks.
- The category tabs are anchor (`<a>`) elements with bare hrefs like
  `/classes/yoga`. They appear to be Next.js `<Link>` components:
  React captures the `href` prop at render time and routes through
  its own `onClick` handler using that captured value, ignoring any
  later DOM mutation of the `href` attribute. We confirmed this in
  Playwright by mutating the `href` and clicking — navigation went to
  the *original* unfiltered URL despite the DOM showing the new one.
- Class-detail anchors share the `/classes/<slug>` prefix but always
  carry a `classId=…` query parameter (and usually `&modal=…`). They
  open a single-class overlay, not a filtered listing, so we skip
  them.
- The home-page discipline tiles are *not* anchors — they're
  `<div data-test-id="fitnessDisciplinePortalCard" role="button">`
  elements with an `<h1>` label inside. React routes through its own
  onClick handler using state-derived URLs, so neither an href
  rewrite nor an anchor-`closest` click handler can reach them. We
  identify the destination by reading the tile's `<h1>` text and
  mapping it to a slug.
- Discipline-tile labels mostly match the URL slug after lower-casing
  (Strength → `strength`, Yoga → `yoga`, …), but three don't:
  "Tread Bootcamp" maps to `bootcamp` (the original Bootcamp class
  type predates the Bike/Row variants), "Bike Bootcamp" to
  `bike_bootcamp`, and "Row Bootcamp" to `row_bootcamp`. The map was
  derived by reading each tab's text alongside its `/classes/<slug>`
  href on the `/classes` page.

- Peloton's site is a single-page app: clicking around between
  `/home`, `/classes/<category>`, `/profile`, etc. only changes the
  URL via `pushState`, with no document reload. A narrow `@match`
  (e.g. only `/classes*` and `/home*`) means the script never loads
  if the user's initial document was a different page. We broaden
  `@match` to `members.onepeloton.com/*` so the script is always
  registered for whatever page the user first opened. The work
  mechanisms — document-level capture-phase click listeners and a
  body-level `MutationObserver` for href rewrites — are global and
  self-gate by element, so they cost nothing on pages that don't
  contain category links or discipline tiles. The menu items need
  to re-register on URL change too, so the per-slug command label
  tracks the current page; we use Tampermonkey's
  `@grant window.onurlchange` rather than monkey-patching the
  History API.

### What we assume stays stable

- Filter values are encoded as URL query params with the JSON-array
  format Peloton currently uses.
- Category tabs are anchor elements with paths matching
  `/classes` or `/classes/<slug>`.
- Class-detail anchors continue to be identifiable by the presence of
  a `classId=` parameter.
- Home-page discipline tiles continue to be identifiable by
  `data-test-id="fitnessDisciplinePortalCard"` and to carry their
  visible label in a child `<h1>`.
- Peloton's discipline slugs continue to use the values in
  `DISCIPLINE_SLUGS`. New disciplines will be ignored (and logged)
  until the map is updated, but the tile will still navigate via
  Peloton's own handler — just without filters.
- Peloton continues to keep filter state in the URL query string
  rather than moving it into request bodies or per-session storage.
  If they switch to a non-URL filter mechanism, the whole "store URL
  params as defaults" model breaks.

### How we modify the page

- **Config storage** — A single GM-storage key
  (`peloton-filters:config`) holds an object: top-level keys
  are class-type slugs plus the special `_all` key for the global
  default; each value is a `{ paramName: paramValue }` map. Loaded
  once at script init and mutated in place on save/reset.
- **DOM `href` rewrite** — On script init, and on every `document.body`
  mutation (coalesced to one pass per animation frame), we walk
  `a[href^="/classes"]` and rewrite each anchor's `href` to one that
  carries the configured filter params for that slug (per-slug
  config → `_all` config → hardcoded defaults). The rewrite is
  idempotent: an anchor whose href already equals the target form is
  left alone. After a save or reset, we trigger a re-walk so existing
  anchors update without waiting for the next React render. This
  benefits right-click "Copy link" and middle-click / Cmd-click
  "Open in new tab", which use the live DOM `href`.
- **Click interception** — Because React's `<Link>` ignores the
  rewritten `href` for plain left-clicks, we attach a capture-phase
  `click` listener on `document`. It runs before React's own
  `onClick`, identifies category-nav anchors (path under `/classes`,
  no `classId`), calls `preventDefault` + `stopPropagation`, and
  hard-navigates with `location.assign(filteredHref)`. Modifier-key
  clicks (`Cmd`/`Ctrl`/`Shift`/`Alt`, middle-click, etc.) are passed
  through untouched so their browser-native semantics ("open in new
  tab/window") still apply — and because of the DOM rewrite above
  they'll still land at the filtered URL.
- **Home-page discipline tiles** — A second capture-phase `click`
  listener checks for `e.target.closest('[data-test-id="fitnessDisciplinePortalCard"]')`,
  reads the tile's `<h1>` text, looks the slug up in
  `DISCIPLINE_SLUGS`, and `location.assign`s the filtered
  `/classes/<slug>` URL. If the label isn't in the map (e.g. a new
  discipline ships), we log the unknown label and let React handle
  the click as usual.
- **Menu commands** — Tampermonkey's `GM_registerMenuCommand` is
  used to expose the three save/reset actions while on a
  `/classes/<slug>` page. The set is re-registered on every
  `urlchange` event so the per-slug command's label tracks the
  current category. Save actions read the live URL query string,
  filter it against `NON_FILTER_PARAMS`, store the remainder under
  the chosen key, and trigger a re-walk of anchors.
- **Logging** — At init we log the loaded config. On save we log the
  captured params, the dropped params, and the resulting full config
  map; on reset we log the prior state. This is the primary
  diagnostic surface for "did my save do what I expected".
- Each click triggers a full page reload to the filtered URL. That's
  slightly slower than Peloton's in-app SPA navigation but matches
  the user-visible latency of a category switch (~1.5s for the
  class-fetch API call) and removes all race-condition fragility.
