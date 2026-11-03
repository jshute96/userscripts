## Improving this process

We're iteratively improving how we build userscripts here. Whenever
we learn something non-obvious, set up new tooling, or settle a
recurring decision, record it so the next session benefits:

* **General userscript tips and workflow** (what sites do that breaks
  scripts, how to build one) → the `SourceMonkey-userscripts` skill,
  in the SourceMonkey checkout at `../SourceMonkey/skills/`. It's
  public and generic: no personal details, and examples that stand on
  their own.
* **How to use `sm-dev` and the harness** → the `SourceMonkey-dev`
  skill, in the same place.
* **The collection layout, and publishing on Greasy Fork, in general**
  → the `userscript-collections` and `publish-on-GreasyFork` skills,
  in the same place.
* **Conventions and workflows specific to this repo** (layout,
  manifest, README, docs, publishing) → this file (`CLAUDE.md`).
* **Reusable how-to-do-X procedures for this repo** → a skill under
  `skills/`.
* **Per-script details (selectors, assumptions, observed DOM)** →
  the script's sibling `.md` doc file.
* **Cross-project lessons that apply outside this repo** → save to
  Claude memory.

If something would have saved time *this* session if it had been
written down before, that's the bar for recording it.

### SourceMonkey friction log

When a task that ran into friction with SourceMonkey's development
tools (`sm-dev`, the Playwright harness, the `SourceMonkey-dev` skill,
the script manager) is finished, use the `SourceMonkey-friction` skill
to add an entry to the friction log, without being asked. The log is
`../SourceMonkey-friction.md`, in the directory above this repo.

* Finished means committing the work, or abandoning it.
* Write one entry per task, not one per problem. If more work on the
  same task follows on the same day, add to that entry rather than
  starting a new one.

## Organization

This repo is a userscript collection, laid out as the
`userscript-collections` skill describes: scripts in `sites/<site>/`,
each with a sibling `.md` doc, listed in `script_manifest.json`, with
generated README tables and site icons. **Load that skill when adding,
renaming, removing or documenting a script.** "Our collection" below
has what's specific to this one.

## Other script collections

Scripts can also live in other repos, each a parallel collection with
the same layout (`sites/<site>/`, sibling `.md` docs,
`script_manifest.json`, a generated README table) that takes its
conventions, skills and tools from this repo. A collection can be
anywhere I point at; it doesn't have to sit beside this one. For
example:

* `userscripts` (this repo): public scripts, on GitHub and some on
  Greasy Fork. Holds all the conventions, skills and tools.
* `../userscripts-private`: scripts I keep but don't publish.

When I ask to build or change a script in another collection (by name
or path), put it there and follow this file as usual. The collection's
`AGENTS.md` (with `CLAUDE.md` and `GEMINI.md` symlinked to it) says
what it is, imports this file, and lists what differs there. In short:

* It refers to this repo by relative path (below, `<this repo>`), so
  those paths depend on where it lives: the `@<this repo>/CLAUDE.md`
  import, its skills symlinks, and the paths in its `package.json`.
* It has its own `pnpm install` with the same dependencies, so
  `pnpm sm-dev` works there. Its `pnpm test` runs *this* repo's
  Playwright binary (`<this repo>/node_modules/.bin/playwright`),
  because its specs import this repo's fixtures and Playwright refuses
  to load two copies of itself.
* Its specs import `<this repo>/test/fixtures.js`, relative to the
  spec.
* `scripts/update_readme.py --root <collection>` regenerates its
  README, and `scripts/update_site_icons.py --root <collection>` its
  icons (into its own `site-icons/`). Both work from either repo, or
  without `--root` from inside the collection. `update_site_icons.py`
  runs `pnpm sm-dev` in whichever checkout it's started from.
* SourceMonkey loads it as a separate local collection.
* Nothing in a private collection is published, and nothing from it
  gets copied or mentioned here: this repo is public.

## Skills

* **`SourceMonkey-userscripts`: load it whenever writing, changing,
  reviewing or debugging a userscript.** It has the workflow for a new
  script, triage when one stops working, header and logging defaults,
  and topic references for things sites do (single-page apps, React,
  CSP-sandboxed pages, hashed class names, scrolling, shared `@require`
  code, user settings, `@name` / `@description`). This file only adds
  what's specific to this repo.
* `SourceMonkey-dev` is how to run, drive, debug and test a script:
  `sm-dev` (run a script in a browser, drive and inspect
  the page, read the script's logs, state and stored values), raw CDP
  for what `sm-dev` can't do (window size, real wheel input), and the
  Playwright harness for specs. **Load it before running a script in a
  browser or writing a spec**, rather than working from memory: the
  tool changes, and the skill tracks it. `pnpm sm-dev help` is the
  current reference.
* `tampermonkey` is a public plugin with general guidance on userscript
  syntax and development. `SourceMonkey-userscripts` says which of its
  references to read when.
* `SourceMonkey-friction` records problems with those tools in the
  friction log. See "SourceMonkey friction log" above.
* `install-in-SourceMonkey` installs and refreshes scripts in
  SourceMonkey, my preferred userscript manager.
* `install-in-Tampermonkey` installs scripts in Tampermonkey, an
  alternative userscript manager.
* `userscript-collections` covers this repo's layout: the manifest,
  README tables, site icons, script docs and screenshots, with the
  scripts that regenerate them (symlinked into `scripts/`). It comes
  from SourceMonkey.
* `add-comment-navigation-script` writes a keyboard comment-navigation
  script for a new site, using our shared libraries.
* `publish-on-GreasyFork` publishes a script to Greasy Fork (the
  userscript repository site) and updates its description and
  screenshots there. **Run it only when I ask**: it's an
  outward-facing action, and every step ends with me reviewing and
  submitting the form myself. It comes from SourceMonkey, with the
  prefill userscript its URLs need (in SourceMonkey's
  `userscripts/greasyfork/`). Its tools live in the skill's
  `scripts/`, with symlinks in this repo's `scripts/` for running by
  hand. We use it with the manifest (see "Our collection").

The SourceMonkey skills are symlinks into
`node_modules/sourcemonkey/skills/`, a copy of `../SourceMonkey` taken
at install time. After editing them in `../SourceMonkey`, run
`pnpm install` here (and in other collections) to pick the edit up.

## Git workflow

- Commit directly to `main` in this repo. Don't create branches or PRs unless requested.
- Do not commit or push changes without getting user instructions to do so.
- When committing, include ALL relevant changed files — check `git status` before committing to avoid missing files like TODO.md, documentation, or new files.

## Creating a new userscript

Follow the `SourceMonkey-userscripts` skill's "Writing a new script"
steps, with these specifics for this repo:

* **Browser for a login:** use the test browser (`--existing-browser`;
  see "Browsers" below) rather than `--open-browser`. It's this repo's
  own profile (`.playwright-profile`), where I've signed in to test
  sites, and the one specs connect to.
* **Write the script** under `sites/<site>/`, with its sibling `.md`
  doc, and **list it** before running it: follow the
  `userscript-collections` skill's steps for a new script (doc, naming,
  manifest entry, icons, README).
* **Install:** SourceMonkey (the default) already has this directory
  installed, and the manifest entry adds the script. Run the
  `install-in-SourceMonkey` skill's `refresh-file` command once, naming
  the new script's path. For Tampermonkey, use `install-in-Tampermonkey`'s
  `install-pointer` action, so I can iterate by reloading.
* **Spec:** `sites/<site>/<name>.spec.js`, once I confirm the script
  works in my normal browser (see "Specs" below).

## Our collection

* **The manifest** also records our Greasy Fork user, as a top-level
  `"greasyfork": { "user": "1604620-jeff-shute" }`. We publish in the
  `publish-on-GreasyFork` skill's manifest mode: its tools read the
  user from here, and `link` records each published script's and
  library's Greasy Fork details on its entry. The skill has the rules
  for those fields.
  - A library's `github_url` is the raw URL our scripts `@require`
    (`https://raw.githubusercontent.com/jshute96/userscripts/main/lib/<name>.js`),
    and its `greasyfork.latest_version_url` the exact Greasy Fork
    version a posted script `@require`s instead. The pair is what lets
    `greasyfork-url.py --code-file` rewrite a script's GitHub
    `@require`s as it posts them (see "Shared code" below).
* **The README's** script tables are under "My userscripts", one per
  `category` in the manifest; the default one is "Miscellaneous".
* **Pinned icons:** Google Calendar's script has `site_icons_pinned`,
  since the temp browser isn't logged in and gets a plain Google icon.
* **Screenshots:** I may capture them with SeeWhatISee (a Chrome
  extension), cropping them and highlighting regions in that tool.

## Repo conventions

* Use two-space indents.
* **US spelling** everywhere we write English.
* Include `// @license MIT` in every userscript header, on the
  line after `@author`. The repo's `LICENSE` file is MIT, and the
  header makes that visible anywhere the script is installed or
  published.

## Shared code: `lib/` and `@require`

The `SourceMonkey-userscripts` skill's
`references/shared-code-and-collaboration.md` covers how `@require`
helpers load and how scripts cooperate through the DOM. Here:

* **Helpers shared across sites** are plain `.js` files (no UserScript
  header) in `lib/`, alongside `sites/`, each with a sibling `.md` doc.
  Scripts reference them by their full
  `https://raw.githubusercontent.com/jshute96/userscripts/main/lib/<name>.js`
  URL, which SourceMonkey maps back to the local file for a local
  install. `lib/` files go in the manifest's `libraries` list, not
  `scripts`, and get their own README table.
* **Helpers shared within one site** sit next to the scripts that need
  them, with a bare relative `@require` (`// @require installed-list.js`).
* **Greasy Fork won't accept a GitHub `@require`**, so **a script
  using `lib/` can't use Greasy Fork's import-from-GitHub
  auto-update**. Our `lib/` files are published there as libraries,
  and these scripts are posted as standalone copies, with
  `greasyfork-url.py --code-file` rewriting each `lib/` `@require` on
  the way. A script with a relative-path `@require` can't be published
  without inlining its helper. The `publish-on-GreasyFork` skill has
  the details.
* Existing libraries: `lib/keyboard-shortcuts.js` (key registration
  and a cross-script `?` help overlay), `lib/keyboard-comment-nav.js`
  (the comment-navigation behavior shared by every site that has it),
  and `lib/image-zoom-pan.js` (zoom and pan for standalone images and
  framed image viewers).
* `install-in-Tampermonkey`'s `convert-to-file-pointer.py` keeps
  existing `@require` lines as they are and adds its own `file://`
  `@require` for the body, so a script with a shared-helper `@require`
  still installs as a local-file pointer.

## Testing

**For anything about running a script in a browser, driving and
inspecting the page, or writing a spec, load the `SourceMonkey-dev`
skill.** It covers `sm-dev`, raw CDP, the Playwright harness, and the
gotchas that go with them. This section only has what's specific to
this repo.

### Browsers

* **Prefer a temp browser** when the page needs no login: `sm-dev`
  launches one by default (with SourceMonkey loaded, closed when the
  run ends), and a spec gets one with `tempBrowserTest` (see "Specs").
  It needs no setup, and runs alongside other agents.
* **The test browser is for sites that need a login**, or that block
  the temp browser (Reddit does).
  - `scripts/open-browser.sh [url]` launches Playwright's bundled
    Chromium with a persistent profile (`.playwright-profile`) and CDP
    on port 9233. Leave it running, and log in to test sites in it once.
  - `sm-dev` uses it with `--existing-browser` first:
    `pnpm sm-dev --existing-browser start ...`.
  - Specs that import `test` connect to it. `pnpm test:temp`
    (`TEMP_BROWSER=1`) runs every spec in a temp browser instead.
  - It needs SourceMonkey loaded, once per profile:
    `pnpm sm-dev --existing-browser manager install`.
* **Don't let Playwright launch the browser.** Both system Chrome
  (`channel: 'chrome'`) and `chromium.launchPersistentContext()` set
  automation flags that Google's bot detection trips on, blocking
  sign-in. Launching the bundled Chromium ourselves and attaching over
  CDP looks "real" to Google. The "Chrome for Testing" banner is the
  sign you're on the right binary.
* The port is project-specific (9233), so other test browsers can run
  alongside without connecting to the wrong one.
* **Site isolation is disabled in `open-browser.sh`**
  (`--disable-features=IsolateOrigins,site-per-process`). With it on,
  cross-origin iframes (almost any third-party embed) run in their own
  process, and Playwright's `connectOverCDP` hangs until timeout: Chrome
  silently drops its `Page.createIsolatedWorld` reply for those frames.
  If a CDP connect hangs with `pw:protocol` stopped on that call for a
  cross-origin frame, this is it.

### Specs

* Specs live next to their script, `sites/<site>/<name>.spec.js`, and
  run with `pnpm test` (or `pnpm test <file>`).
* Import `test` and `expect` from `../../test/fixtures.js`, not from
  `sourcemonkey/harness` directly. The fixture connects to the test
  browser, uses the script's collection (the nearest
  `script_manifest.json` above it, with this repo as a fallback) as
  the root for `@require` lookups, and
  prints the page's `[name]` logs and the script's start, skip and
  error reports beside the test output.
* **A spec that needs no login imports `tempBrowserTest as test`**
  instead of `test`, so it runs in the harness's own hidden browser
  (SourceMonkey loaded, no logins) and needs no test browser running.
  Use it for specs that serve their own pages or saved snapshots, or
  run against a local server.
  - Keep `test` for live sites that need a login, or that block a
    hidden browser.
* Write a spec after the user confirms the script works (see "Creating
  a new userscript"), so it encodes a known-good state.
* Examples worth copying:
  - `sites/any/image-zoom-pan.spec.js`: no site at all. It serves
    generated images at made-up URLs with `page.route`, sets the window
    size, and tests URL matching with `loadUserscript(path, { url })`.
* **A spec that times out in `page.goto` on a site with a service
  worker may be the test browser's profile, not the script.** In the
  shared profile, nytimes.com and youtube.com loads stalled while a
  fresh profile started them in well under a second. The fix (clearing
  that site's service workers and cache storage) is in the
  `SourceMonkey-dev` skill's Troubleshooting. See also TODO.md.

## Naming and describing a script

Follow the `userscript-collections` skill's
`references/script-docs.md`: `@name`, `@description` and the doc's
`Summary` are written as a set, for readers in the userscript manager,
search results and Greasy Fork. Its `references/screenshots.md` has
the screenshot conventions.
