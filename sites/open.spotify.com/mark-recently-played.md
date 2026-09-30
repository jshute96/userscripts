# Spotify: Mark recently played tracks, from last.fm history

## Summary

When you come back to a playlist you were partway through, Spotify
doesn't show which tracks you've already heard. If you scrobble to
[last.fm](https://www.last.fm/), your history there knows.

This script reads your last.fm listening history for the past 7 days
and marks each Spotify track you played in that time with a green
bar and tint. Hovering over a marked track shows how long ago you played
it. It works on playlists, albums, and any other Spotify track list.

Only tracks recorded to last.fm history are marked. Tracks you skipped
partway through may not record as played.

### Setup

Log in to last.fm in the same browser. The script finds your last.fm
username from there the first time it runs, and remembers it. If you
switch last.fm accounts, use the script's **Reset last.fm user** menu
item to pick up the new one.

## Visible changes

- Tracks played on last.fm in the past 7 days get a green bar on the
  left and a light green tint.
- A tooltip on each marked track says how long ago it was played.

## Implementation

### last.fm

- The header's second `@match`, `https://www.last.fm/` (the home page
  only), is there so the userscript manager shows last.fm's icon and a
  link to it beside Spotify's. The script exits on any host but
  Spotify.
- **Username:** fetched once from `https://www.last.fm/` (with the
  browser's cookies), from the logged-in header's
  `a.auth-link[href^="/user/"]`, then stored as GM value `lastfmUser`.
  The menu item `Reset last.fm user (<name>)`, shown while one is
  stored, deletes it and refetches, reading the name again.
  If there's no stored username and the header shows no login, the
  script logs it and marks nothing, retrying after the refetch interval.
  Once the username is stored, logging out of last.fm doesn't matter
  for a public history: play times fall back to the row tooltips. For a
  private history, a logged-out library page shows the profile's Top
  Tracks instead, in the same `tr.chartlist-row` markup but with no
  play times. Rows without a time are never counted, and a first page
  with none is logged as an error.
- **History:** `https://www.last.fm/user/<user>/library?page=N`, 50
  scrobbles per page, newest first. Pages are fetched in order until a
  scrobble is older than 7 days (a rolling 7x24 hours), capped at 15
  pages. If a later page fails to load, the plays from the pages
  before it are kept; a failure on page 1 is an error.
- Per row, `tr.chartlist-row`:
  - Title and artist are the `title` attributes of
    `.chartlist-name a` and `.chartlist-artist a` (untruncated).
  - Play time is the unix timestamp in the row's edit form,
    `input[name="timestamp"]`, only present when viewing your own
    library while logged in. Fallback: the tooltip on
    `.chartlist-timestamp span[title]`, like
    `Friday 25 Sep 2026, 11:23pm`.
- Problems (no login, no visible scrobbles, failed pages, no plays in
  the window) are logged with `GM_log`, so they appear in the
  manager's log for the script as well as the page console.
- The history is refetched on SPA navigation (`urlchange`) and when
  the tab becomes visible, if it's more than 5 minutes old.

### Spotify

- Track rows are `[data-testid="tracklist-row"]`. The title is the
  text of `[data-testid="internal-track-link"]`, and the artists are
  the `a[href^="/artist/"]` links in the row. Visible truncation is
  CSS only; the text is complete.
- The list is virtualized: only rows near the viewport exist, and
  React reuses them as you scroll. A `MutationObserver` (childList and
  characterData, not attributes) re-evaluates every row from its
  current content and toggles the `data-recent-plays` attribute and
  the `title` tooltip. It's an attribute, not a class, because React
  rewrites the row's `class` when selection changes, dropping ours.
- Three tints: plain, brighter on hover, and brightest on the selected
  row (its parent `[role="row"]` has `aria-selected="true"`), which
  replaces Spotify's grey selection color.
- The green bar is a `::before` on the row, positioned 8px to its
  left, in the list's padding. Inside the row it overlapped three-digit
  track numbers.

### Matching

Both sides are normalized: lowercased, accents stripped, a trailing
` - ...` suffix (`- Remastered`, `- Audiotree Version`) and any
`(...)` or `[...]` removed, and punctuation collapsed. A row matches
when its title plus any of its artists matches a last.fm title plus
artist. last.fm lists only the first artist for multi-artist tracks.

### What we assume stays stable

- last.fm: `a.auth-link[href^="/user/"]`, `tr.chartlist-row`,
  `.chartlist-name a[title]`, `.chartlist-artist a[title]`,
  `input[name="timestamp"]`, the library URL and `page` parameter.
- Spotify: `data-testid` values `tracklist-row` and
  `internal-track-link`, and `/artist/` links in the row.
