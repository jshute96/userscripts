# My userscripts repository

These are some of my userscripts.
Scripts are arranged by target site under [sites/](sites/).

For background, the [awesome-userscripts](https://github.com/awesome-scripts/awesome-userscripts#tutorials) list has good tutorials,
and [Greasy Fork](https://greasyfork.org/) hosts thousands of existing scripts to browse and install.

Some of my scripts are generally useful and are
[published on Greasy Fork here](https://greasyfork.org/en/users/1604620-jeff-shute).
Some are just my personal tweaks or preferred defaults that probably don't make sense for others.

My scripts here were mainly developed using Claude Code.  I'm working on an optimized setup for agentic development for userscripts.  See below.

My modest ambition: **Fix the internet.**  Every broken or annoying website I use, I can fix it.  Every time I wish a site had some missing feature, I can add it.  Claude Code makes this possible now, with the right tools and workflow around it.

## My userscripts

All scripts have a `doc`, describing what it does and how it works in more detail.
<br>
Scripts uploaded to Greasy Fork have a `GF` link.

### Miscellaneous

<!-- update_readme.py category=default -->
| Script | Doc | GF | Description |
| --- | --- | --- | --- |
| [Google Calendar: Highlight matching meeting rooms](sites/calendar.google.com/highlight-local-rooms.user.js) | [doc](sites/calendar.google.com/highlight-local-rooms.md) | [GF](https://greasyfork.org/scripts/591535-google-calendar-highlight-matching-meeting-rooms) | Highlights meeting locations matching a regex you configure, so your own building stands out in a long room list. Also formats the room list one room per line. |
| [NOAA CNRFC: Default precipitation map view (Bay Area, 24-hour)](sites/cnrfc.noaa.gov/precip-default-view.user.js) | [doc](sites/cnrfc.noaa.gov/precip-default-view.md) |  | Opens NOAA's map zoomed to the SF Bay Area with 24-hour precipitation selected by default (avoiding several navigation clicks to get there). |
| [Garmin Connect: One-click TCX download](sites/connect.garmin.com/activity-tcx-download.user.js) | [doc](sites/connect.garmin.com/activity-tcx-download.md) |  | Adds a Download button to the activity page toolbar that exports the activity as a TCX file in one click, instead of three clicks inside the More… menu. |
| [Garmin Connect: Improve UI in MTB Dynamics jumps view](sites/connect.garmin.com/mtb-jumps-map-link.user.js) | [doc](sites/connect.garmin.com/mtb-jumps-map-link.md) | [GF](https://greasyfork.org/scripts/591536-garmin-connect-improve-ui-in-mtb-dynamics-jumps-view) | Colors jumps by size, links jumps on the map to rows in the jumps table, and adds filtering by minimum jump size. Find the large jumps easily! |
| [Garmin Connect → Strava: Upload new activities with one click](sites/connect.garmin.com/upload-to-strava.user.js) | [doc](sites/connect.garmin.com/upload-to-strava.md) |  | Adds an Upload to Strava button to Garmin's toolbar and an Upload from Garmin item to Strava's upload menu. Either sends all new rides you haven't uploaded yet. |
| [Feedly: Scroll Index page to top](sites/feedly.com/scroll-index-to-top.user.js) | [doc](sites/feedly.com/scroll-index-to-top.md) | [GF](https://greasyfork.org/scripts/591537-feedly-scroll-index-page-to-top) | Fixes the Index page landing part-way down: navigating to it (e.g. with G-then-I) now opens scrolled to the top, as expected. |
| [Feedly: Add Oldest/Newest buttons for single-click order toggle](sites/feedly.com/sort-filter-presets.user.js) | [doc](sites/feedly.com/sort-filter-presets.md) | [GF](https://greasyfork.org/scripts/591538-feedly-add-oldest-newest-buttons-for-single-click-order-toggle) | Adds Oldest and Newest buttons to a feed's toolbar, applying sort order and unread-only filters in one click instead of four. |
| [Greasy Fork: Fill post/update/import forms from URL parameters](sites/greasyfork.org/prefill-forms-from-hash.user.js) | [doc](sites/greasyfork.org/prefill-forms-from-hash.md) |  | Fills Greasy Fork's new script, new version, and import script forms from URL parameters, so they can be opened pre-filled. |
| [Peloton: Default filters on class lists](sites/members.onepeloton.com/classes-default-filters.user.js) | [doc](sites/members.onepeloton.com/classes-default-filters.md) | [GF](https://greasyfork.org/scripts/591539-peloton-default-filters-on-class-lists) | Applies your preferred filters on class lists by default, so browsing starts from a useful view. Defaults are configurable per class type from the script menu. |
| [Peloton Player: Fix bad video overlay on tall screens](sites/members.onepeloton.com/fix-bad-video-overlay.user.js) | [doc](sites/members.onepeloton.com/fix-bad-video-overlay.md) | [GF](https://greasyfork.org/scripts/590890-peloton-player-fix-bad-video-overlay-on-tall-screens) | Fixes a bug in Peloton's video player where, on large monitors, a fixed-size overlay is added over the video, creating an ugly horizontal seam. |
| [Peloton Player: Keep the Now-Playing song visible](sites/members.onepeloton.com/keep-now-playing.user.js) | [doc](sites/members.onepeloton.com/keep-now-playing.md) | [GF](https://greasyfork.org/scripts/590887-peloton-player-keep-the-now-playing-song-visible) | Stops the class player auto-hiding its Now-Playing widget, so the current song is always readable. |
| [NYTimes Spelling Bee: Word definitions and other tweaks](sites/nytimes.com/spelling-bee.user.js) | [doc](sites/nytimes.com/spelling-bee.md) | [GF](https://greasyfork.org/scripts/591403-nyt-spelling-bee-word-definitions-and-other-tweaks) | Shows definitions when you hover or click a word, adds a toolbar link to Spelling Bee Buddy, and closes the splash screens for you. |
| [Pinkbike: Keyboard navigation for article photos](sites/pinkbike.com/article-image-navigation.user.js) | [doc](sites/pinkbike.com/article-image-navigation.md) | [GF](https://greasyfork.org/scripts/591540-pinkbike-keyboard-navigation-for-article-photos) | Adds i and Shift-I shortcuts that jump from photo to photo through an article, for nicer viewing in photo-heavy stories. |
| [Pinkbike: Auto-close the sticky footer ad](sites/pinkbike.com/close-sticky-footer-ad.user.js) | [doc](sites/pinkbike.com/close-sticky-footer-ad.md) | [GF](https://greasyfork.org/scripts/591541-pinkbike-auto-close-the-sticky-footer-ad) | Closes the sticky ad banner pinned to the bottom of the page. |
| [Strava: Fix the broken climb filter on segment search](sites/strava.com/fix-climb-slider.user.js) | [doc](sites/strava.com/fix-climb-slider.md) | [GF](https://greasyfork.org/scripts/590960-strava-fix-the-broken-climb-filter-on-segment-search) | Bug fix for broken layout on the segment search page: Strava currently draws it vertically rather than horizontally because of missing CSS. |
| [Strava: Segment search location filter and unpaged view](sites/strava.com/segment-search-location-filter.user.js) | [doc](sites/strava.com/segment-search-location-filter.md) | [GF](https://greasyfork.org/scripts/590976-strava-segment-search-location-filter-and-unpaged-view) | Adds a Location filter box in segment search, and makes search results unpaged. |
| [Strava: Show elevation gain *and loss* for each segment](sites/strava.com/show-elevation-loss.user.js) | [doc](sites/strava.com/show-elevation-loss.md) | [GF](https://greasyfork.org/scripts/590975-strava-show-elevation-gain-and-loss-for-each-segment) | Strava shows climbing but never descending. This adds Elevation Loss next to Elevation Gain on the segment and activity pages. |
| [Strava Upload: One-click defaults for my preferred commute settings](sites/strava.com/upload-commute-preset.user.js) | [doc](sites/strava.com/upload-commute-preset.md) |  | Adds a Set button beside the Commute tag on the upload page that tags the activity as a commute, with my usual bike, and makes it private. |
| [TechCrunch: Auto-close the newsletter popup](sites/techcrunch.com/close-newsletter-popup.user.js) | [doc](sites/techcrunch.com/close-newsletter-popup.md) | [GF](https://greasyfork.org/scripts/591543-techcrunch-auto-close-the-newsletter-popup) | Closes the annoying "TechCrunch in your inbox" newsletter popup as soon as it appears. |
| [The Atlantic Games: Link to today's puzzle](sites/theatlantic.com/games-todays-puzzle-link.user.js) | [doc](sites/theatlantic.com/games-todays-puzzle-link.md) | [GF](https://greasyfork.org/scripts/591544-the-atlantic-games-link-to-today-s-puzzle) | Adds a Today's Puzzle link to the puzzle-completed screen, so you can get to the new puzzle instead of back to the previous one you solved. |

### Keyboard comment navigation

These scripts are all adding keyboard navigation in comments or forum pages,
using the same hotkeys.

<!-- update_readme.py category=keyboard-comments -->
| Script | Doc | GF | Description |
| --- | --- | --- | --- |
| [Hacker News: Keyboard comment navigation](sites/news.ycombinator.com/keyboard-comment-navigation.user.js) | [doc](sites/news.ycombinator.com/keyboard-comment-navigation.md) |  | Adds keyboard shortcuts for moving through a thread by comment, sibling, parent or root, and adds the navigation links HN is missing to each comment. |
| [The Athletic: Keyboard comment navigation](sites/nytimes.com/athletic-keyboard-comment-navigation.user.js) | [doc](sites/nytimes.com/athletic-keyboard-comment-navigation.md) |  | Adds keyboard shortcuts for moving through the comments on an article — next and previous comment, parent, next thread, and jump to the comments section. |
| [NYTimes: Keyboard comment navigation](sites/nytimes.com/keyboard-comment-navigation.user.js) | [doc](sites/nytimes.com/keyboard-comment-navigation.md) |  | Adds keyboard shortcuts for moving through the comments panel on an article — next and previous comment, parent, next thread, and open or jump to the panel. |
| [Pinkbike: Keyboard comment navigation](sites/pinkbike.com/keyboard-comment-navigation.user.js) | [doc](sites/pinkbike.com/keyboard-comment-navigation.md) | [GF](https://greasyfork.org/scripts/591542-pinkbike-keyboard-comment-navigation) | Adds keyboard shortcuts for moving through the comments on an article — next and previous comment, parent, next thread, and jump to the comments section. |
| [Reddit: Keyboard comment navigation](sites/reddit.com/keyboard-comment-navigation.user.js) | [doc](sites/reddit.com/keyboard-comment-navigation.md) |  | Adds keyboard shortcuts for moving through a comment thread by comment, sibling, parent or root, replacing reddit's j/k with navigation that follows the tree. |
| [Washington Post: Keyboard comment navigation](sites/washingtonpost.com/keyboard-comment-navigation.user.js) | [doc](sites/washingtonpost.com/keyboard-comment-navigation.md) |  | Adds keyboard shortcuts for moving through the comments drawer on an article — next and previous comment, and opening or jumping to the top of the drawer. |

### Testing and experimentation

These are fixtures against [example.com](https://example.com/), not scripts
anyone would install. They exercise specific userscript-manager behaviors —
storage, context menus, `@require`, error reporting, update-on-reload — so
those can be tested without depending on a real site. The directory also has
`installed-list.js`, a shared `@require` helper rather than a userscript of
its own ([doc](sites/example.com/installed-list.md)).

<!-- update_readme.py category=examples -->
| Script | Doc | GF | Description |
| --- | --- | --- | --- |
| [example.com: Bold word on hover](sites/example.com/bold-on-hover.user.js) | [doc](sites/example.com/bold-on-hover.md) |  | Test fixture: bolds and reddens the single word under the mouse cursor while hovering over text. |
| [example.com: Config value with context-menu update](sites/example.com/config-value.user.js) | [doc](sites/example.com/config-value.md) |  | Test fixture: adds a "the message_value is: &lt;value&gt;" bullet whose value is set via the userscript context menu and saved in GM storage. |
| [example.com: Error button](sites/example.com/error-button.user.js) | [doc](sites/example.com/error-button.md) |  | Test fixture: adds "Error" buttons that throw when clicked — one from the script body, one from @require'd code. |
| [example.com: Error on load](sites/example.com/error-on-load.user.js) | [doc](sites/example.com/error-on-load.md) |  | Test fixture: throws an unhandled error during initial injection. |
| [example.com: Show GM_info](sites/example.com/show-gm-info.user.js) | [doc](sites/example.com/show-gm-info.md) |  | Test fixture: adds a "Show GM_info" button that prints the GM_info payload under the bullet. |
| [example.com: Updated script](sites/example.com/updated-script.user.js) | [doc](sites/example.com/updated-script.md) |  | Test fixture: bullet text includes a version constant so manual edits to the source file are visible on reload. |

## Development setup and workflow

### Code structure

Scripts are organized by site under `sites/`:
- `sites/<site>/<name>.user.js` - the userscript
- `sites/<site>/<name>.md` - documentation describing what it does and how it works
- `sites/<site>/<name>.spec.js` - (sometimes) a test
- `sites/<site>/screenshots/` - (sometimes) before/after screenshots shown in the documentation

Screenshots are referenced in a script's docs when a picture explains the change
better than prose does.

### My typical workflow

This is what building a new userscript usually looks like.
The referenced tools are described below.

1. Open Claude Code CLI in this directory, and start `/see-what-i-see-watch` so
   Claude watches for new screenshots from the SeeWhatISee Chrome extension.
2. Open the web page I want to fix, and click the SeeWhatISee extension icon to
   take a screenshot.
3. Annotate the screenshot with the drawing tools — boxes or arrows highlighting
   the part I want to change.
4. Enable the "Save HTML" checkbox so it also saves the live page's DOM.
5. Write a prompt explaining what I want the userscript to change, and click
   Capture to send it to Claude.

Claude then does the rest on its own:

- Reads the screenshot, HTML, and prompt, and starts building a userscript,
  following the file layout, documentation, and testing patterns described in
  [CLAUDE.md](CLAUDE.md) and this repo's skills.
- Tests the userscript against the static HTML snapshot, in a real browser via
  Playwright — and optionally against the live page (which may require me to log
  in once in the Playwright browser).
- Optionally writes a test verifying the userscript against the snapshot and/or
  the live page.
- Documents the userscript: what it was trying to do, what the page looked like
  before and after, what it found in the DOM, and any interesting details of how
  it got there.  The documentation and tests make the script easily fixable later,
  if the site changes.
- Registers the userscript in SourceMonkey (or Tampermonkey) and tells me it's
  ready to try.

Then I reload the page and it picks up the new userscript.

To refine or fix anything, now or later: I send more annotated screenshots and
instructions, or just ask in Claude directly.  Claude updates the code, tests
the new behavior, and updates the documentation; I reload and try the site again.

Eventually I'd like to extract `CLAUDE.md` and these skills into a packaged template that's easy to clone when starting a new userscript repo.

### Claude Code

I do most userscript development in Claude Code CLI, with code in GitHub.
This works quite well.

I have instructions in [CLAUDE.md](CLAUDE.md) and some skills mentioned below to drive this workflow.

Other coding agents should also work.  I have done some userscript development in [Antigravity](https://antigravity.google/) using this workflow.

### Userscript reference skills

[Wookstar plugins](https://github.com/henkisdabro/wookstar-claude-plugins) have a good skill with reference material and tips for userscript development.
The skill is called [Tampermonkey](https://github.com/henkisdabro/wookstar-claude-plugins/tree/main/plugins/tampermonkey) but it's actually about userscripts generally, and isn't specific to Tampermonkey.

Install in Claude:
```
/plugin marketplace add henkisdabro/wookstar-claude-plugins
/plugin install tampermonkey@wookstar-claude-plugins
```

### Skills for userscript manager interaction

I have skills for interacting with userscript managers (currently SourceMonkey or Tampermonkey), for workflows like installing or updating scripts.

- [install-in-SourceMonkey](.claude/skills/install-in-SourceMonkey/SKILL.md)
- [install-in-tampermonkey](.claude/skills/install-in-tampermonkey/SKILL.md) — automates the copy-paste flow, putting the script on the clipboard and opening Tampermonkey's script page ready to paste.

### Skills for repeated patterns

Skills can be used to automate building similar userscript features applied across multiple pages.

For example, I wrote a script to add keyboard navigation on one forum site, and then decided I wanted the same keyboard navigation on many other sites.  The [add-comment-navigation-script](.claude/skills/add-comment-navigation-script/SKILL.md) skill describes my desired keyboard actions, and some patterns I found were required for this on different sites.  Now looking at any other forum site, I can ask for a userscript to add my keyboard navigation features, and Claude can usually one-shot a working script from a one-line prompt.

Another example is [add-config-setting](.claude/skills/add-config-setting/SKILL.md), which adds a user-configurable setting to an existing script, stored in the userscript manager's storage and edited from the script's context menu.

The same could apply for other common patterns: adding dark mode, clearing popups, etc.

### SeeWhatISee - Chrome extension screenshot tool

[SeeWhatISee](https://github.com/jshute96/SeeWhatISee) is a Chrome extension that can capture screenshots and HTML (live page DOM).  The bundled Claude skills can watch for new screenshots and then automatically load and process them.

I use this to capture and annotate web pages, add directions on what I want to change, and then send it to Claude, to create or update the userscript code.

Install the [extension from the Chrome web store](https://chromewebstore.google.com/detail/seewhatisee/mdfeigicgahogllcdiibkeidfllhddae).
Install the Claude skills with
```
/plugin marketplace add jshute96/SeeWhatISee-claude
/plugin install see-what-i-see@see-what-i-see-marketplace
```

### SourceMonkey - My userscript manager

I tried various other userscript managers, but didn't find one that supported this workflow with external dev tools and Claude Code as smoothly as I wanted.

So I've been experimenting with building my own, optimized for this development workflow: [SourceMonkey](https://github.com/jshute96/SourceMonkey).

In SourceMonkey, the userscript manager's job is read-only script hosting, injection into web pages,
and other script management and debugging.  The userscript manager inside Chrome *is not an editing or development environment*.
Scripts under development live on local disk, and are developed using standard coding tools.
Then SourceMonkey picks up new or updated scripts automatically.

Scripts can also be installed from standard web sources, and the exact same script content works as a local script or web-installed script.  For local development, `@require`d helper libraries can also load locally rather than from the deployed web version.

This makes it easy to work locally (in Claude Code or other dev tools), manage code in GitHub, upload and download released versions of scripts, and diff across versions.

SourceMonkey is still experimental and under development.
There's no published extension yet, so it has to be built from source.

### Tampermonkey - Alternate userscript manager

My workflow also works with Tampermonkey, with a bit more friction pasting new scripts into Tampermonkey and managing updates.

One useful shortcut during development: create a stub script whose body is just a `@require` pointing at the local file, so each run picks up the newest version without re-pasting.  My [install-in-tampermonkey](.claude/skills/install-in-tampermonkey/SKILL.md) skill can do this transformation automatically.

### Test harness

Tests live next to each script (`sites/<site>/<name>.spec.js`) and
run via Playwright against a manually-launched Chromium.

Tests can run against live web pages to make sure the script still works as intended, and so fixing the script after the site changes can be automated.

Some sites require login to get to the pages where the script is active.
These can run by getting the user to log in to the site in the Chromium test browser (and the logins will persist there).

In some cases, to avoid login or other live-site issues, tests are written against static snapshots of the target page.

During development, Claude can also explore sites and test scripts interactively using Playwright or Chrome DevTools.

One-time setup:

```
pnpm install
pnpm exec playwright install chromium
```

To run tests:

```
# Open the browser the tests use, with a persistent session.
# You may need to log in to sites the tests need to access.
scripts/open-browser.sh

pnpm test                                                       # all tests
pnpm exec playwright test sites/feedly.com                      # one site's tests
pnpm exec playwright test sites/feedly.com/sort-filter-presets.spec.js  # one file
pnpm exec playwright test -g "Newest preset"                    # by test name
```

`pnpm test` runs a preflight that launches the browser if it isn't already running on CDP (Chrome DevTools Protocol) port 9233; subsequent runs reuse it.
The direct `pnpm exec playwright test …` invocations skip the preflight, so launch the browser yourself for those.

See [CLAUDE.md](CLAUDE.md)'s "Testing" section for why we don't let Playwright
launch the browser itself, and [test/fixtures.js](test/fixtures.js) for the shared
fixtures (`page`, `loadUserscript`).

## License

All code in this repository is MIT licensed.  See [LICENSE](LICENSE).
