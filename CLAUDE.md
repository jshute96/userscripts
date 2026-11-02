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

* Save userscripts for domain `example.com` in a subdirectory called `sites/example.com`.
* The filename should briefly state the main purpose.
* Each userscript has a sibling `.md` doc file with the same basename
  (e.g. `foo.user.js` and `foo.md`). See "Documentation files for each
  userscript" below.

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
  icons (into its own `site-icons/`).
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
* `add-comment-navigation-script` writes a keyboard comment-navigation
  script for a new site, using our shared libraries.
* `publish-on-GreasyFork` publishes a script to Greasy Fork (the
  userscript repository site) and updates its description and
  screenshots there. **Run it only when I ask**: it's an
  outward-facing action, and every step ends with me reviewing and
  submitting the form myself.

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
  doc (see "Documentation files" below). Name and describe it per
  "Naming and describing a script" below.
* **List it** before running it: add an entry to
  `script_manifest.json`, in site order, then run
  `scripts/update_site_icons.py <script>` and `scripts/update_readme.py`
  to fill in its icons and regenerate the README tables. See "Keeping
  the script list current" below. Only set a `category` if I ask for
  one.
* **Install:** SourceMonkey (the default) already has this directory
  installed, and the manifest entry adds the script. Run the
  `install-in-SourceMonkey` skill's `refresh-file` command once, naming
  the new script's path. For Tampermonkey, use `install-in-Tampermonkey`'s
  `install-pointer` action, so I can iterate by reloading.
* **Spec:** `sites/<site>/<name>.spec.js`, once I confirm the script
  works in my normal browser (see "Specs" below).

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
* `site_icons` — the icons shown before the script's name: its own
  `@icon`, or else the favicon of each site it runs on, as
  SourceMonkey's collections page shows them. Paths from the repo
  root, mostly into `site-icons/`. Generated; see below.
* `site_icons_pinned` — `true` keeps `site_icons` and its files as
  they are, for an icon fixed by hand. Google Calendar has one: the
  temp browser isn't logged in, and gets a plain Google icon.

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
It also rewrites each script doc's `#` title line: the script's
`site_icons`, then its `@name`. `--check` just reports what's stale,
without writing.

**`site_icons` and `site-icons/`** — generated by
`scripts/update_site_icons.py`, which starts a temp-browser `sm-dev`
run with every script and saves each one's icons (`sm-dev script N
save --include icon,site-icons`). Run it after adding a script, or
changing its `@icon` or `@match` lines, then run `update_readme.py`.
Name scripts (`update_site_icons.py sites/x/y.user.js`) to update just
those; the rest keep their icons. Site icons come from the live sites,
so a full run can also pick up a site's new favicon.

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
* **Greasy Fork won't accept a GitHub `@require`**: it wants
  libraries published on Greasy Fork or an allowlisted CDN. Our
  `lib/` files are published there (see `libraries` in
  `script_manifest.json`), but the scripts still `@require` the
  GitHub raw URLs, so **a script using `lib/` can't use Greasy
  Fork's import-from-GitHub auto-update**: the copy it fetches is
  the one with the GitHub `@require`s. Publish these by posting the
  code instead (`greasyfork-url.py new`/`update --code-file`), which
  rewrites each `lib/` `@require` to that library's
  `latest_version_url` on the way, matching it by the library's
  `github_url` in the manifest. The checked-in file is untouched
  (it keeps the GitHub URLs a local install needs), so every version
  is still posted by hand.
  - **A relative-path `@require` can't be published at all**: it only
    resolves against a local install's directory, so a Greasy Fork
    install gets a script whose helper never loads. Publishing such a
    script means inlining the helper into the posted copy.
  - `greasyfork-url.py` checks for both before it builds a form URL:
    on `import` and `--code-upload`, which hand Greasy Fork the file
    as-is, and on `--code-file` after its rewrite. A script it stops
    on is one that would have been published broken.
  - A library is published on the same forms as a script, choosing the
    `library` script type, which adds Name and Description fields (a
    `lib/` file has no metadata block to fill them from).
    `greasyfork-url.py --library lib/<name>.js` derives both from the
    file (basename, and its first `//` line) along with Additional info
    from the sibling `.md`. There's no import-from-GitHub for libraries
    at all, so every version is posted this way.
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

Every script is described at three levels of increasing length, each
written for a reader who may never see the others. All three are
user-facing: they're what shows up in the userscript manager, in
search results, and on the script's page when it's published to
[Greasy Fork](https://greasyfork.org/).

1. **`@name`**: follow the `SourceMonkey-userscripts` skill's
   `references/naming-and-describing.md`.
2. **`@description`**: the same reference.
3. **The doc's `Summary` section**: below.

Write all three as a set, and keep them consistent: the doc's `#`
title must match the `@name` (after its icons), and the doc's
`Summary` should include more details on what's in the `@description`.

When any of them changes on an existing script, update the `.md`
title and run `scripts/update_readme.py` in the same edit (see
"Keeping the script list current" above), and bump the `@version`, so
installed copies pick the new text up.

### The doc's `Summary` section

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

Each userscript has a sibling `.md` whose `#` title is the script's
site icons followed by its `@name` (`update_readme.py` writes it), and
which has three sections: `Summary`,
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
