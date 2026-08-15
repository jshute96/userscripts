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

## Organization

* Save userscripts for domain `example.com` in a subdirectory called `sites/example.com`.
* The filename should briefly state the main purpose.
* Each userscript has a sibling `.md` doc file with the same basename
  (e.g. `foo.user.js` and `foo.md`). See "Doc files" below.

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

1. **Reproduce the starting state.** Drive the running CDP browser
   (`scripts/open-browser.sh`, port 9233) to the page they're asking
   about, and confirm you can see and inspect the controls they want
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
4. **List it in `README.md`.** Add a row to the table under
   "My userscripts", in site order — see "Keeping the script list
   current" below.
5. **Manually verify in Playwright.** Inject the script the same way
   the `loadUserscript` fixture does, confirm the button appears,
   click it, watch logs and effects. If you get stuck, stop and
   report exactly where — don't guess.
6. **Suggest install**
   - If using SourceMonkey (the default), the directory should be installed already.
     Add the new script to `./script_manifest.json` -- see below. Then run the
     `install-in-SourceMonkey` skill's `refresh` command once so
     SourceMonkey picks up the new file.
   - If using Tampermonkey, use the `install-in-tampermonkey` skill's
   `install-pointer` action, so the user can iterate by reloading.
7. **Write a Playwright spec** (`<name>.spec.js`) once the user
   confirms it works in their normal browser. The spec is for
   reproducible regression — write it after the human-confirmed pass,
   not before, so that the spec encodes a known-good state.

### Keeping the script list current

Two files list every script and both have to be updated by hand:

* **`script_manifest.json`** — the list SourceMonkey loads. One
  entry per script, in site order, each an object with a `path`
  field with the relative path from the repo root. SourceMonkey ignores other fields.
  Add the `path` by hand when adding a script.
  We also use a `greasyfork` field holding the id and URL of the script when we've published it.
  Don't update the `greasyfork` fields until publishing the script.
* **`README.md`, under "My userscripts"** — one table per `###`
  category, each with columns Script / Doc / Description and
  sorted by site directory. The Script cell links the `@name` to the
  `.user.js`; the Doc cell links the word "doc" to the `.md`; the
  Description cell is the `@description`, copied verbatim.
  - Both links are plain relative paths (`sites/<site>/<name>.md`).
  - If a `@description` contains something Markdown would eat —
    angle brackets like `<value>`, or a `|` — escape it in the
    table cell (`&lt;value&gt;`) rather than reword the header.
  - Categories group scripts that do the same job across sites
    (currently "Keyboard comment navigation"), with
    "Miscellaneous" holding everything that isn't part of such a
    family, and "Testing and experimentation" holding the
    `example.com` fixtures. A category earns its own table once
    there are a few siblings; until then the script goes in
    Miscellaneous.
  - A new category gets a sentence under the heading saying what
    its scripts have in common, so the grouping explains itself.

Update both when adding a script, removing one, or renaming its files.
Update the README row **whenever a script's `@name` or
`@description` changes**, so the table doesn't go stale.

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

The standard fix is to **broaden `@match` to the site root** and gate
behavior inside the script:

1. `@match https://site.com/*` (or the smallest prefix that covers
   every page the script *might* care about).
2. Inside the script, do an initial dispatch keyed on
   `location.pathname` and re-dispatch on URL changes.
3. Listen for both `popstate` (back/forward, bfcache restore) and a
   custom event fired from monkey-patched `pushState` / `replaceState`
   — neither of those history methods fires `popstate`, so without
   the wrapper you miss in-app navigations.

Idiom (paste at the top of any SPA script). Pick an event name
scoped to *this* script — `<script-slug>:urlchange` — so scripts
don't collide on a shared name. Each script stacks its own
history wrapper, but with 2–3 scripts on a page the cost is
negligible (a function call per `pushState`) and there's no
coordination required between scripts.

```js
const URL_CHANGE_EVENT = 'my-script:urlchange';  // <-- name to this script

function onUrlChange() {
    // dispatch on location.pathname; idempotent — handlers must
    // tolerate being called repeatedly on the same URL.
}
for (const m of ['pushState', 'replaceState']) {
    const orig = history[m];
    history[m] = function (...a) {
        const r = orig.apply(this, a);
        window.dispatchEvent(new Event(URL_CHANGE_EVENT));
        return r;
    };
}
window.addEventListener('popstate', onUrlChange);
window.addEventListener(URL_CHANGE_EVENT, onUrlChange);
onUrlChange(); // initial
```

Cleaner alternative when targeting Tampermonkey specifically: add
`// @grant window.onurlchange` to the header and listen for the
native `urlchange` event — Tampermonkey fires it on any history
mutation, no monkey-patching required. (Not portable to other
userscript managers; see the tampermonkey skill's `patterns.md` →
"SPA Navigation Handling" for the full code.) For most of our
scripts the History-API patch above is fine and we don't bother
with the grant.

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

## When a script stops working

Sites change. Triage in this order — it converges fast and avoids
re-deriving the script from scratch:

1. **Open DevTools on the affected page and look for the `[name]
   init` log.**
   - Present → @match is fine, the IIFE ran. Skip to step 2.
   - Absent → it's an installation, `@match`, or grant issue. Check
     Tampermonkey's "Installed Scripts" page; confirm the URL in
     the address bar against the `@match` pattern; check whether
     `@match` was changed since the script was last installed
     (header changes require reinstall).

2. **Find the first log line that *should* fire but doesn't.** Each
   step in the script logs on success; the gap between the last
   present log and the missing next log is where it broke. If the
   only log is `init`, the failure is in the very next step
   (usually the first selector lookup or the MutationObserver
   callback).

3. **Treat the sibling `.md` doc's "What we assume stays stable"
   section as the selector checklist.** Open DevTools console on
   the live page and run a one-liner that probes each assumed
   selector and prints which ones are non-null. The first null is
   your answer. Example:
   ```js
   ({
     wrapper:  !!document.querySelector('.FeedPage'),
     header:   !!document.querySelector('.FeedPage header'),
     moreBtn:  !!document.querySelector('header button[aria-haspopup="listbox"]'),
     markRead: !!document.querySelector('button[aria-label="Mark as read"]'),
   })
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
  `install-in-tampermonkey`) for how to trigger refresh.

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

* Default to `@noframes` in the header. Sites often embed hidden
  iframes; without `@noframes` the script
  runs in those too and you'll see init logs from contexts you
  didn't expect. Drop it only when the script genuinely needs to
  run inside iframes.

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

* React menu items often render as plain `<div>`s with `onClick`
  handlers, not `<button>`/`<a>`. From in-page JS (i.e. inside the
  userscript), calling `.click()` on the element reliably fires
  React's onClick, including for the parent menu trigger. Use this
  to chain "open menu, find item, click it" without simulating
  pointer events. (From a Playwright test runner the same
  `.click()` may not toggle the menu — keyboard activation
  `focus()` + `Enter` works there as a fallback when needed.)

* `@require` for shared helpers within a site: drop a plain `.js`
  file (no UserScript header) next to the scripts that need it and
  reference it from each script with a bare relative path, e.g.
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
  - The Playwright fixture (`loadUserscript`) strips the metadata
    block and does *not* fetch `@require`'d files. Tests that depend
    on the helper need to inject it as a separate
    `page.addInitScript` (or have the fixture extended) — none of
    our specs do this yet.

## Testing

Tests run against a real browser using Playwright. Tests for a script
live next to it: `sites/<site>/<name>.spec.js`. Shared fixtures are
in `test/fixtures.js`.

* Workflow:
  1. `scripts/open-browser.sh <url>` — launches Playwright's bundled
     Chromium with `--user-data-dir=.playwright-profile` and
     `--remote-debugging-port=9233`. Leave it running. Log in to test
     sites once; the profile persists.
  2. `npm test` — tests connect over CDP and reuse that running
     browser, so they get the logged-in session for free.

* **Don't let Playwright launch the browser.** Both system Chrome
  (`channel: 'chrome'`) and `chromium.launchPersistentContext()` set
  automation flags that Google's bot detection trips on, blocking
  sign-in. Launching the bundled Chromium binary ourselves and
  attaching via `chromium.connectOverCDP()` looks "real" to Google.
  The "Chrome for Testing" banner in the launched window is the
  visual marker that you're on the right binary.

* Use a project-specific CDP port (we use 9233) so multiple test
  browsers can run side by side without `connectOverCDP` finding the
  wrong one.

* **Site isolation must be disabled in `open-browser.sh`** via
  `--disable-features=IsolateOrigins,site-per-process`. With site
  isolation on (Chrome's default), cross-origin iframes (Feedly's
  Twitter widget, the New Tab Page's Google widgets, almost any
  third-party embed) run in their own renderer process. During
  `chromium.connectOverCDP`, Playwright calls
  `Page.createIsolatedWorld` once per frame, and for those OOPIFs
  Chrome 147 silently drops the response — the whole connect hangs
  until timeout, with no useful error. Same-process iframes respond
  synchronously, so the flag eliminates the hang at the source. If
  you're debugging a CDP hang and see `pw:protocol` stop dead on a
  `Page.createIsolatedWorld` `SEND ►` for a cross-origin frameId,
  this is what you're looking at.

* `loadUserscript` (a fixture) reads the `.user.js` file fresh on
  each test, strips the metadata block, and injects via
  `page.addInitScript` wrapped in a `load`-event listener (mirroring
  `@run-at document-idle`). Edits to the script are picked up next
  test run — no rebuild step.

* When a userscript's button handler fires off async work
  (fire-and-forget from the event handler), don't poll DOM state for
  completion — wait for a specific console log line the script emits
  on success (e.g. `[name] preset applied: foo`). Polling races with
  intermediate states; a log line is a clean signal.

* The `page` fixture forwards in-page `[name]` console logs to the
  test runner output, so userscript debug logs are visible during
  test failures without opening DevTools.

* **When Playwright itself misbehaves, drive the browser via raw
  CDP.** The running Chromium exposes a stable HTTP+WebSocket API
  at `http://localhost:9233`, completely independent of
  `chromium.connectOverCDP`. Useful endpoints:
  - `GET /json` — list all targets (pages, iframes), each with a
    `webSocketDebuggerUrl`.
  - `PUT /json/new?<url>` — open a tab navigated to that URL.
  - `GET /json/close/<id>` — close a tab. **Closing the last page
    quits Chromium on Linux**, so always leave at least one.
  - `ws://.../devtools/page/<id>` — per-page CDP session. Send
    `{id, method, params}` JSON; Node 22+ has a built-in
    `WebSocket` so no `ws` dep needed. `Runtime.evaluate` with
    `awaitPromise: true` and `returnByValue: true` covers most
    needs (inspect DOM, click elements, inject scripts). Listen
    for `Runtime.consoleAPICalled` to capture `[name]` logs.

  This was the lifeline when `connectOverCDP` was hanging on
  `Page.createIsolatedWorld` — page-level CDP doesn't go through
  Playwright's per-frame attach dance, so the same iframe that
  hung Playwright was perfectly accessible directly.

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
title and the `README.md` table row in the same edit — see "Keeping
the script list current" above — and bump the `@version`, so
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
* Multiple paragraphs are fine, as are tables, lists, and links.
  Formatting is free — but keep it readable top to bottom.
* If the script needs usage instructions to be useful — key bindings,
  URL parameters, configuration options — put them here, under `###`
  subsections. Anything a *user* needs goes in `Summary`; anything
  only a *maintainer* needs goes in `Implementation`.
* Don't spell out consequences the reader can infer, and don't
  narrate what the screenshots already show.
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
