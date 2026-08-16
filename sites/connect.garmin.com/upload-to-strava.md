# Garmin Connect → Strava: Upload new activities with one click

## Summary

**Note:** This is more like an experiment or demo than a useful
script, since the same thing can be done by linking Garmin in Strava.

Garmin Connect has no way to send an activity to Strava, so moving
rides across means doing it by hand, one at a time: open the activity,
dig through the More… menu for Export to TCX, wait for the download,
switch to Strava's upload page, find the files, and remember which ones
you already did.

This script adds two buttons to Garmin Connect's top toolbar.
**Activities** just opens the Activities list. **Upload to Strava**
does the whole transfer: it works out which rides you haven't sent yet,
downloads each one as a TCX file, and hands them straight to Strava's
upload page, which starts uploading them.

You can start the same transfer from the other end: Strava's upload
drop-down gets an **Upload from Garmin** item above Upload activity,
which opens Garmin and runs the transfer from there.

It remembers what it has already sent, so a click after a ride sends
exactly that ride. The record is only updated once Strava confirms the
files are attached and uploading — if anything fails part way, nothing
is marked as sent and the next click retries.

### Using it

Click **Upload to Strava** on the Activities list. It opens Strava's
upload page in a background tab and reports progress in a panel at the
top right of both pages.

Expect roughly a second per ride: almost all of it is Garmin's export
endpoint generating and sending several megabytes of XML. Compressing
and handing it to Strava costs well under a tenth of that. The console
logs carry timings for each step if a run ever feels slower than that.

The first click ever asks how many to send rather than assuming, since
at that point every listed ride looks new:

> First upload. The newest N activities will be uploaded to Strava.
> How many should we send? (0–20)
>
> After this, previously uploaded activities will be remembered.

It defaults to 1. Everything older than the number you give is recorded
as already uploaded. The same prompt comes back — with a different first
line — any time none of the listed activities are recognized, which
means either the record was cleared or you've been away long enough for
the whole page to turn over. Cancelling changes nothing.

Two entries in the userscript manager's menu adjust the record:

| Menu command | Effect |
| --- | --- |
| Set how many activities are unsent… | Asks for a number; marks the newest N unsent and everything older as uploaded |
| Forget which activities were sent | Clears the record, so the next upload asks again |

The TCX files are also saved to your downloads folder as
`activity_<id>.tcx`, the same names Garmin gives them. Chrome asks once
whether to allow a run of several downloads from the site.

If either site turns out to be signed out, the transfer stops at once
rather than timing out, and you're left looking at the sign-in page you
need, with a notice on it saying what to do next. Nothing is recorded as
uploaded, so you can pick up where you left off after signing in.

## Visible changes

* Two text buttons in the top header bar, just right of the nav-toggle
  arrow: **Activities**, then **Upload to Strava**.
* **Activities** navigates to the Activities list.
* **Upload to Strava**, from the Activities list, opens Strava's upload
  page in a background tab, saves each new ride as `activity_<id>.tcx`,
  and attaches them to Strava's upload form, which begins uploading.
  From any other page it just navigates to the Activities list.
* An orange **New** badge appears on the Activities list, on the second
  line just after the activity type, on every activity that hasn't been
  uploaded to Strava yet — so the list itself shows what the next click
  will send. Hovering explains what it means. The badges update as soon
  as an upload finishes, or when either menu command changes the
  history. Nothing is badged before the first upload, when there's no
  history to compare against.
* An **Upload from Garmin** item appears at the top of Strava's upload
  drop-down, above Upload activity. It opens Garmin's Activities list in
  a foreground tab and runs the transfer there.
* All three added controls carry a tooltip describing what they do.
* A status panel in the top right of **both** tabs reports what's
  happening for the whole transfer, rewriting itself as it goes rather
  than flashing a message and vanishing — which ride is downloading,
  compressing or sending on the Garmin side, and what the Strava side
  is downloading and how many files it has. It turns green when the
  upload starts and clears itself after ten seconds; red on failure,
  and stays until clicked.
* Short one-off notices still appear for things that aren't part of a
  running transfer — "No new activities to send", and the like.
* A prompt asks how many of the newest activities to send, on the first
  upload and any time none of the listed activities are recognized.
* Two userscript-manager menu commands adjust which activities count as
  already uploaded.

## Implementation

### Layout

One script, matched on both `https://connect.garmin.com/*` and
`https://www.strava.com/*`, branching on `location.hostname` at the
bottom of the IIFE. It has to be one script rather than two, because GM
storage is scoped per script and that storage is the only channel that
crosses the origin boundary — see "Talking across the two pages" below.

Both matches are whole sites rather than the specific sections we care
about (`/app/*`, `/upload/*`), with the path checked inside the script.
That's deliberate: it's the only way to be running on the sign-in page
when either site turns out to be signed out — see "Signed-out
detection" below.

### Starting from Strava

Strava's global nav holds the upload drop-down, in plain
server-rendered markup with no framework:

```html
<li class="nav-item drop-down-menu upload-menu enabled">
  <a class="nav-link selection" href="/upload">…</a>
  <ul class="options">
    <li><a href="/upload">…Upload activity</a></li>
    …
```

We prepend our own `<li>` to `ul.options`, reusing the
`icon-upload-activity` span class so the label lines up with its
neighbours instead of sitting flush left, and giving the link a `title`
(Strava's own items have none, but ours is the one that needs
explaining). A `MutationObserver` re-adds it if Strava re-renders the
nav; a fixed `id` keeps that idempotent — which also means an edit to
the tooltip only shows up after a page reload, not on a re-insert.

The item's href is
`https://connect.garmin.com/app/activities#upload-from-garmin`, but the
click handler cancels the navigation and uses `GM_openInTab(…,
{active: true})` instead, so the Strava page survives and the Garmin tab
is in the **foreground**. Foreground matters: the first-run `prompt()`
and every notice would be invisible in a background tab.

The clicked tab then sends *itself* to `/upload/select`, so the files
come back to the tab you started in rather than a third one. Nothing
passes a tab id around — there's no userscript API that could address a
tab anyway. Instead the tab volunteers, and the claim decides:

* Any Strava upload tab with no batch in flight registers a
  `GM_addValueChangeListener` on `handoff` and waits. An open upload tab
  is a standing offer to be the consumer. That listener is registered
  **only** on `/upload/*` — a Strava tab on any other page never claims
  and is never navigated anywhere.
* When a batch starts, tabs race to write `claim`. GM storage has no
  compare-and-swap — `GM_setValue` is an unconditional last-write-wins
  overwrite — so a bare read-then-write lets two tabs both see no claim
  and both proceed, which would upload the same ride twice. Instead each
  writes optimistically, waits `CLAIM_SETTLE_MS` (600 ms, comfortably
  over the 150 ms write debounce plus the round trip), then re-reads:
  both converge on the same stored value, so exactly one sees its own id
  and continues while the loser stands down.
* The Garmin side runs `ensureConsumer()` alongside the first fetch: it
  waits for a claim, and only opens an upload tab of its own if none
  arrives. The grace period is 2.5 s normally — an already-open tab
  needs one storage round-trip — and 25 s when the run came from Strava,
  since that tab is still loading the upload page.

The fallback keeps this robust when the volunteer never turns up (tab
closed, navigation failed, signed out), at the cost of a redundant tab
in that case only. Both branches are verified: with no claimer the
Garmin side logs `no upload tab claimed the batch within 2500ms;
opening one` and opens it; with a claimer it logs `an open Strava upload
tab claimed the batch; not opening one` and opens nothing.

One consequence worth knowing: clicking the item from a non-upload
Strava page navigates that tab away to the upload page. If the transfer
then fails, you've lost whatever page you were on.

On the Garmin side, `initGarmin` sees the hash and runs the same
`startUpload()` the button calls, after `waitForStableList()` — the
list streams in a row at a time, and diffing against a half-rendered
page would call older rides new. The hash is cleared with
`history.replaceState` first, so a reload doesn't silently start another
transfer.

### The buttons

Garmin Connect is a React SPA under `/app/*`. The top header bar's
CSS-module class names look like `TopHeaderBarView_*__<hash>`, and the
trailing hash changes every build, so we match by **prefix** with
attribute selectors (`[class*="TopHeaderBarView_navToggle"]`).

* A nav-toggle button matching `button[class*="TopHeaderBarView_navToggle"]`
  exists on every `/app/*` page. Its parent is a flex container, and we
  insert Activities as the sibling immediately after the toggle, then
  Upload to Strava after that.
* The toolbar is torn down and rebuilt as the SPA navigates. A
  `MutationObserver` on `document.body` re-adds the buttons if they
  disappear; idempotency comes from fixed `id`s.
* Both buttons copy their `className` at insertion time from any
  existing "secondary medium" Garmin button on the page (e.g. "Edit
  Home" on `/app/home`), so they match the live Garmin look without
  hardcoding build-hashed suffixes. At script-start time the toolbar
  holds only iconButton/primary variants, so the observer *upgrades*
  the className once a secondary button renders. There's an inline
  style fallback if no reference button ever appears.

### The "New" badges

Each row of the Activities list is `[class*="ActivityListItem_listItem"]`,
and its second line is:

```html
<div class="ActivityListItem_activityType__ryV+v">
  <button class="ActivityListItem_activityTypeButton__meQOp">Mountain Biking</button>
</div>
```

We match that line with `[class*="ActivityListItem_activityType__"]` —
the trailing `__` before the build hash is what stops it also matching
`activityTypeButton` — and append the badge after the button.

One layout wrinkle: the type **button** is `display: flex`, so it fills
the line and an inline sibling drops to a row of its own underneath. We
set the containing line to `display: flex; align-items: center` when
inserting, which puts the badge alongside and shrinks the button to its
content width (visually identical, since its content was already only
~83px of a 388px line).

`refreshNewBadges()` is idempotent — it adds and removes only where a
row disagrees with the stored history — so it's safe to call as often
as we like. It's driven from:

* a debounced hook on the existing `MutationObserver`, since the list
  streams in a row at a time and our own insertions re-trigger it;
* `recordSeen()` and `keepNewestUnsent()`, the only two places the
  history is written, so a finished upload or either menu command
  refreshes the list immediately;
* the "Forget which activities were sent" command.

With no history at all (`loadSeen()` returns `null`), nothing is badged:
every row would qualify, and twenty badges convey nothing.

### Where the time goes

Measured on two real rides, in a logged-in Garmin tab:

| Phase | 5.5 MB ride | 7.0 MB ride |
| --- | --- | --- |
| `fetch` the TCX from Garmin | 979 ms | 1219 ms |
| gzip | 88 ms | 75 ms |
| base64 | 5 ms | 4 ms |
| Strava-side decode back to a `File` | 52 ms | 66 ms |

So the export endpoint is essentially the whole cost, and our own
encoding is noise. Nothing in the transfer polls — every wait is a
`GM_addValueChangeListener` — but the handshake is chatty, and the
userscript manager debounces storage writes (150 ms in SourceMonkey),
so each hop adds a beat: `file` → `fileTaken` per activity, then
`done` → `ack`, six hops for a two-ride batch.

The transfer is deliberately sequential — the next activity isn't
fetched until Strava acknowledges the last — which keeps exactly one
payload in storage at a time, at the cost of not overlapping the ~1 s
fetch with the ~0.3 s handshake. Pipelining is the obvious speed-up if
it ever matters.

Every phase is timed in the logs (`fetched activity … in 1.2s`,
`waited 1.4s for Garmin`, `… after 3.1s total`), so a slow run can be
attributed without re-measuring.

An earlier version also opened a background tab per new ride, for
eyeballing them. That's been removed: it's off-topic for what the
script does now, and those tabs each load a full activity page with
maps and charts, competing for bandwidth and CPU with the very fetch
the transfer is waiting on.

### Getting the TCX bytes

Reading the activity list is easy: every row links to
`/app/activity/<id>`, and that href is the only stable thing about the
row markup.

Garmin's own "Export to TCX" menu item fetches

```
GET /gc-api/download-service/export/tcx/activity/<id>
```

and that endpoint is usable from *any* Garmin page, for any activity
ID — no per-activity tab is needed to download it. It needs two
headers, and answers `401` with an empty body if either is missing:

| Header | Where we get it |
| --- | --- |
| `Connect-Csrf-Token` | `<meta name="csrf-token" content="…">`, present on every server-rendered page |
| `X-app-ver` | the `?bust=<version>` query on the page's own `<link>`/`<script>` asset URLs |

Cookies do the actual authentication. A long-open SPA tab can outlive
its session, at which point *every* `gc-api` call 401s, including
harmless ones — so a 401 isn't a sign the token is wrong. We re-request
`/app/activities` (which refreshes the cookies) and retry once; if that
still fails the batch aborts and asks the user to reload.

Each downloaded blob is saved to disk by clicking a hidden
`<a download="activity_<id>.tcx">` on an object URL.

### Why there's a transfer at all

The obvious simpler design is for the Strava page to fetch the TCX
itself, and skip the handoff entirely. It can't, today:

* **Direct `fetch` is impossible.** Garmin sends no `Access-Control-*`
  headers on the export endpoint and answers a CORS preflight with
  `403`. Verified from a real Strava page — plain, credentialed, and
  with the required headers all fail with `TypeError: Failed to fetch`
  before the request leaves the browser.
* **`GM_xmlhttpRequest` would sidestep CORS** — the extension's service
  worker makes the request, so the page's same-origin policy doesn't
  apply, and the cookie never leaves the browser's jar — **but
  SourceMonkey doesn't send cookies** (`src/gm-xhr.ts` builds its
  `RequestInit` without `credentials`, which defaults to `same-origin`
  against the extension's own origin). Garmin answers `401`. Filed as
  SourceMonkey issue #20.
* **Strava can't ingest a URL.** Its upload form is `multipart/form-data`
  to `/upload/files`, and the public API's `POST /uploads` is multipart
  too. There's no URL to hand it, and the URL would be useless without
  the cookies and CSRF token anyway.

If #20 lands, the Strava side could scrape the CSRF token from a Garmin
page and pull each TCX directly, and everything below — gzip, base64,
the six-hop handshake, the storage budget, the staleness sweep, the
dependency on cross-tab broadcasts — could go. Worth doing as a
simplification rather than for speed: the current flow measures fast
enough in practice.

### Talking across the two pages

The Strava upload page can't read the TCX files from the downloads
folder — no page can — and it can't fetch them from Garmin either,
because that's cross-origin and wouldn't carry Garmin's cookies. So the
Garmin page has to push the bytes to it.

GM storage is shared across every tab running this script, on either
origin, and SourceMonkey implements `GM_addValueChangeListener` with
the standard `(key, oldValue, newValue, remote)` signature, firing with
`remote = true` when another tab writes. That gives both a transport
and a completion signal. The keys:

> **Requires a userscript manager with reliable cross-tab value
> broadcasts.** The whole handoff rides on `GM_addValueChangeListener`
> firing in the other tab. Early SourceMonkey builds dropped those
> broadcasts whenever the extension's service worker had been evicted
> and respawned, and a tab that missed one could never re-sync, because
> `GM_getValue` reads a page-local cache with no round-trip to the
> extension. That made transfers fail intermittently at whichever hop
> happened to be crossed — see SourceMonkey issue #19. If this script
> starts stalling mid-transfer again, check that first: the log will
> stop cleanly at one of the four hops below, with the value sitting in
> the manager's storage, unread.

| Key | Written by | Meaning |
| --- | --- | --- |
| `seenActivityIds` | Garmin | activity IDs already sent (`null` = never run) |
| `handoff` | Garmin | `{batchId, ids, count, state, ts}`; `state` goes `sending` → `done` |
| `claim` | Strava | which upload tab took the batch, so two don't both consume it |
| `file` | Garmin | one file at a time: `{batchId, id, name, seq, gz}` |
| `fileTaken` | Strava | receipt for `file`, freeing the slot |
| `ack` | Strava | the files are attached and uploading |
| `failure` | Strava | this batch can't be taken, and why |
| `signinHint` | Garmin | a note to show on the sign-in page it's about to open |

`chrome.storage.local` is capped at 10 MB for the whole extension and
SourceMonkey doesn't ask for `unlimitedStorage`, while a TCX for a long
ride runs to several MB. Two things keep us well inside that:

* Abandoned batches are swept at init. A run that dies without
  rejecting — tab closed, navigated away — never reaches
  `clearBatchKeys()`, and `HANDOFF_STALE_MS` only stops us *reading* a
  stale batch, it deletes nothing. Without the sweep, each abandoned run
  leaves ~425 KB parked in storage permanently.
* Payloads are gzipped (`CompressionStream`) and base64'd. Measured on
  a real ride: 6.5 MB of TCX → 366 KB gzipped → 488 KB of base64,
  about 13× smaller. The Strava side inflates it with
  `DecompressionStream` and the round trip is byte-identical.
* Only **one** file is in storage at a time. Garmin writes `file`, then
  blocks until Strava deletes it and posts `fileTaken` before fetching
  the next.

The exchange, in order:

1. Garmin clears the batch keys and writes `handoff` as `sending`. In
   parallel, `ensureConsumer()` waits for a claim and opens an upload tab
   only if none arrives.
2. Per activity: fetch → save to disk → gzip → write `file` → wait for
   `fileTaken`.
3. Garmin sets `handoff.state = 'done'`.
4. Strava, having collected `count` files, waits for `done`, attaches
   them, and writes `ack`.
5. Garmin sees `ack` and only then adds the IDs to `seenActivityIds`.

Every wait is a `waitForValue(key, predicate, timeout)` that checks the
current value *before* listening, so a write that lands while the
Strava tab is still loading isn't missed. Waits time out after 90 s, and
a timeout aborts without touching `seenActivityIds`, so the next click
retries.

### Signed-out detection

By far the most likely failure at either end is not being signed in, and
a timeout is a slow and unhelpful way to learn that. Both sites redirect
signed-out visitors, and in both cases the redirect stays on the same
origin, so a whole-site `@match` puts us on the sign-in page where we
can say something:

| | Signed-out redirect |
| --- | --- |
| Strava | `/upload/select` → `/login` |
| Garmin | `/app/activities` → `/signin/?service=…` |

**Strava.** On a non-upload Strava page the script looks for a batch in
`sending` state that started within the last 60 seconds — recent enough
that the tab we opened is the obvious explanation — **and** a
login/signup/onboarding path. Only a sign-in page is real evidence the
upload tab bounced; any other Strava page is far more likely to be the
user browsing in a different tab while a transfer runs, and killing
their batch over that would be a false positive. Both conditions met, it
writes `failure` with `Strava isn't signed in`.

On the Garmin side, `failureWatcher(batchId)` is a promise that rejects
as soon as that key appears and otherwise never settles. Every wait is
raced against it, so the batch fails immediately with the specific
reason instead of after 90 seconds.

**Garmin.** The `#upload-from-garmin` fragment survives the 302 —
browsers carry a fragment onto a redirect target that has none of its
own, which is verified behavior here, not just spec-reading — so the
sign-in page can tell it was our navigation that landed there rather
than an ordinary visit, and shows a notice instead of failing silently.

### Status and where errors surface

Two `position: fixed` panels in the top right, both also logged with
the `[garmin-dl]` prefix:

* `setStatus(msg, {done, error})` owns a **single** element with a
  fixed id, rewritten in place as the transfer advances. Both sides use
  it, so whichever tab you're looking at says what's going on. The
  Strava tab is the reason it exists: it spends most of a minute
  waiting on Garmin to fetch and compress, and before this it showed an
  empty upload page the whole time, then flashed one message just as it
  finished. `done` turns it green and clears after 10 s; `error` turns
  it red and leaves it until clicked.
* `toast(msg, ms)` is still used for one-off notices outside a running
  transfer ("No new activities to send"). `toast(msg, 0)` never
  auto-dismisses — a six-second toast in a tab the user hasn't switched
  to is a message nobody reads.

Getting the user in front of the right page takes some care, because
**a background tab cannot pull itself to the front**: `window.focus()`
from a hidden tab is silently ignored (confirmed by driving two tabs
over CDP and watching `document.visibilityState` refuse to change). So
the bounced upload tab can't present itself, and there's no API for one
tab to focus another.

What we do instead, per direction:

* **Garmin signed out** — the tab we opened is already in the
  foreground, showing Garmin's sign-in page. Nothing to move; we just
  add the notice.
* **Strava signed out** — the bounced upload tab is in the background,
  so the Garmin side opens `strava.com/login` as a *new foreground* tab.
  Before opening it, it writes `signinHint` to GM storage; the script
  instance on that new page reads the hint (within 60 s), deletes it,
  and shows it as a persistent notice. That's what puts the explanation
  — "Sign in to Strava, then click Upload to Strava on the Garmin tab
  to send N activities" — in the tab the user is actually looking at.
  The already-bounced background tab is left alone rather than closed.

### Attaching to Strava

The upload page's form is plain and unreactish:

```html
<form action="/upload/files" enctype="multipart/form-data" method="POST">
  <input class="files" multiple name="files[]" type="file">
</form>
```

`window.Dropzone` is loaded on the page but isn't bound to this
element. Uploading starts on the input's `change` event, so building a
`DataTransfer`, assigning `input.files`, and dispatching `change` is
the whole submit — there's no button to click afterwards. (Verified by
stubbing out `XMLHttpRequest.prototype.send` and watching the injected
change event trigger the upload requests.)

### What we assume stays stable

* `button[class*="TopHeaderBarView_navToggle"]` exists on `/app/*`.
* Activity rows link to `/app/activity/<id>`.
* Strava's upload drop-down is `li.upload-menu ul.options`, with
  `<li><a>` items.
* Activity rows are `[class*="ActivityListItem_listItem"]`, each with a
  type line at `[class*="ActivityListItem_activityType__"]`.
* Signed-out redirects stay on the same origin: Strava to `/login`,
  Garmin to `/signin/`.
* `<meta name="csrf-token">` and a `?bust=<version>` asset URL are in
  the server-rendered page.
* `/gc-api/download-service/export/tcx/activity/<id>` serves TCX to a
  cookie-authenticated request carrying those two headers.
* Strava's upload page has
  `form[action*="/upload/files"] input[type="file"][name="files[]"]`
  and starts uploading on `change`.

### Testing

`upload-to-strava.spec.js` covers the Garmin buttons and the
Strava menu item. It injects `test/gm-stubs.js` before the script,
because the fixture runs the raw body with no userscript manager and
this script reads GM storage as soon as it starts.

Those stubs get the script running; they are not coverage of the
transfer. The store they provide is same-page and instant, so it models
neither the manager's write debounce nor — the part that matters here —
delivery to another tab. The handoff, the claim protocol and the badges'
response to a completed upload are verified by hand in a browser with
the real manager, reading the `[garmin-dl]` logs in both tabs.
