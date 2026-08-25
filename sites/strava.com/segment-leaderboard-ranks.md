# Strava: Show multiple rank summaries on segment leaderboard pane

## Summary

Expanding a segment on an activity page shows a Top 10 leaderboard with your
all-time rank above it — `83/733`. The dropdown offers other views (This Year,
My Results, Men, Women, and so on), but each one replaces the table, so seeing
where you stand on a second dimension means clicking through and losing the
first.

This adds a stack of ranks beside the all-time one, filled in from the same data
Strava's dropdown fetches: **All-time**, **This Year**, **This Month** and **My
Results**, all at once. Clicking a row switches the table below to that view, and
the dropdown follows along, so the panel doubles as a shortcut for the views you
look at most.

**This Month** and **This Week** are views Strava's dropdown doesn't offer at
all, even though its own leaderboard endpoint supports them. The script adds both
to the dropdown, below This Year, and they work exactly like the built-in options.
This Week is selectable there but isn't added in the summary panel.

It also fixes a gap in the My Results view. Strava reports no rank there at all
— it shows `–/9` — because every row in that table is you, so its usual "this
row is the viewer" rule has nothing to distinguish. The rank that *is* useful
there is where the current ride's effort sits among your own attempts, and that
is what the panel shows — and what it fills into Strava's own `–` display, so
the two agree. When that effort is among the rows on screen, its row is
highlighted the same bold way your name is highlighted in the other views.

## Visible changes

* A stack of `label` / `rank/total` rows appears to the right of the "Your PR"
  block, above the Top 10 table: All-time, This Year, This Month and My Results.
* **This Month** and **This Week** are added to the leaderboard dropdown, below
  This Year, and switch the table like any built-in view. This Week is
  dropdown-only — selectable, but with no row in the panel.
* Rows are clickable and switch the table below, keeping the dropdown in sync.
  The row matching the current view is shaded.
* In the My Results view, Strava's own `–` rank is replaced with the current
  ride's rank among your own efforts, and that effort's row is bold when it is
  one of the rows on screen.
* A dimension you have no effort in shows `–` for the rank, and the total still
  reports how many efforts exist.

## Implementation

### The endpoint

Everything comes from the endpoint Strava's own dropdown uses:

```
GET /segments/<segment_id>/leaderboard?page=1&per_page=10&viewer_context=true&filter=…
```

Same-origin JSON, session cookies, no CSRF token, so a plain `fetch` from page
context is enough — hence `@grant none`. Useful response fields:

| Field | Meaning |
|---|---|
| `viewer_rank` | Your rank in this view. **Absent** for `filter=my_results`, and absent in any view where you have no qualifying effort. |
| `top_results_count` | The denominator. |
| `top_results[]` | The rows, each with `id` (segment effort id), `rank`, `athlete_id`, `display_name`, `elapsed_time`, `start_date_local`, `activity_id`. |
| `filter`, `gender`, `date_range` | The parameters echoed back. |

`filter` and `date_range` are independent parameters. Strava only ever sends
`date_range=this_year` (paired with `filter=current_year`), but the server also
accepts `today`, `this_week` and `this_month`, and they can be combined with any
`filter`. Adding one of those to `DIMENSIONS` is a one-line change.

**An unrecognized `date_range` is silently ignored** — the response comes back
as an ordinary all-time leaderboard rather than an error, so a typo would show
plausible but wrong numbers. `ranksFor` guards against that by comparing the
echoed `date_range` against what it asked for and treating a mismatch as a
failure.

### Where each number comes from

* **This Year** — `viewer_rank` / `top_results_count` straight from the response.
* **My Results** — the response has no `viewer_rank`, so the rank is the `rank`
  field of whichever returned row is the current activity's effort. The
  denominator is `top_results_count`, which is how many times you have ridden the
  segment.

Finding that row means the row has to be in the response, so My Results pages
through until it is. `per_page` is capped at 100 server-side — ask for 1000 and
it silently echoes 100 — so the search starts with the 10 the table itself shows
(the cheapest request, ~300ms) and escalates to pages of 100 (~1s each) only when
the effort isn't there. `MAX_PAGES` stops it at 500 efforts, after which the rank
shows as `–`. Paging is sequential rather than parallel, so the common
"found on the next page" case costs one extra request rather than `MAX_PAGES` of
them.

This is not a rare path. A regularly-ridden commute segment can carry hundreds of
your own efforts — 368 on one measured here, with the current ride at rank 153,
found on the second page of 100.

**Ranks tie**, and the tie makes positions and ranks diverge: six efforts sharing
a time all report `rank: 6`, so an effort with rank 6 can sit at row 12 and be
absent from a ten-row response. That is why the search matches on effort id and
reads the row's own `rank`, rather than assuming a low rank means an early row.

The current effort's id comes from `location.pathname`: expanding a segment
pushState()s `/activities/<activity>/segments/<effort>`. The segment id comes
from the "View full leaderboard" link (`/segments/<id>?filter=…`), which is the
only place it appears in the leaderboard's own markup. Both avoid parsing the
page's inline `pageView.segmentEfforts()` JSON, which is the other place this
data lives.

### Driving the table

Clicking a panel row calls `.click()` on the matching dropdown option —
`[data-filter=…]` for a built-in view, `[data-jshute-key=…]` for an injected one.
Strava binds that handler with jQuery delegation on the leaderboard root, so a
native click reaches it even though the dropdown is closed, and everything
downstream is its own code path.

For built-in views that also settles the dropdown label for free: `render()`
looks up the response's `filter` among the options and copies that option's text
into `.selection .filter-js`. Injected views are the exception — they borrow
`filter=current_year`, so Strava names them "This Year" and the label has to be
corrected afterwards. See "Extending Strava's dropdown" below.

### What we assume stays stable

* `.segment-leaderboard` wraps one expanded segment's leaderboard, containing
  `.pr-comparison` (the "Your PR" header row), `.drop-down-menu .clickable`
  options carrying `data-filter`, `.selection .filter-js` (the dropdown label),
  and `.leaderboard-footer a[href*="/segments/"]`.
* `.pr-comparison` is a `.row` whose children are left-floated `.spans-half`
  blocks. On your own activity it holds a single one, leaving the right half
  free, which is where the panel goes as a second `.spans-half`.
* `tr.current-athlete` is the class that renders a leaderboard row bold.
* `.rank` is the class Strava puts on its own `N /M` block, with the number in a
  `<strong>`. The panel reuses both rather than restyling a lookalike, so the
  ranks match by construction — including the space before the slash (whitespace
  inside Strava's `<strong>`) and the fact that `.rank strong` is weight 400
  against the container's 300, so it reads darker rather than bolder.
* `.segment-effort-detail` is the expanded detail's `position: absolute`,
  `overflow: hidden` wrapper, sized by an inline `height` in pixels, with a
  matching inline `padding-bottom` on every cell of the segment row.
* The Athlete and Date columns are the same table, swapped via
  `th/td.results-col-js` and `th/td.my-results-col-js`. A hidden Athlete column
  is how the script recognizes the My Results view.
* Row links point at `/segment_efforts/<effort_id>`, which is how the current
  activity's row is found.

### Extending Strava's dropdown

`filter` and `date_range` are independent, and the server accepts `today`,
`this_week`, `this_month` and `this_year` — but Strava's UI only ever sends
`this_year`. Its click handler is a `switch` over `data-filter` values whose
`current_year` case hard-codes `date_range: 'this_year'`, and that switch lives
in a closure inside a bundle, so there is no case to add. The options list is
also rebuilt from a template on every render, so an option added to the DOM
can't carry behavior of its own.

Rather than reimplementing the table, the script lets Strava handle the entire
click — request, re-render, column swap, dropdown label — and substitutes the one
query parameter it doesn't know to send, inside the model's own `sync`:

1. `patchLeaderboardSync` wraps `Strava.Models.SegmentLeaderboard.prototype.sync`,
   overriding `options.data.date_range` when a range is pending.
2. Injected options carry `data-filter="current_year"` — so Strava's switch takes
   its normal path — plus a `data-jshute-key` naming the range we want.
3. A capture-phase click listener on the document sets the pending range before
   Strava's own delegated handler runs, and clears it immediately after the
   request so a stale range can't ride along on an unrelated fetch.

Everything downstream is Strava's code path, unchanged.

The pending range is tagged with the segment whose dropdown was clicked, and the
`sync` wrapper applies it only to a request whose URL names that segment. With
two segments expanded, an unrelated `sync` firing in between would otherwise
consume it, and the injected view would render This Year's rows under a "This
Month" label — the same silently-wrong outcome the design refuses elsewhere.
For the same reason the wrapper also wraps `options.success` and compares the
response's echoed `date_range` against what it asked for, logging a mismatch:
a range the server drops comes back as an ordinary all-time leaderboard rather
than an error, so the echoed parameter is the only evidence the table on screen
is the view that was selected.

The panel list and the dropdown list are independent: `inPanel: false` puts a
view in the dropdown without giving it a row. That also means it is never
prefetched, since a row is what costs a request per segment expanded. This Week
is configured that way.

Two consequences worth knowing:

* **This needs page-context access.** `@grant none` runs the script in the
  page's own world, which is what makes `window.Strava` reachable. If the patch
  fails, `canExtendDropdown` stays false and the options are *not* injected — a
  "This Month" that quietly showed This Year would be worse than not offering
  it. The rest of the panel still works. `sweep` retries the patch, since
  Strava's bundles may not have run at `document-idle`.
* **The dropdown label needs correcting.** Strava rebuilds it by looking up the
  first option matching the response's `filter`, and both injected views report
  back as `current_year` — so both would read "This Year". `correctFilterLabel`
  sets it from the remembered key, which is also what `markActiveRow` uses in
  preference to the label text.

### Rate limiting

The endpoint meters access, and the throttle is worth understanding before
adding rows to `DIMENSIONS`, because each row is another request per segment.

A 126-request benchmark tripped it, and it stayed tripped for **at least 24
hours**. What it covers, measured while blocked:

| Request | Result |
|---|---|
| `/dashboard`, `/athletes/…`, `/activities/…` | 200 |
| `/segments/<id>/leaderboard`, any segment | 429 |
| `/segments/<id>` — the segment page itself | 429 |
| The same pages in a logged-out incognito window | 429 |

So it covers the whole segment namespace rather than just the XHR endpoint —
while blocked, Strava's own segment pages fail too — and **a fresh session does
not escape it**. The 429 is served by the origin (`server: istio-envoy`) as the
"Oops! There seems to be a problem" page, with no `Retry-After`.

Don't take that scope as settled beyond what the table says. A same-origin
`credentials: 'omit'` request did return 200 while everything else 429'd, which
looks like account-scoped metering — but it was sent from the same browser and
the same IP with only the cookies dropped, so it never tested the IP dimension,
and the incognito result points the other way. What is certain is the part that
matters: the block is wide, it is long, and nothing available here reliably
routes around it. Measure the throttle only if you are prepared to lose the
account's segment access for a day.

Three consequences:

* **Failed lookups are never cached.** A cached rejection would leave a segment
  permanently blank rather than retrying on the next render.
* **But a 429 opens a cooldown** (`RATE_LIMIT_COOLDOWN_MS`). Without one, "don't
  cache failures" would mean every re-render fires another burst into a throttle
  that may well extend itself.
* Adding a dimension costs a request per segment expanded, which matters more
  than the latency of any single request.

### Filling in Strava's own rank

In the My Results view Strava has no rank to print, so its template renders an
en dash. `fillInViewerRank` replaces just the `<strong>` holding that dash,
leaving the `" /N"` text node Strava rendered, so what results is Strava's own
markup with a number in it. The replacement text keeps whitespace around the
number, because that is where the space before the slash comes from.

Nothing needs undoing: a filter change rebuilds the whole subtree from the
server's response, taking the override with it. On someone else's activity the
`.pr-comparison` holds two blocks — theirs first, yours second — and only the
last one is touched.

### Fitting into the space Strava reserved

The expanded detail is absolutely positioned inside `.segment-effort-detail`,
which has `overflow: hidden` and an inline pixel `height` that Strava measures
**once**, when it renders the detail. Every cell of the segment's row gets the
same value as an inline `padding-bottom`, reserving the space in the table.

Anything added afterwards is silently clipped. So the panel has to occupy the
right half without making `.pr-comparison` any taller than Strava's own left
half (36px — an avatar beside two lines of text). Two rows of 18px line-height
hit that exactly, which is why the panel is plain `<div>`s rather than a
`<table>`: Strava's global `table { margin: 20px 0 }` and its own cell padding
both beat anything scoped to the panel, and between them added 57px, which is
what pushed the "View full leaderboard" button out of the clipped region.

`fitDetail` is the backstop for when that isn't enough — a third or fourth
dimension, a wrapped label, a larger font. It compares the content's height
against the reserved height and raises the inline `height` and the cells'
`padding-bottom` to match. It only ever grows, and ignores a 1px shortfall (a
sub-pixel measurement Strava rounds differently), so it converges instead of
fighting Strava's value on every render.

### Aligning the numbers

The panel is a single CSS grid of four columns — label, rank, slash, total — and
each row is a `<div>` set to `display: contents`, so the row still carries the
click handler, the active class and the dimension key while its cells sit
directly in the grid and share its columns.

It was a flex box per row to begin with, and that is what a row-at-a-time layout
costs: every row sized itself, so its numbers landed wherever its own text
happened to end. A segment with `2963 /31357` on one row and `27 /53` on another
put them in visibly different places, and because the lookups resolve
independently the arrangement shifted again as each one landed.

Sharing one grid gives all four rows the same columns. Rank and total are each
right-aligned in a column as wide as the widest number in it, so both edges line
up, and the slash between them is a column of its own so it lines up too:

```
All-time   2963 / 31357
This Year   298 /  2449
This Month   62 /   352
My Results   27 /    53
```

The slash cell carries equal padding on both sides, which is what makes the gap
symmetric — Strava's own markup writes a space before the slash and nothing
after. Every cell keeps Strava's `.rank` class so each part renders at the weight
it has in Strava's markup.

### Re-rendering

Changing the filter makes Strava's `SegmentLeaderboardView.render()` replace the
entire `.segment-leaderboard` subtree — the panel included. So a debounced
`MutationObserver` on `document.body` re-runs the whole sweep, re-inserting the
panel, re-marking the active row, and re-applying the highlight. It is
idempotent: insertion is skipped when a `.jshute-rank-panel` is already present,
so the observer's own mutations don't loop.

Fetches are cached per segment and dimension, so a re-render repaints from cache
rather than refetching. Requests only happen once a segment is expanded, which
keeps this to two per segment looked at rather than one per segment on the page.
