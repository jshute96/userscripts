# Garmin Connect → Strava: Upload new activities with one click

## Summary

This script adds one-click buttons to upload all new rides from
Garmin Connect to Strava.

On Garmin, there's an `Activities` button to jump directly to that page,
and an `Upload to Strava` button that triggers the upload (from any page).

On Strava, under the Plus menu, just above `Upload activity`, there's a
new `Upload from Garmin` item that triggers the upload.

On the Garmin activities page, new rides (not yet uploaded) are highlighted
with a `NEW` badge. Those are the ones that will be uploaded.

On an activity page, the gear menu gets an `Upload to Strava`
item at the top, which uploads just that ride.

The script only looks at the first page of activities (the newest 20).
On the first run, and from the userscript manager's menu, you can reset
the `NEW` state for the newest N rides.

### Alternative: Strava's Garmin connector

**Note:** Strava can link to Garmin directly and auto-upload every new
ride, so strictly speaking this script isn't necessary. It's partly an
experiment in complex cross-site userscript flows.

It does fit my workflow better, though. I like to add ride titles, set
which bike I used, and sometimes change visibility — and Strava's
auto-upload always uses the defaults. Editing rides after the fact, one
by one, is more annoying than making the same edits on an upload page I
triggered myself.

## Visible changes

* Two text buttons in Garmin's top header bar, just right of the
  nav-toggle arrow: **Activities**, then **Upload to Strava**.
* **Activities** navigates to the Activities list.
* **Upload to Strava** downloads every ride that hasn't been sent yet
  and attaches them to Strava's upload form, opening a background Strava
  upload tab only if one isn't already open. It works from any Garmin
  `/app/` page, not just the Activities list.
* An orange **New** badge appears on the Activities list, on the second
  line just after the activity type, on any of the **newest 20**
  activities that hasn't been uploaded to Strava yet — so the list
  itself shows what the next click will send. The list is
  infinite-scroll, and rows scrolled in past the newest 20 are never
  badged: they're outside what an upload looks at, so marking them New
  would promise a send that isn't going to happen. Hovering explains what it means. The badges update as soon
  as an upload finishes — including one run entirely on the Strava side
  — and when either of the history commands changes it. Nothing is badged
  before the first upload, when there's no history to compare against.
* An **Upload to Strava** item appears at the top of the gear (More…)
  menu on a single activity's page, above a separator matching Garmin's
  own. It sends that one activity regardless of its New state, and
  records it as sent like any other upload.
* The Strava upload tab comes to the front when a run starts from
  Garmin, whether it's newly opened or an existing one being reused.
* An **Upload from Garmin** item appears at the top of Strava's upload
  drop-down, above Upload activity. It sends the current tab to the
  upload page and runs the whole upload there. No Garmin tab is opened.
* All three added controls carry a tooltip describing what they do.
* A status panel in the top right reports what's happening for the whole
  run, rewriting itself as it goes rather than flashing a message and
  vanishing — which ride is downloading, and how far along the run is.
  It turns green when the upload starts and clears itself after ten
  seconds; red on failure, and stays until clicked. When the run is
  started from Garmin, both tabs show it.
* Short one-off notices still appear for things that aren't part of a
  running upload — the menu commands' confirmations, and the like.
* A prompt asks how many of the newest activities to send, on the first
  upload and any time none of the listed activities are recognized.
* Three userscript-manager menu commands, on Garmin Connect pages only:
  two that adjust which activities count as already uploaded, and one
  that diagnoses a failing run.

## Implementation

### Layout

One script, matched on both `https://connect.garmin.com/*` and
`https://www.strava.com/*`, branching on `location.hostname` at the
bottom of the IIFE. It has to be one script rather than two, because GM
storage is scoped per script and that storage is the only channel that
crosses the origin boundary.

Both matches are whole sites rather than the specific sections we care
about (`/app/*`, `/upload/*`), with the path checked inside the script.
That's deliberate: it's the only way to be running on a Strava sign-in
page when Strava turns out to be signed out — see "Signed-out detection"
below — and it puts the Strava menu item in the nav on every page.

### Talking to Garmin's API

Three requests are the entire Garmin side of the feature, and they run
identically from either origin, because they go out through
`GM_xmlhttpRequest` — issued by the extension rather than by the page.
That sidesteps CORS (see below). `@connect connect.garmin.com` is
required.

| Request | Purpose |
| --- | --- |
| `GET /app/activities` | 8 KB server-rendered shell; scrape `<meta name="csrf-token">` and `?bust=<version>` |
| `GET /gc-api/activitylist-service/activities/search/activities?limit=20&start=0` | JSON list, newest first, with `activityId` and `activityName` |
| `GET /gc-api/download-service/export/tcx/activity/<id>` | the TCX, `application/vnd.garmin.tcx+xml` — the same endpoint Garmin's own "Export to TCX" menu item uses |

#### The two gates on `gc-api`

Both `gc-api` calls are guarded twice, by two different parties, and a
request needs to satisfy both. Measured directly, with the same session
and token, varying one header at a time:

| Headers sent | Result |
| --- | --- |
| neither | 403 |
| `Connect-Csrf-Token` only | 403 |
| `Sec-Fetch-Site: same-origin` only | 403 |
| both | **200** |

* **`Connect-Csrf-Token`** is Garmin's. It's a per-session value in the
  page's `<meta name="csrf-token">`; a wrong one answers 403 as well.
  We fetch it fresh at the start of every run, so a long-open tab can't
  be holding a stale one. Cookies do the actual authentication — a
  request with none answers **401**, which is how you tell the two
  failures apart.
* **`Sec-Fetch-Site: same-origin`** is Cloudflare's, and it is not
  Garmin's app at all. The 403 comes back with an empty body and **no
  `cf-cache-status` header** — where a 200 carries
  `cf-cache-status: DYNAMIC` — so the request is refused at the edge and
  never reaches Garmin. A service worker's `fetch` always sends
  `Sec-Fetch-Site: none`, a value no page can produce, so every call
  fails without the override. `/app/activities` isn't covered by the
  rule, which is why the session fetch works unaided and made this look
  for a long time like an authentication problem.

`Sec-` headers are *forbidden request headers*: `fetch()` strips them
for everybody, in a service worker exactly as on a page. So this only
works on a manager that routes them around `fetch` — SourceMonkey
compiles them into a `declarativeNetRequest` rule (its issue #21), and
deliberately doesn't default them, since stamping `same-origin` on every
request would silently defeat this kind of cross-origin check
everywhere. A script has to ask.

`X-app-ver` (from the `bust=` query) is **not** checked by anything, but
Garmin's own client always sends it and we have the value for free.

If a run fails with `HTTP 403`, the **Diagnose Garmin API access** menu
command runs that table live. `csrfAndSameOrigin` returning 200 while
`csrfOnly` returns 403 is the healthy shape; both failing means the
`Sec-Fetch-Site` override isn't reaching the wire, which is a manager
problem rather than a script one. The report also compares the CSRF
token the extension fetches against the one in the tab's own `<meta>` —
they should be identical, since the token is session-bound and stable,
and a mismatch would mean the extension's requests are in a different
session. (That line only means something on a Garmin page; Strava has an
unrelated `csrf-token` meta of its own.)

Ruled out by measurement, and *not* what a 403 here means: a missing or
wrong `Referer`, an `Origin: chrome-extension://…`, missing `sec-ch-ua`
client hints, a malformed or absent `X-app-ver`, a token with trailing
whitespace, and a differently-cased header name. Every one of those
still returns 200.

#### Ordering, and rides that arrive out of order

**Detection is by identity, not position.** `chooseActivities()` is a
set difference — `listed.filter(a => !seen.has(a.id))` — so where an
activity sits in the list has no bearing on whether it's recognized as
new. A ride that appears in the middle of the list is picked up exactly
like one at the top. (The `.reverse()` afterwards is only about the
order files reach Strava, so they land oldest-first.)

That matters because the list **is not in upload order**. Measured: the
API sorts by activity *start* time descending — `sortBy=startLocal`
returns byte-identical output to the default — and the response carries
no upload or created timestamp at all, only `startTimeLocal`,
`startTimeGMT`, `beginTimestamp` and `endTimeGMT`. So a ride that syncs
late (a watch left un-synced for a week, a manual file import, a device
that backfills) appears at its *chronological* position, part-way down,
not at the top. Detection handles that.

**The window is the real limit.** `LIST_LIMIT` is 20, matching what
Garmin's own Activities page shows, which keeps "what has a New badge"
and "what an upload would send" the same set on the first screen. But
the window is applied by the server, *before* we see anything — so a
late-syncing ride whose start time puts it beyond position 20 is
invisible to the script, and no amount of client-side sorting can
recover it. Raising `LIST_LIMIT` is the only lever; the response is
small (a few KB per activity), so a larger window is cheap if late
syncs by more than ~20 rides ever become a real case.

One related wrinkle: `keepNewestUnsent()` — the first-run prompt and the
"how many are unsent" menu command — slices positionally, so its
"newest N" means newest *by start time*, which for an out-of-order sync
isn't the same as the most recently added. That only affects those two
starting-point commands, never ordinary detection.

#### Why `GM_xmlhttpRequest` and not `fetch`

A plain `fetch` to Garmin from a Strava page is impossible: Garmin sends
no `Access-Control-*` headers on any of these endpoints and answers a
CORS preflight with `403`. Verified from a real Strava page — plain,
credentialed, and with the required headers all fail with
`TypeError: Failed to fetch` before the request leaves the browser.

Version 0.2 worked around that by fetching on the Garmin side and
shipping the bytes to the Strava tab through GM storage — which meant
gzip + base64 to fit `chrome.storage.local`'s 10 MB extension-wide
budget, a six-hop per-file handshake with one payload in flight at a
time, staleness sweeping for abandoned batches, and a hard dependency on
cross-tab value broadcasts.

Two SourceMonkey gaps had to close before this version could exist, and
each was found the hard way, by the endpoint failing:

* **Issue #20 — no cookies.** `GM_xmlhttpRequest` built its
  `RequestInit` without `credentials`, so every request went out
  anonymous and Garmin answered 401. Now
  `credentials: request.anonymous ? 'omit' : 'include'`, matching
  Tampermonkey and Violentmonkey.
* **Issue #21 — no way to set `Sec-Fetch-*`.** Cookies alone still left
  every `gc-api` call answering 403 at Cloudflare's edge. Forbidden
  headers now travel as a `declarativeNetRequest` session rule instead
  of through `fetch`.

With both, this version deletes about 200 lines of protocol, replaced by
three requests either side can make.

Strava still can't ingest a URL — its upload form is
`multipart/form-data` to `/upload/files`, and the public API's
`POST /uploads` is multipart too — so the bytes do have to pass through
the browser. They just no longer pass through storage.

### Who does what

The files have to be attached to a form that only exists on Strava's
upload page, so the download always happens **in a Strava upload tab**.
The only question is who picks the list.

* **Started on Strava.** The menu item sends the tab to
  `/upload/select#upload-from-garmin`; on arrival the script clears the
  hash (so a reload doesn't start another run) and does everything
  there — session, list, diff, downloads, attach. Nothing is written to
  GM storage except the updated history. No Garmin tab is involved.
* **Started on Garmin.** The Garmin tab fetches the list and does the
  diff and any prompt itself, so the prompt lands in the tab the user is
  looking at. It then writes a `request` — *just* the ids and names —
  and a Strava upload tab does the fetching.

The cross-tab half is therefore only a short JSON list, and only in one
of the two directions.

### Finding a Strava upload tab

Nothing passes a tab id around — there's no userscript API that could
address a tab anyway. Instead tabs volunteer, and a claim decides:

* Any Strava tab **on `/upload/*`** registers a
  `GM_addValueChangeListener` on `request` and waits. That's a standing
  offer, per-request rather than latched, so a tab left on the page keeps
  serving runs for as long as it's open. A Strava tab on any other page
  never claims and is never navigated anywhere.
* Tabs race to write `claim`. GM storage has no compare-and-swap —
  `GM_setValue` is an unconditional last-write-wins overwrite — so a bare
  read-then-write lets two tabs both see no claim and both proceed, which
  would upload the same ride twice. Instead each writes optimistically,
  waits `CLAIM_SETTLE_MS` (600 ms, comfortably over the 150 ms write
  debounce plus the round trip), then re-reads: both converge on the same
  stored value, so exactly one sees its own id and continues while the
  loser stands down.
* The Garmin side runs `ensureConsumer()` alongside its wait: it gives a
  claim 2.5 s to appear — an already-open tab needs one storage
  round-trip — and only opens an upload tab of its own if none does.

Either way the upload tab ends up in front, by two different mechanisms.
A tab we open ourselves is created with `active: true`. A tab we *reuse*
raises itself: the tab that wins the claim calls `window.focus()`, under
`@grant window.focus`, which selects the tab and raises its window.

Both matter because that tab is where the status panel is, where the
upload lands, and where you edit titles and click save. Watching that
happen in a background tab is no use.

Raising has to be done by the claiming tab, not by the Garmin side:
`window.focus` only ever raises its own caller, and the claiming tab is
the one that knows it's about to do the work. Without the grant — a
manager that doesn't implement it — the call is the page's own
`window.focus`, which is a silent no-op for a background tab, so this
degrades to "the tab doesn't come forward" rather than throwing.

Reuse happens in exactly one situation: a Strava tab already sitting on
`/upload/*` when the request is written. Any other Strava tab — the
dashboard, an activity, a segment — never claims and is never navigated
anywhere. And a run started from Strava's own menu item never involves
this at all: that tab navigates itself, so it's already the focused one.

### The storage keys

| Key | Written by | Meaning |
| --- | --- | --- |
| `seenActivityIds` | whoever finishes a run | activity IDs already sent (`null` = never run) |
| `request` | Garmin | `{requestId, activities: [{id, name}], ts}` |
| `claim` | Strava | which upload tab took the request |
| `progress` | Strava | `{requestId, done, total}`, so the Garmin tab's panel can follow along |
| `result` | Strava | `{requestId, ok, count, error}` — the outcome |
| `signinHint` | either | a note to show on the sign-in page it's about to open |

`request` is retired by both sides when a run finishes — the initiating
tab in a `finally`, and the serving tab as it writes the result — so a
run whose initiator was closed still doesn't leave one parked for the
next upload tab to pick up.

Every wait is a `waitForValue(key, predicate, timeout)` that checks the
current value *before* listening, so a write that lands while the Strava
tab is still loading isn't missed. Nothing polls.

The Garmin tab's wait for `result` is 10 minutes — purely a backstop
against a tab closed mid-run, since the panel is driven by `progress`
and a slow-but-alive run still looks alive. Requests older than 15
minutes are ignored, and swept from storage when a Garmin page next
starts, so an abandoned one can't be picked up later.

`seenActivityIds` is written by whichever side attached the files, which
is usually the Strava tab. The Garmin side keeps its "New" badges in step
by listening for changes to that key rather than to the run.

> **Requires a userscript manager with reliable cross-tab value
> broadcasts** for the Garmin-initiated path. Early SourceMonkey builds
> dropped those broadcasts whenever the extension's service worker had
> been evicted and respawned, and a tab that missed one could never
> re-sync, because `GM_getValue` reads a page-local cache with no
> round-trip to the extension — SourceMonkey issue #19, since fixed. If
> a Garmin-initiated run ever stalls again, check that first; the
> Strava-initiated path doesn't depend on it at all.

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

The href is the upload page with the trigger fragment, and the click
handler cancels the navigation only to do the same thing itself (or to
start the run in place, if you were already on the upload page).

One consequence worth knowing: clicking the item from another Strava
page navigates that tab away to the upload page. If the run then fails,
you've lost whatever page you were on.

### The activity page's gear menu

The gear menu's markup, captured with it open:

```html
<div class="ActivitySettingsMenu_menuContainer__giAbC">
  <div class="Menu_menuWrapper__a-liz">
    <button class="Menu_menuBtn__nELvF">…</button>       <!-- the gear -->
    <div class="Menu_menuItemWrapper__X00xZ">            <!-- only while open -->
      <div class="Menu_menuItems__eNgH5 ">Compare</div>
      …
      <div class="Menu_divider__J1hP1"></div>            <!-- between groups -->
```

We prepend a `Menu_menuItems` div and a `Menu_divider` div to that
wrapper, copying both classNames off existing siblings rather than
hardcoding the build-hashed suffixes — which also means our separator
tracks whatever Garmin's look like. Verified against the live page: same
computed font, padding, color and height as a native item, and a
separator indistinguishable from the two Garmin already draws.

The wrapper only exists while the menu is open, and is rebuilt on each
open, so insertion is driven from the same `MutationObserver` as the
toolbar buttons rather than done once at startup. It bails at the first
missing piece, so a closed menu costs one failed `querySelector`.

There's a **second, independent trigger**: a capture-phase click listener
that re-runs the insert on a few short timers (0/60/200/500 ms) after a
click inside the gear container. The observer alone turned out not to be
reliable — whether its callback lands before or after React has finished
building the menu depends on how the render batches, and if it lands
early the menu is then fully rendered with *no further mutation to retry
on*, so the item silently never appears. Reproduced with trusted input
(`Input.dispatchMouseEvent`): first open after load, no item; with the
click trigger, it appears every time. `ensureActivityMenuItem` is
idempotent, so the extra passes are no-ops.

Two things the item has to do that a native one gets for free:

* **Close the menu.** React doesn't know the item exists, so it won't
  close on click. Toggling the gear button does it.
* **Read the activity at click time**, not at insert time — `location`
  can have moved to another activity while a stale menu node is around.

Clicking goes straight to `dispatchToStrava([activity])`, skipping the
list fetch and the diff entirely: sending something already sent is the
point of the item, not a mistake to guard against. It still lands in the
history afterwards, because the Strava side records whatever it actually
attached, without caring where the list came from.

There's no spec for this. Driving it needs a real activity page, and the
URL of one is account data we keep out of the repo.

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
`activityTypeButton` — and append the badge after the button. Row ids
come from the `/app/activity/<id>` link in the row, the only stable
thing about the row markup. (The badges are the one place we still read
the list out of the DOM; everything else uses the API.)

One layout wrinkle: the type **button** is `display: flex`, so it fills
the line and an inline sibling drops to a row of its own underneath. We
set the containing line to `display: flex; align-items: center` when
inserting, which puts the badge alongside and shrinks the button to its
content width (visually identical, since its content was already only
~83px of a 388px line).

Two things decide whether a row is badged: its id being absent from the
history, **and** its position being inside the window. The second is not
optional. The page is infinite-scroll rather than paged, so scrolling
appends rows indefinitely, and rows old enough predate anything the
script ever recorded. Measured on a real list scrolled to 180 rows: the
id check alone would badge 163 of them, against the 3 that an upload
would actually send. Position works as the window because rows arrive
newest-first, in the same order as the API.

`refreshNewBadges()` is idempotent — it adds and removes only where a
row disagrees with the stored history — so it's safe to call as often
as we like. It's driven from:

* a debounced hook on the existing `MutationObserver`, since the list
  streams in a row at a time and our own insertions re-trigger it;
* a `GM_addValueChangeListener` on `seenActivityIds`, which covers both
  a local change and an upload that ran in a Strava tab;
* `recordSeen()` and `keepNewestUnsent()`, so a local change doesn't
  wait on the broadcast round-trip.

With no history at all (`loadSeen()` returns `null`), nothing is badged:
every row would qualify, and twenty badges convey nothing.

### Where the time goes

Measured on two real rides: the export endpoint takes 979 ms for a
5.5 MB ride and 1219 ms for a 7.0 MB one, and that is essentially the
whole cost of a run. The list and session requests are one small round
trip each, and attaching the files is instant.

Version 0.2's gzip/base64/handshake apparatus added roughly 150 ms per
ride plus a storage round-trip per hop; removing it is worth more as a
simplification than as a speed-up.

`GM_xmlhttpRequest` does move each TCX through the service worker as
base64 (the manager's binary transport, ~33% overhead on the wire
between SW and page, against a 50 MB response cap). No measurable
difference so far on a 5.7 MB file, but it's the thing to look at first
if large rides ever feel slow.

Every phase is timed in the logs (`downloaded activity … in 1.2s`,
`… for the whole run`), so a slow run can be attributed without
re-measuring.

### Signed-out detection

By far the most likely failure at either end is not being signed in, and
a timeout is a slow and unhelpful way to learn that.

**Garmin** is now checked directly, at the start of every run, from
whichever side started it: the `GET /app/activities` that fetches the
CSRF token 302s to `/signin/?service=…` when signed out, and the
response carries no `csrf-token` meta. Either signal is enough. The
error carries a `signedOutOf` marker, and `reportFailure()` opens
Garmin's sign-in page in a foreground tab with a note on it.

**Strava** can't be probed the same way, because we never fetch Strava —
we *are* Strava. Instead the whole-site `@match` means a bounced upload
tab is still running this script: on a non-upload Strava page it looks
for a request that started within the last 60 seconds — recent enough
that the tab we opened is the obvious explanation — **and** a
login/signup/onboarding path. Only a sign-in page is real evidence the
upload tab bounced; any other Strava page is far more likely to be the
user browsing in a different tab while a run happens, and killing it over
that would be a false positive. Both conditions met, it writes `result`
with `ok: false`, so the Garmin side fails immediately with the specific
reason instead of waiting out its timeout.

### Status and where errors surface

Two `position: fixed` panels in the top right, both also logged with
the `[garmin-dl]` prefix:

* `setStatus(msg, {done, error})` owns a **single** element with a
  fixed id, rewritten in place as the run advances. Both sides use it,
  so whichever tab you're looking at says what's going on. `done` turns
  it green and clears after 10 s; `error` turns it red and leaves it
  until clicked.
* `toast(msg, ms)` is used for one-off notices outside a running upload
  (the menu commands, the sign-in hint). `toast(msg, 0)` never
  auto-dismisses — a six-second toast in a tab the user hasn't switched
  to is a message nobody reads.

Getting the user in front of the right page takes some care, because
**a background tab cannot pull itself to the front**: `window.focus()`
from a hidden tab is silently ignored (confirmed by driving two tabs
over CDP and watching `document.visibilityState` refuse to change). So a
bounced upload tab can't present itself, and there's no API for one tab
to focus another.

`reportFailure()` handles both directions the same way: it writes
`signinHint` to GM storage, then opens the relevant sign-in page as a
*new foreground* tab. The script instance on that new page reads the
hint (within 60 s), deletes it, and shows it as a persistent notice —
which is what puts the explanation in the tab the user is actually
looking at. Any already-bounced background tab is left alone rather than
closed.

Two things that have to hold for that, and both were briefly broken:

* **The hint is read outside the `/app/*` gate.** The page we open is
  `/signin/`, so reading it inside the gate means the note never appears
  on the one page it exists for.
* **Only the initiating tab escalates.** A Strava tab serving a request
  from the Garmin button passes `escalate: false`: it shows the status
  and reports the failure back over `result`, and the tab the user
  actually clicked in opens the sign-in page. Otherwise one lapsed
  session opens one tab per tab involved.

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
* Activity rows are `[class*="ActivityListItem_listItem"]`, each with a
  type line at `[class*="ActivityListItem_activityType__"]` and a link
  to `/app/activity/<id>`.
* Strava's upload drop-down is `li.upload-menu ul.options`, with
  `<li><a>` items.
* Signed-out redirects stay on the same origin: Strava to `/login`,
  Garmin to `/signin/`.
* `<meta name="csrf-token">` and a `?bust=<version>` asset URL are in
  the server-rendered `/app/activities`.
* `/gc-api/activitylist-service/activities/search/activities` and
  `/gc-api/download-service/export/tcx/activity/<id>` serve a
  cookie-authenticated request carrying `Connect-Csrf-Token` and
  `Sec-Fetch-Site: same-origin`.
* Strava's upload page has
  `form[action*="/upload/files"] input[type="file"][name="files[]"]`
  and starts uploading on `change`.
* The userscript manager sends cookies with `GM_xmlhttpRequest`, and
  can put a forbidden `Sec-` header on the wire. Tampermonkey and
  Violentmonkey have both; SourceMonkey since the fixes for its issues
  #20 and #21. Without the second, everything under `gc-api` fails and
  nothing else does.

### Testing

`upload-to-strava.spec.js` covers the Garmin buttons, the Strava menu
item, and that the menu item sends its own tab to the upload page. It
injects `test/gm-stubs.js` before the script, because the fixture runs
the raw body with no userscript manager and this script reads GM storage
as soon as it starts.

Nothing past the click is covered. Every request goes through
`GM_xmlhttpRequest`, and a fake for that would be a fake of the entire
feature — the interesting behavior is exactly the part the manager
provides. Runs are verified by hand in a browser with the real manager,
reading the `[garmin-dl]` logs.
