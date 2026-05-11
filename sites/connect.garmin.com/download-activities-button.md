# Garmin Connect: Download activities button

## Summary

Adds a "Download activities" button to the top toolbar of Garmin Connect's
web app. Clicking it jumps the current page to the Activities list and
opens Strava's "upload activity" page in a background tab — the two
pages you almost always want open together when moving recent rides
from a Garmin device into Strava.

## Visible changes

* A small "Download activities" text button appears in the top header
  bar, immediately to the right of the nav-toggle arrow icon.
* Clicking it:
  - opens `https://www.strava.com/upload/select` in a new background
    tab (does not steal focus), and
  - navigates the current tab to `https://connect.garmin.com/app/activities`.

## Implementation

The Garmin Connect web app is a React SPA at `https://connect.garmin.com/app/*`.
The top header bar is rendered by a component whose CSS-module class
names look like `TopHeaderBarView_*__<hash>` — the trailing hash
changes every build, so we match by **prefix** with attribute
selectors (`[class*="TopHeaderBarView_navToggle"]`).

What we depend on:

* A nav-toggle button matching `button[class*="TopHeaderBarView_navToggle"]`
  exists somewhere in the DOM on every `/app/*` page. Its parent is a
  flex container (`TopHeaderBarView_headerControls__*`) — we insert
  our button as the sibling immediately after the toggle.
* The toolbar may be torn down and rebuilt as the SPA navigates
  between routes. A `MutationObserver` on `document.body` re-adds our
  button if it disappears.
* Idempotency is handled by giving our button a fixed `id`
  (`jshute-garmin-download-activities-btn`) and checking for it
  before inserting.

The button copies its `className` at insertion time from any existing
"secondary medium" Garmin button on the page (e.g. the "Edit Home"
button on `/app/home`). That gives it the live Garmin look without
us hardcoding the build-hashed CSS-module suffixes (which rotate
every deploy). If no reference button exists on the current page, we
fall back to a hand-coded inline style approximating Garmin's
secondary-button look.

Click behaviour:

* The Strava tab is opened **first**, while we still have the click's
  user-activation context (otherwise the browser may block it).
* `GM_openInTab(url, { active: false, setParent: true })` is used
  when available — that's the only way to reliably get a true
  background tab. As a fallback (e.g. when the script is injected
  manually for testing), we simulate a Ctrl/Cmd-click on a temporary
  anchor, which Chrome and Firefox both treat as "open in background
  tab".
* Then we `window.location.assign('/app/activities')` to navigate the
  current tab.
