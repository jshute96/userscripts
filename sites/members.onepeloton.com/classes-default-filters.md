# Peloton Classes: Default filters

## Summary

Rewrites Peloton's category-tab links (`/classes/strength`,
`/classes/yoga`, `/classes/stretching`, …) so that clicking any of
them lands on the target category with default filters preset:
Difficulty = Intermediate + Advanced, plus the Taken/Not-Taken switch
set to "Not Taken". No filter dialog is opened or inspected — the
filters are encoded directly in the URL query string Peloton already
honours on page load.

## Visible changes

- Clicking any category tab navigates to e.g.
  `/classes/yoga?difficulty_level=["intermediate","advanced"]&has_workout=["false"]`,
  with the corresponding filters already active when the page renders.
- The dialog is never auto-opened — the page just lands filtered.
- Right-clicking → "Copy link" / "Open in new tab" / middle-click also
  produces a filtered URL, because the DOM `href` is rewritten in
  addition to clicks being intercepted.
- Visiting bare `/classes/<category>` directly (typing the URL,
  bookmark, external link) is left alone — only navigation *via the
  in-page category tabs* gets filters applied automatically.
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

### What we assume stays stable

- Filter values are encoded as URL query params with the JSON-array
  format Peloton currently uses.
- Category tabs are anchor elements with paths matching
  `/classes` or `/classes/<slug>`.
- Class-detail anchors continue to be identifiable by the presence of
  a `classId=` parameter.

### How we modify the page

- **DOM `href` rewrite** — On script init, and on every `document.body`
  mutation (coalesced to one pass per animation frame), we walk
  `a[href^="/classes"]` and replace each anchor's `href` with one
  that carries our two filter params. The rewrite is idempotent: an
  anchor whose href already has both params is skipped. This benefits
  right-click "Copy link" and middle-click / Cmd-click "Open in new
  tab", which use the live DOM `href`.
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
- Each click triggers a full page reload to the filtered URL. That's
  slightly slower than Peloton's in-app SPA navigation but matches
  the user-visible latency of a category switch (~1.5s for the
  class-fetch API call) and removes all race-condition fragility.
