# My userscripts repository

These are some of my userscripts.
Scripts are arranged by target site under [sites/](sites/).

For background, the [awesome-userscripts](https://github.com/awesome-scripts/awesome-userscripts#tutorials) list has good tutorials,
and [Greasy Fork](https://greasyfork.org/) hosts thousands of existing scripts to browse and install.

Some of my scripts are generally useful and have been published on Greasy Fork.
Some are just my personal tweaks or preferred defaults that probably don't make sense for others.

My scripts here were mainly developed using Claude Code.  I'm working on an optimized setup for agentic development for userscripts.  See below.

My modest ambition: **Fix the internet.**  Every broken or annoying website I use, I can fix it.  Every time I wish a site had some missing feature, I can add it.  Claude Code makes this possible now, with the right tools and workflow around it.

## Development setup and workflow

### Code structure

Scripts are organized by site under `sites/`:
- `sites/<site>/<name>.user.js` - the userscript
- `sites/<site>/<name>.md` - documentation describing what it does and how it works
- `sites/<site>/<name>.spec.js` - (sometimes) a test

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
the new behaviour, and updates the documentation; I reload and try the site again.

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
npm install
npx playwright install chromium
```

To run tests:

```
# Open the browser the tests use, with a persistent session.
# You may need to log in to sites the tests need to access.
scripts/open-browser.sh

npm test                                                  # all tests
npx playwright test sites/feedly.com                      # one site's tests
npx playwright test sites/feedly.com/sort-filter-presets.spec.js  # one file
npx playwright test -g "Newest preset"                    # by test name
```

`npm test`'s pretest hook launches the browser if it isn't already running on CDP (Chrome DevTools Protocol) port 9233; subsequent runs reuse it.
The direct `npx playwright test …` invocations skip the pretest hook, so launch the browser yourself for those.

See [CLAUDE.md](CLAUDE.md)'s "Testing" section for why we don't let Playwright
launch the browser itself, and [test/fixtures.js](test/fixtures.js) for the shared
fixtures (`page`, `loadUserscript`).

## License

All code in this repository is MIT licensed.  See [LICENSE](LICENSE).
