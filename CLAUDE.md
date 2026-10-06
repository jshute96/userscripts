## Improving this process

We're iteratively improving how we build userscripts here. Whenever
we learn something non-obvious, set up new tooling, or settle a
recurring decision, record it so the next session benefits:

* **Generic conventions, workflows, and gotchas** → add a section or
  bullet to this file (`CLAUDE.md`).
* **Reusable how-to-do-X procedures** → add or extend a skill under
  `.claude/skills/`.
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

* Save userscripts for domain `example.com` in a subdirectory called `sites/example.com`.
* The filename should briefly state the main purpose.
* Each userscript has a sibling `.md` doc file with the same basename
  (e.g. `foo.user.js` and `foo.md`). See "Doc files" below.

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
  README.
* SourceMonkey loads it as a separate local collection.
* Nothing in a private collection is published, and nothing from it
  gets copied or mentioned here: this repo is public.

## Skills

* `tampermonkey` is a public plugin with general guidance on userscript
  syntax and development. Read it (via `/tampermonkey:tampermonkey` or
  by reading `SKILL.md`) whenever writing or reviewing userscripts —
  its `references/` directory has focused, well-organized material we
  shouldn't duplicate here.
  - **`references/common-pitfalls.md`** — `@match` too broad, not
    waiting for elements (SPA), memory leaks in observers,
    over-aggressive DOM modifications, hardcoded selectors, sandbox
    context confusion, CSP, etc. Skim it before writing a new
    script, and again when reviewing one that misbehaves.
  - **`references/patterns.md`** — Canonical idioms: `waitForElement`,
    SPA URL-change detection (both the `window.onurlchange` grant and
    History-API interception), route-based handlers, debounced
    observer, custom styles, persistent settings, keyboard shortcuts.
  - **`references/url-matching.md`** — `@match` / `@include` /
    `@exclude` semantics and corner cases.
  - **`references/header-reference.md`**, **`sandbox-modes.md`**,
    **`browser-compatibility.md`** — load on demand when the question
    is specifically about that area.
* `SourceMonkey-dev` is how to run, drive, debug and test a script:
  `sm-dev` (inject a script into the test browser, drive and inspect
  the page, read the script's logs, state and stored values), raw CDP
  for what `sm-dev` can't do (window size, real wheel input), and the
  Playwright harness for specs. **Load it before running a script in a
  browser or writing a spec**, rather than working from memory: the
  tool changes, and the skill tracks it. `pnpm sm-dev help` is the
  current reference.
* `SourceMonkey-friction` records problems with those tools in the
  friction log. See "SourceMonkey friction log" above.
* `install-in-SourceMonkey` is my skill commands to install scripts in SourceMonkey,
  my preferred userscript manager.
* `install-in-tampermonkey` is my skill commands to install scripts in Tampermonkey,
  an alternative userscript manager.
* `publish-on-GreasyFork` publishes a script to Greasy Fork (the
  userscript repository site) and updates its description and
  screenshots there. **Run it only when I ask** — it's an
  outward-facing action, and every step ends with me reviewing and
  submitting the form myself.

## Git workflow

- Commit directly to `main` in this repo. Don't create branches or PRs unless requested.
- Do not commit or push changes without getting user instructions to do so.
- When committing, include ALL relevant changed files — check `git status` before committing to avoid missing files like TODO.md, documentation, or new files.

## Creating a new userscript

When the user describes a new userscript (usually a site, screenshot,
maybe HTML), follow this flow:

1. **Reproduce the starting state.** Drive the test browser (see
   "Testing" below) to the page they're asking about with `sm-dev`, and confirm you can see and inspect the controls they want
   to change. If the persistent profile isn't logged in to the
   target site, **stop and ask the user to log in** in that
   window — don't try to automate the login.
2. **Capture the DOM you'll depend on.** Per "Iterating on DOM-heavy
   userscripts" below, snapshot every relevant state up front
   (closed, each menu open, hover/focus). This avoids multiple
   fix-and-fail cycles.
3. **Write the script** under `sites/<site>/`, with its sibling
   `.md` doc. Name and describe it per "Naming and describing a
   script" below.
4. **List it.** Add an entry to `script_manifest.json`, in site
   order, then run `scripts/update_readme.py` to regenerate the
   README tables — see "Keeping the script list current" below.
   Only set a `category` if the user asks for one.
5. **Run it against the page** with `sm-dev`, following the
   `SourceMonkey-dev` skill's core loop: `validate`, `start --watch
   --detach` in the test browser, drive and check it, then `stop`. If
   you get stuck, stop and report exactly where — don't guess.
6. **Suggest install**
   - If using SourceMonkey (the default), the directory should be installed
     already, and the manifest entry was added in step 4. Run the
     `install-in-SourceMonkey` skill's `refresh-file` command once,
     naming the new script's path, so SourceMonkey picks up the new script.
   - If using Tampermonkey, use the `install-in-tampermonkey` skill's
     `install-pointer` action, so the user can iterate by reloading.
7. **Write a Playwright spec** (`<name>.spec.js`) once the user
   confirms it works in their normal browser. The spec is for
   reproducible regression — write it after the human-confirmed pass,
   not before, so that the spec encodes a known-good state.

### Keeping the script list current

**`script_manifest.json`** — the list SourceMonkey loads, and our
source of truth for which scripts exist. Edit it by hand. It is an
object with two lists:

```json
{
  "scripts": [ ... ],
  "libraries": [ ... ]
}
```

`scripts` has one entry per userscript, in site order, each an object
with:

* `path` — the relative path from the repo root. Required.
* `category` — which README table the script belongs in. Omit it for
  the "Miscellaneous" table (equivalent to `"default"`).
* `greasyfork` — the id and URL of the published script. Don't add
  it until the script is published.

SourceMonkey reads `path` and ignores the other fields.

`libraries` has one entry per shared `@require` helper in `lib/` —
those aren't userscripts and SourceMonkey doesn't load them directly, so we list
them only to track what exists and where each is published:

```json
{
  "path": "lib/keyboard-shortcuts.js",
  "github_url": "https://raw.githubusercontent.com/jshute96/userscripts/main/lib/keyboard-shortcuts.js",
  "greasyfork": {
    "id": 592123,
    "url": "https://greasyfork.org/scripts/592123-keyboard-shortcuts",
    "latest_version_url": "https://update.greasyfork.org/scripts/592123/1907419/keyboard-shortcuts.js"
  }
}
```

Libraries carry two extra fields, and they're the two sides of the same
URL. `github_url` is the raw URL our scripts `@require`; write it by
hand. `latest_version_url` is what that becomes on Greasy Fork: Greasy
Fork gives a library one id and one landing page (`url`), but mints a
*new* URL for every version posted, and a `@require` has to name one
exact version. Scripts loading `@require` libraries from Greasy Fork
point at a specific version and don't get updates without updating the
`@require`.

The pair is what lets `greasyfork-url.py --code-file` rewrite a
script's GitHub `@require`s to Greasy Fork ones as it posts them — see
the `@require` notes below.

`scripts/greasyfork-scripts.py match` reports whether each recorded
`latest_version_url` is still the newest, and `link` refreshes it. A
library's id takes one extra step to find: Greasy Fork leaves libraries
out of the user page's JSON, so it's read from the "Libraries" section
of the HTML user page instead, where each entry carries it in a
`data-script-id` attribute. `match` and `link` do that for any library
with no id recorded yet, pairing by name — our libraries are published
under their filename without `.js`. Everything else is synced from the
id, via the library's own JSON page
(`https://api.greasyfork.org/en/scripts/<id>.json`).

**`README.md`, under "My userscripts"** — generated. Run
`scripts/update_readme.py` after adding or removing a script or
library, or when a script's `@name` or `@description` changes.
`--check` just reports whether the file is stale, without writing.

Each script table sits under a placeholder comment naming its category,
with the libraries under its own:

```markdown
<!-- update_readme.py category=keyboard-comments -->
<!-- update_readme.py libraries -->
```

The script rewrites the table under each placeholder.

### Script categories

Scripts omit `category` by default, and then go in a default category.

If the user asks you to put the script in a particular category, add
the `category` tag. This should match some existing `category` in the
manifest (and a placeholder in `README.md`).

### State-checking for option-change scripts

If the userscript's job is to set an option to a target value (rather
than perform a one-shot action), **read the current state first** and
skip the change if it already matches:

* Toggling an option that's already in the desired state often has
  side effects — focus jumps, network calls, animations, dirty
  flags, telemetry events.
* The check is cheap and gives a useful log line ("already in target
  state, skipping") for debugging.

Pure action buttons (download, navigate, submit) have no current
state to compare against — this guideline doesn't apply to them.

## SPA sites: broaden `@match`, gate inside the script

Most modern sites we target (Peloton, Garmin Connect, Feedly, NYT, …)
are single-page applications: the browser fetches one HTML document
on initial load, and from then on in-page JS swaps content and calls
`history.pushState()` to update the URL. The browser never loads a
new document, so userscripts only ever get one chance to inject — at
the initial document load.

That has a consequence for `@match`:

* If `@match` is narrow (e.g. only `/app/activity/*`) and the user
  starts on a different page (`/app/home`), then SPA-navigates into
  an activity, **the script never runs** — its `@match` was checked
  once, against the initial document URL, and the URL has since
  changed without a document reload.
* Reloading the page fixes it (the new URL now matches at document
  load), but expecting the user to reload before every interesting
  page is a bad UX.

The fix is to **broaden `@match` to the site root** and gate behavior
inside the script:

1. `@match https://site.com/*` (or the smallest prefix that covers
   every page the script *might* care about).
2. Add `@grant window.onurlchange` and listen for the native
   `urlchange` event. The manager fires it on any history mutation —
   `pushState`, `replaceState`, `popstate` — so there's nothing to
   monkey-patch. Violentmonkey doesn't support it, so add the
   fallback shown below (see "Portability across userscript managers").
3. Dispatch on `location.pathname`, both initially and on every
   `urlchange`.

```js
// @grant window.onurlchange

function onUrlChange() {
    // dispatch on location.pathname; idempotent — handlers must
    // tolerate being called repeatedly on the same URL.
}
// Violentmonkey has no window.onurlchange (it stays undefined, where
// managers that support it set it to null); the Navigation API's
// currententrychange fires on the same history changes.
if (window.onurlchange === null) window.addEventListener('urlchange', onUrlChange);
else if (window.navigation) window.navigation.addEventListener('currententrychange', onUrlChange);
else log('no urlchange event or Navigation API; in-page navigation is not tracked');
onUrlChange(); // initial
```

The handler fires on *any* history mutation, including same-path
query-string rewrites that sites use for transient UI state (open
modal, selected tab). If it only cares about the path, compare
against the previous `location.pathname` and return early when it's
unchanged.

Doing the broadening without the re-dispatch is its own bug, and an
easy one to ship: the script silently does nothing whenever the tab's
*initial* document was outside the gate, no matter where the user
navigates afterwards.

(The tampermonkey skill's `patterns.md` → "SPA Navigation Handling"
covers the History-API interception fallback, for managers without
the grant.)

What this implies for the rest of the script:

* **Idempotency is mandatory.** Anything that runs on URL change
  must check "is my work already done?" before doing it — anchor
  rewrites should skip already-rewritten anchors, button inserters
  should bail if `document.getElementById(BUTTON_ID)` exists, style
  injection should check for an existing `<style>` it owns (e.g.
  via a stable `data-<script-slug>` marker on the element).
  Otherwise you'll multiply state on every in-app navigation.
* **Listeners are global, not per-page.** Register
  `document.addEventListener('click', …, true)` once at script init,
  not inside `onUrlChange()`. The listener self-gates by reading
  `location.pathname` (or by checking which element the click hit).
* **MutationObservers also self-gate.** When the SPA tears down and
  rebuilds the DOM on navigation, the observer fires; have the
  callback re-check the URL before acting.
* **Don't rely on `@exclude` to keep the script off a sibling page.**
  If a script is `@match site.com/*` but `@exclude /classes/player/*`,
  it will still run on `/home`, and from `/home` the user can
  SPA-navigate into `/classes/player/123` with the script already
  loaded. `@exclude` only filters initial-document loads — once the
  script is running, *it* must decide whether to act based on the
  current path.
* **One script per site, dispatching by path** is often cleaner than
  N narrow-match scripts. They'd all need this same SPA dance
  individually, and broadening their `@match` makes them all load on
  every page anyway.

Cost: the script's init runs on every page of the site, not just the
relevant ones. For our scripts that's ~1ms of JS plus a couple of
event listeners; almost always fine.

## Portability across userscript managers

Our scripts should work in SourceMonkey, Tampermonkey (TM) and
Violentmonkey (VM), when that can be achieved easily. Check with
`sm-dev --manager tm` / `--manager vm` (see the `SourceMonkey-dev`
skill). Differences we've hit:

* **`window.onurlchange`: VM doesn't support it.** `@grant
  window.onurlchange` defines `window.onurlchange` as `null` in
  SourceMonkey and TM; in VM it stays `undefined` and `urlchange` never
  fires. Test `window.onurlchange === null`, and otherwise listen for the
  Navigation API's `currententrychange`, which fires on the same history
  changes, including in a granted script's isolated world. See the
  snippet under "SPA sites" above.
* **Start time differs.** TM and VM can start a `document-idle` script
  earlier than an sm-dev SourceMonkey run does (a run delays every
  script until the extension's check). Anything the page does after
  load can undo our early work: Medium's React 19 strips every extra
  child of `<html>` when it client-renders the document. DOM state that
  must persist should be re-created when it's removed, as
  `lib/keyboard-shortcuts.js` does for its registry.
* **`@inject-into` is ignored by TM**; see the CSP `sandbox` tip below.
* **Other browsers are untested.** Our tools only drive Chromium, so
  Firefox and Safari behavior is unverified. Where a script leans on a
  newer web API (like the Navigation API above), feature-check it and
  log when it's missing, rather than failing silently.

## When a script stops working

Sites change. Triage in this order — it converges fast and avoids
re-deriving the script from scratch:

1. **Open DevTools on the affected page and look for the `[name]
   init` log.**
   - Present → @match is fine, the IIFE ran. Skip to step 2.
   - Absent → it's an installation, `@match`, or grant issue.
     `pnpm sm-dev match <script> <url>` says whether the header covers
     the URL, and which rule decided. Otherwise check the manager's
     installed-scripts page, and whether the header changed since the
     script was installed (header changes need a refresh or
     reinstall).
   - Absent, but the header matches and the manager says it should
     run (SourceMonkey's badge shows MISSING) → the page may be
     blocking page-world scripts. See "Pages sent with a CSP
     `sandbox` header" under Tips.

2. **Find the first log line that *should* fire but doesn't.** Each
   step in the script logs on success; the gap between the last
   present log and the missing next log is where it broke. If the
   only log is `init`, the failure is in the very next step
   (usually the first selector lookup or the MutationObserver
   callback).

3. **Treat the sibling `.md` doc's "What we assume stays stable"
   section as the selector checklist.** Probe each assumed selector
   on the live page; the first one that's missing is your answer.
   `sm-dev probe` does it in one call:
   ```sh
   pnpm sm-dev probe '.FeedPage' '.FeedPage header' \
     'header button[aria-haspopup="listbox"]' 'button[aria-label="Mark as read"]'
   ```

4. **Once you've identified the changed selector, look for a more
   resilient anchor on or near the target.** Prefer something on
   the element itself over its wrapper (`header.Header` is harder
   to break than `.SomeWrapper header`). If you switch from a
   wrapper-based anchor to a leaf-based one, update the doc's
   stability assumptions to match.

A silent retry-forever path (e.g. a `MutationObserver` whose
`findX()` returns null and bails) looks identical to "page still
loading" from the outside — see the logging tip below about
periodic "still waiting" logs for poll loops. Add that log first
if it's missing; it makes the next break diagnose itself.

## Tips and rules

* Use two-space indents.

* **US spelling** everywhere we write English.

* When writing userscripts, add `console.log` logging to give more debugging visibility.
  - Use a short `[name]` prefix, two words at most.
  - Log when the script initializes.
  - Log when it detects the activity or finds the element it's trying to fix.
  - Log when it successfully makes a change.
  - Log any failures.
  - If a `MutationObserver` or poll loop is *also* the normal
    startup path (every tick "selector not found yet" is expected
    on first paint), log once after N seconds of continued failure
    so a permanent break is distinguishable from "still loading."
    Otherwise a renamed selector looks identical to a slow SPA.

* Do not include any personal data, user content, account IDs, etc in tests, scripts, or docs. (Script author info is okay.)

* **Getting an edit to take effect depends on the userscript manager —
  defer to the relevant skill** (e.g. `install-in-SourceMonkey` or
  `install-in-tampermonkey`) for how to trigger refresh. None of this
  applies while iterating with `pnpm sm-dev start`, which injects the
  file as it is on disk.
  - Under SourceMonkey (our default), editing the body of an
    already-installed local script needs **nothing** — it re-reads the
    file on every page load, so the user just reloads the page. Don't
    fire a refresh after an ordinary edit. A refresh is only needed for
    changes to *which* scripts run where: a new or deleted script file,
    a manifest change, or edited targeting headers. When one is needed,
    use the skill's `refresh-file` on the changed path — the plain
    `refresh` re-fetches every remote collection too.

* To get scripts to update from github, increment the `@version` (in the last number field) before final commit and push.

* After creating the first version of a userscript, suggest the user install it.
  Use the `install-in-tampermonkey` skill, and do `install-pointer` action for this script.
  Then the user can get incremental updates just by doing Reload in the browser.

* NOTE: Changing the header — especially the targeting rules
  (`@match` / `@include` / `@exclude`) — is the case most likely to
  need a refresh or reinstall rather than just a page reload. See the
  installer skill for your manager.

* Include `// @license MIT` in every userscript header, on the
  line after `@author`. The repo's `LICENSE` file is MIT, and the
  header makes that visible anywhere the script is installed or
  published.

* **Two installed copies of a script get two separate GM storages.**
  Easy to end up with (two managers, or a manager copy plus a
  local-file pointer) and normally invisible, since idempotent-by-id
  inserters just find the other copy's elements. It shows when the
  copies disagree about stored state and each "corrects" the DOM: one
  adds a marker, the other's `MutationObserver` removes it, forever.
  If DOM changes flap in a steady alternating rhythm, count the `init`
  log lines before debugging the logic. Guard scripts that write
  persistent state by claiming the page at startup — a
  `data-<script-slug>` attribute on `<html>`, since the sandboxes
  share only the live document — and have later copies stand down
  *with an on-screen error*: which copy wins is load order decided per
  tab, so cross-tab state can still land in a storage the other tab
  isn't reading, and the script stays broken until one is uninstalled.
  Our Playwright harness covers this:
  `loadUserscript(PATH, { copy: 'second' })` beside a plain
  `loadUserscript(PATH)` is a second installed copy in one document,
  with its own sandbox and its own storage. Without `copy` the second
  load replaces the first.

* Default to `@noframes` in the header. Sites often embed hidden
  iframes; without `@noframes` the script
  runs in those too and you'll see init logs from contexts you
  didn't expect. Drop it only when the script genuinely needs to
  run inside iframes.

* **Scripts for an open-ended set of sites: add `// @inject-into
  content` up front**, unless the script needs page globals. This
  means any-site patterns (`*://*/*`, broad `@include` regexes), or a
  URL shape like `*/_next/image?*` on any host. Some hosts block
  page-world scripts (see "Pages sent with a CSP `sandbox` header"
  below), and we'll never test every host such a script lands on, so
  don't wait for a broken one. Scripts for one known site don't need
  it; testing on that site catches the problem.

* When inserting a button into a host site that uses CSS-modules
  (class names like `Button_btn__g8LLk Button_secondary__8WBFj`
  with build-hash suffixes), don't hardcode the suffixes — they
  rotate every deploy. Instead, find a reference button on the page
  that already has the styling you want and copy its `className` to
  your new button. Match references by class-prefix attribute
  selectors, e.g.
  `button[class*="Button_btn"][class*="Button_secondary"][class*="Button_medium"]`,
  excluding variants you don't want
  (`:not([class*="iconButton"])`). If the reference button might
  not be in the DOM yet at insertion time (e.g. it lives below the
  toolbar you're attaching to), have your `MutationObserver`
  *upgrade* the className when a better reference appears.

* **Reading React internals (`__reactFiber$…` expandos on DOM nodes)
  needs `@grant none`.** The expando lives in the page's world; from an
  isolated world it's simply `undefined`, with no error, so the script
  silently finds nothing. Worked example of the fiber walk itself:
  `sites/www.trailforks.com/strava-map-crosslink.md`.

* React menu items often render as plain `<div>`s with `onClick`
  handlers, not `<button>`/`<a>`. From in-page JS (i.e. inside the
  userscript), calling `.click()` on the element reliably fires
  React's onClick, including for the parent menu trigger. Use this
  to chain "open menu, find item, click it" without simulating
  pointer events. (From a Playwright test runner the same
  `.click()` may not toggle the menu — keyboard activation
  `focus()` + `Enter` works there as a fallback when needed.)

* **Rearranging a React-rendered list: don't move React's nodes.**
  React keeps references to its DOM nodes and later calls
  `insertBefore`/`removeChild` on them against the parent it expects,
  which throws (and can break the page) if we moved them.
  - To reorder or regroup items in a flex/grid container, set
    `style.order` on each item instead. The DOM order, and so Tab
    order, stays the site's.
  - Adding *our own* element inside React's container (a heading as a
    full-width flex item, `flex: 0 0 100%`) is safe; React ignores
    children it didn't create.
  - To show an item in a second place, `cloneNode(true)` it into a
    container of our own, and replay clicks on the copy onto the
    original: find the clicked element's child-index path within the
    copy, follow it in the original, and `.click()` the nearest
    button there. Rebuild the copies when the originals change.
  - Re-apply from a `MutationObserver` on `childList` (plus
    `characterData` if you track text React rewrites, like a
    quantity). Leave out `attributes`, so our own `style.order` writes
    don't retrigger it.
  - Copy the site's generated class names (JSS `jss32`, MUI) from a
    live element at runtime rather than hardcoding them. Measure
    offsets that change with the window width (e.g. a grid's negative
    margin) instead of assuming one.

* `@require` for helpers shared **across sites**: put a plain `.js`
  file (no UserScript header) in `lib/`, alongside `sites/`, with a
  sibling `.md` doc. Reference it by its full
  `https://raw.githubusercontent.com/.../main/lib/<name>.js` URL —
  SourceMonkey maps that back to the local file when the script is
  installed from a local directory, matching on the common parent
  path, so one line covers both install modes. `lib/` files go in the
  manifest's `libraries` list, not `scripts`, and get their own README table.
  - Multiple `@require`s run in order, in the userscript's own
    sandbox, so a library may call one required earlier.
  - **Greasy Fork won't accept a GitHub `@require`** — it wants
    libraries published on Greasy Fork or an allowlisted CDN. Our
    `lib/` files are now published there (see `libraries` in
    `script_manifest.json`), but the scripts still `@require` the
    GitHub raw URLs, so **a script using `lib/` can't use Greasy
    Fork's import-from-GitHub auto-update** — the copy it fetches is
    the one with the GitHub `@require`s. Publish these by posting the
    code instead (`greasyfork-url.py new`/`update --code-file`), which
    rewrites each `lib/` `@require` to that library's
    `latest_version_url` on the way, matching it by the library's
    `github_url` in the manifest. The checked-in file is untouched —
    it keeps the GitHub URLs a local install needs — so every version
    is still posted by hand.
  - **A relative-path `@require` can't be published at all**: it only
    resolves against a local install's directory, so a Greasy Fork
    install gets a script whose helper never loads. Publishing such a
    script means inlining the helper into the posted copy.
  - `greasyfork-url.py` checks for both before it builds a form URL —
    on `import` and `--code-upload`, which hand Greasy Fork the file
    as-is, and on `--code-file` after its rewrite. A script it stops
    on is one that would have been published broken.
  - A library is published on the same forms as a script, choosing the
    `library` script type, which adds Name and Description fields — a
    `lib/` file has no metadata block to fill them from.
    `greasyfork-url.py --library lib/<name>.js` derives both from the
    file (basename, and its first `//` line) along with Additional info
    from the sibling `.md`. There's no import-from-GitHub for libraries
    at all, so every version is posted this way.
  - Existing libraries: `lib/keyboard-shortcuts.js` (key registration
    + a cross-script `?` help overlay) and `lib/keyboard-comment-nav.js`
    (the comment-navigation behavior shared by every site that has it).

* `@require` for shared helpers within a single site: drop a plain
  `.js` file (no UserScript header) next to the scripts that need it
  and reference it with a bare relative path, e.g.
  `// @require installed-list.js`. SourceMonkey resolves it relative
  to the userscript's source URL, so the same line works for a
  github-raw install (sibling file in the same directory) and an
  `install-pointer` install (sibling file in the local directory).
  The helper runs in each userscript's sandbox
  immediately before the body, so top-level `function`s and `const`s
  in the helper are visible to the script body. Per-userscript state
  is sandboxed; cross-script collaboration goes through the live DOM
  (use stable IDs / `data-` markers, and have helpers be idempotent
  by ID lookup).
  - `scripts/convert-to-file-pointer.py` preserves any existing
    `@require` lines verbatim and adds its own `file://` `@require`
    for the body, so a script with a shared-helper `@require` still
    installs cleanly as a local-file pointer.
  - `sm-dev` and the spec harness resolve `@require` the way
    SourceMonkey does, reading local copies of `lib/` and relative
    files, so there's nothing to stub.

* **Cross-userscript collaboration goes through the DOM.** Each
  script is sandboxed, so a `@require`d library runs once per script
  with its own private state — two scripts on a page cannot see each
  other's variables. What they share is the document. The pattern
  that works: a hidden host element created idempotently by whoever
  loads first, one child per script keyed by `GM_info.script.name`,
  carrying JSON metadata. Only serializable data crosses; live
  closures (predicates, handlers) stay in their own sandbox, so
  design the feature to need only data from the other scripts.
  `GM_info` is populated even under `@grant none`, so the script's
  own name is available without changing sandbox mode.
  - **Hang the shared host off `document.documentElement`, not
    `document.body`.** Scripts register once at load and stay
    resident across SPA navigation; if the site ever replaced its
    `<body>`, the host would go with it and nothing would rebuild
    it, because the other sandboxes finished registering long ago.

* **Scripts matching a site also run on its direct image URLs**, in
  Chrome's standalone image viewer (`ImageDocument`, where
  `document.contentType` starts with `image/`). To change that viewer,
  never replace or clone its `<img>`: the clone has no bitmap. Details
  in `sites/any/image-zoom-pan.md`.

* **Pages sent with a CSP `sandbox` header silently skip `@grant none`
  scripts.** `Content-Security-Policy: sandbox` (without
  `allow-scripts`) turns off JavaScript in the page's own world, so
  Chrome never injects page-world scripts there. Scripts in the
  isolated world still run. Sites serving user uploads or raw files
  send this header to block XSS, including on direct image URLs.
  - Most likely to bite any-site scripts (broad `@include` regexes,
    `*://*/*`, `<all_urls>`), since they land on hosts nobody checked.
  - Which world a script gets: `@grant none` (or no `@grant`, or
    `unsafeWindow`) → page world. Any other grant → isolated world.
    `@inject-into page` / `content` overrides both.
  - Symptoms: the header matches (`sm-dev match` agrees), but there's
    no init log and no `[SourceMonkey]` line in the page console,
    SourceMonkey's badge shows the script as MISSING, and
    `typeof __smRun` in the page console is `"undefined"`. Other
    scripts with real grants still run on the same page.
  - What the tools say:
    - SourceMonkey's Log for the script gets a warning a few seconds
      after the page loads: `Matched <url> but never started there`,
      plus a hint. When another script in the isolated world ran on
      the page, the hint says the page is sandboxed; otherwise it says
      the page may be blocking scripts, and which header to check.
    - `sm-dev start` (both backends) prints a warning on each load of
      such a page, naming the loaded page-world scripts it blocks.
      sm-dev's own injection is blocked there too, so they also show
      as not started after the 10s wait.
  - Confirm it: in the Network tab, the document's response has
    `sandbox` in its `Content-Security-Policy` header. In the console,
    `self.origin` is `"null"` (sandboxed documents get an opaque
    origin).
  - Fix: add `// @inject-into content` when the script only needs the
    DOM, not page globals. SourceMonkey and Violentmonkey honor it;
    Tampermonkey ignores it. A script that needs page globals (e.g.
    React internals) can't run on such a page at all.

## Testing

**For anything about running a script in a browser, driving and
inspecting the page, or writing a spec, load the `SourceMonkey-dev`
skill.** It covers `sm-dev`, raw CDP, the Playwright harness, and the
gotchas that go with them. This section only has what's specific to
this repo.

### The test browser

* `scripts/open-browser.sh [url]` launches Playwright's bundled
  Chromium with a persistent profile (`.playwright-profile`) and CDP
  on port 9233. Leave it running, and log in to test sites in it once.
  `sm-dev` and `pnpm test` both connect to it by default.
  - Specs run their scripts in its SourceMonkey, so it needs the
    extension loaded: `pnpm sm-dev manager install`, once per profile.
  - A page that needs no login can use a throwaway browser instead:
    `sm-dev --temp-browser`, or for a spec `tempBrowserTest` (see
    "Specs"). `pnpm test:temp` (`TEMP_BROWSER=1`) runs every spec in
    one.
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
* **Waiting for a smooth scroll to settle: poll the target element's
  `getBoundingClientRect().top`, not `window.scrollY`.** On ad-heavy,
  lazy-loading pages, content above the target keeps growing, so
  `scrollY` can sit still while the element is still moving, and a
  scrollY-based settle measures too early. (Scripts have the
  mirror-image problem; see the drift correction in
  `sites/pinkbike.com/keyboard-comment-navigation.md`.)

### Lesson: where a request comes from matters

The harness sends a `GM_xmlhttpRequest` from Node with the browser's
cookies, not from the extension, which sends different cookies, no
`Origin`, and `Sec-Fetch-Site: none` (a value no page can produce, and
that some firewalls reject). **When a change moves where a request
comes from, send one real request from the new place first**, in the
real extension (`--extension`, see the skill).

This cost a 1100-line rewrite once: the Garmin to Strava script was
rebuilt around "the Strava page can fetch from Garmin now", checked
with a page-context `fetch`, and then every API call returned 403. A
403 the page can't reproduce is probably the site's edge, not its
server: with Cloudflare, the failing response lacks the
`cf-cache-status` header the working one has.

## Iterating on DOM-heavy userscripts

If the script will walk popovers, menus, or other dynamic UI, capture
HTML snapshots of *every* relevant state up front — closed, each menu
open, each submenu expanded, hover/focus states. Doing this before
writing the script saves multiple fix-and-fail cycles. Common things
that surprise:

* Submenus may *replace* the main menu rather than stack alongside it.
* ARIA role names are inconsistent within the same site (e.g. one
  popup uses `role="menuitemradio"`, a sibling popup uses bare
  `role="checkbox"`).
* Visible text capitalization may vary across UI surfaces; match
  case-insensitively when querying by label.
* Attributes like `aria-controls` are often only set while the popup
  is open — don't include them in selectors meant to find the
  trigger button when it's collapsed.

### Selector preference: semantic over visual

When you have a choice of selectors for the same element, pick the
most semantic one. Stable preference order, best to worst:

1. Stable IDs / `data-*` attributes the site authors put there.
2. Semantic CSS-module class **prefixes**
   (`ActivitySettingsMenu_menuContainer__*`) and meaningful
   `aria-label` / `title` strings — they describe *purpose*, not
   how the element is drawn.
3. Generic role/tag selectors with disambiguating text content
   (e.g. `[role="menuitem"]` matching `/^export to tcx$/i`).
4. Visual identifiers — SVG `<path d="…">` geometry, exact pixel
   positions, icon dimensions. Last resort; brittle to any rebrand
   or icon refresh.

When the leaf element you want to click looks generic but its
ancestors carry semantic class names, walk *up* the DOM until you
find a meaningful container, then re-find your leaf relative to it.
A 460-character minified `<path d="…">` prefix is a code smell —
look up the tree.

## Naming and describing a script

Every script is described at three levels of increasing length, each
written for a reader who may never see the others. All three are
user-facing — they're what shows up in the userscript manager, in
search results, and on the script's page when it's published to a
repository site like [Greasy Fork](https://greasyfork.org/).

Write all three as a set, and keep them consistent: the doc's `#`
title must match the `@name`, and the doc's
`Summary` should include more details on what's in the `@description`.

When any of them changes on an existing script, update the `.md`
title and run `scripts/update_readme.py` in the same edit — see
"Keeping the script list current" above — and bump the `@version`, so
installed copies pick the new text up.

### 1. `@name` — one line, "Site Name: title"

Many tools show *only* the `@name`, so on its own it has to say what
site the script is for and what it does, and ideally
be interesting enough that someone who has that problem stops and
reads further.

The `@name` is also what search typically match on: Greasy Fork's script
search appears to look at little more than the name, so treat
words in it as search keywords and include the words someone looking
for this script would actually type.

* **Site name**, then a colon. Use the site's own brand name, not its
  domain — `Google Calendar`, not `calendar.google.com`. Use the
  fullest common form of that name rather than an abbreviation
  (`NYTimes`, not `NYT`), since the abbreviation someone searches for
  may not be the one we picked.
  - `Site Name Section/Feature:` is preferred, when the
    script only applies to one section or feature of a large site:
    `Peloton Player`, `NYTimes Spelling Bee`, `The Atlantic Games`.
    Scripts covering the site as a whole keep the plain site name
* **Title** after the colon: sentence case, no trailing period.
  Describe the change or the feature, not the mechanism. Prefer a
  verb phrase (`Show elevation loss as well as gain`,
  `Auto-close the newsletter popup`) or a plain noun phrase for a
  thing that's added (`Keyboard comment navigation`).
* Keep the whole thing under about 70 characters so it doesn't wrap
  or get truncated in a script list.
* Don't put "userscript", "script", or "Tampermonkey" in the name.
* Where several scripts do the same job on different sites, use the
  *same* title on each (`Keyboard comment navigation`).

### 2. `@description` — 1–2 sentences, up to ~160 characters

Answers "what is this actually for, and what does it actually add or
change?" in general terms. This is the blurb shown under the name in
script lists and search results.

* Say what the script does and, where it's the point of the script,
  what was wrong or missing without it. A bug-fix script should describe
  the bug.
* General terms only — no selectors, no key-by-key listings, no
  configuration syntax. Those live in the doc.
* Don't restate the `@name`; assume the reader just read it.
* No trailing "…on this site" filler, and no first person.

### 3. The doc's `Summary` section — free-form, user-facing

The `.md` file's first `##` section. This is what gets posted as the
script's description on repository sites, so write it for a stranger
who found the script in a search, not for us.

* Give a reader enough to decide whether they want the script: what
  the problem is (what was wrong, missing, or annoying before), and
  what the script adds or changes.
  - Don't explain all the exact details, exact wording of messages, etc, or
    other details that become obvious as soon as someone uses the feature.
* Multiple paragraphs are fine, as are tables, lists, and links.
  Formatting is free — but keep it readable top to bottom.
* If the script needs usage instructions to be useful — key bindings,
  URL parameters, configuration options — put them here, under `###`
  subsections. Anything a *user* needs goes in `Summary`; anything
  only a *maintainer* needs goes in `Implementation`.
* Don't spell out consequences the reader can infer, and don't
  narrate what the screenshots already show.
* Don't explain trivially obvious motivations. e.g. Don't bother
  explaining that popups are annoying and that's why we want to close them.
* Screenshots go at the **end** of `Summary` — see below.

## Documentation files for each userscript

Each userscript has a sibling `.md` whose `#` title is exactly the
script's `@name`, and which has three sections: `Summary`,
`Visible changes`, `Implementation`.

* **Summary**: the user-facing description — see "Naming and
  describing a script" above.
* **Visible changes**: a short bulleted list of user-visible behavior
  changes. Brief — readers should be able to scan it. Group related
  points; don't over-explain.
* **Implementation**: the longer section, written for the future
  maintainer (probably us, after the site changes and the script
  breaks). Cover:
  - What we observed about the page's DOM and behavior that the
    script depends on (selectors, attributes, structural anchors).
  - What we are assuming will stay stable.
  - How we modify the page to produce the visible changes.

  The point isn't exhaustive detail — it's enough context that
  someone can compare the doc to a future version of the site, see
  what's changed, and fix the script.

* Refer to the things we write as "userscripts", not "Tampermonkey
  scripts" or other branded names.

### Screenshots in doc files

Screenshots are optional — include them when a picture makes the
change clearer than prose (layout fixes, added UI, restyled
elements). Skip them when the change is invisible or trivially
described.

* **Location and naming.** Put images in a `screenshots/`
  subdirectory of the script's site directory:
  `sites/<site>/screenshots/`. Name them after the script:
  - `<script-basename>-before.png` / `<script-basename>-after.png`
    when there's a single pair.
  - `<script-basename>-<what>-before.png` /
    `<script-basename>-<what>-after.png` when showing more than one
    aspect, where `<what>` names the page, state, or condition.
  - A single unpaired image is just `<script-basename>.png`, or
    `<script-basename>-<what>.png`.

* **Where they go in the doc.** At the **end** of the `Summary`
  section — they're part of the user-facing description, not the
  implementation notes. (Implementation-only diagnostic images can go
  in `Implementation` instead.)
  - Keep them in one block at the end, all together, rather than
    interleaved through the prose. Repository sites like Greasy Fork
    strip the images out of the description and show them in a
    separate gallery underneath.
  - Headings above images: Format them like
    ```markdown
    **Page X before:**
    ![Before](screenshots/thing-x-before.png)
    ```
  - Headings for multiple images:
    On Greasy Fork, we just get one combined header above all the images, like
    "Pages X and Y, before and after:".
    - Put that combined heading in the doc as an HTML comment
      immediately above the image block:
      ```markdown
      <!-- image-gallery-heading: **Pages X and Y, before and after:** -->
      ```
    - Every doc with *multiple* images should have this alternate heading.
      (With just a single image, we can use the original heading as is.)

* **Extracting the description to publish.**
  `scripts/extract-description.py <doc.md>` prints the `Summary`
  section. `--no-images` gives the text to paste as the Greasy Fork
  description (images, their labels, any `<table>` layout around them,
  and any heading left empty are all removed, and the
  `image-gallery-heading` comment is appended in their place).
  `--images` lists the image files to upload, one per line, in doc
  order and resolved to full paths — ready to pass to
  `scripts/greasyfork-url.py --image-files`.

* **Labels.** Label each image with what it is — `<what> before:` /
  `<what> after:` for a pair, `Example:` for a single one — where
  `<what>` names the page or surface being shown (`Search page`,
  `Title bar`, `Activity page`). Keep it to that. Set the label
  **bold** on its own line, so it doesn't read as body text next to
  the image. (Bold rather than a markdown heading.)
  **Don't narrate what's visible in the image**; the reader is
  looking at it. Add prose only for something the picture can't say
  on its own.

* **Matching dimensions.** Capture before and after at the same width
  and height, framing the same region of the page — a pair that
  differs only in the thing that changed is far easier to compare
  than one where everything shifts. (Exception when the shape of the
  captured items changed.)

* **Borders.** Most page captures are white-on-white and dissolve
  into the doc's background with no visible edge. Add a 1px black
  border to each: `convert x.png -bordercolor black -border 1 x.png`.
  Images grow by 2px in both directions, but stay matched in size.
  Skip it for dark captures (a video player, say) — they already
  have an edge, and a black border on them is invisible.

* **Size and format.** Full-screen captures off a HiDPI display come
  in enormous (3841×1976 for one browser window). Downscale them to
  about a quarter — `convert x.jpg -resize 25% -quality 88 out.jpg`
  — which is still legible in the doc. Keep photographic content
  (video frames) as `.jpg`; UI captures of text and flat color stay
  `.png`, where it's both sharper and smaller.

* **Layout.** If the images are small, show before and after
  side-by-side in an HTML table (GitHub renders raw HTML in
  Markdown); otherwise stack them.

* **Capturing them.** The user can capture images with SeeWhatISee,
  cropping them and highlighting regions in that tool.
  If they capture full-page screenshots, you could crop them appropriately.
  Alternatively, you could capture screenshots yourself in the
  Playwright browser.

* **Framing.** Prefer screenshots focused on the relevant
  section over full-page captures, but include enough surrounding
  context that it's clear where on the page you're looking. If the
  difference isn't obvious at a glance, add a highlight (box or
  arrow) to the image.

Stacked pair:

```markdown
**Search page before:**

![Before](screenshots/fix-climb-slider-before.png)

**Search page after:**

![After](screenshots/fix-climb-slider-after.png)
```

Side-by-side pair:

```markdown
<table>
  <tr><td><b>Before</b></td><td><b>After</b></td></tr>
  <tr>
    <td><img src="screenshots/fix-climb-slider-before.png" alt="Before"></td>
    <td><img src="screenshots/fix-climb-slider-after.png" alt="After"></td>
  </tr>
</table>
```
