---
name: publish-on-greasyfork
description: Publish or update this repo's userscripts on Greasy Fork — import from GitHub, post a standalone copy, update descriptions and screenshots, and look up published script IDs.
---

Greasy Fork (<https://greasyfork.org>) is the userscript repository site
we publish to. This skill drives its forms from the command line.

## Rules

* **Only run this when the user asks for it.** Publishing is
  outward-facing and permanent-ish; never do it as a side effect of
  writing or fixing a script.
* **Never submit a form.** Every command here *opens a prefilled page*
  in the user's browser. The user reads it over and clicks Greasy Fork's
  own button. Ask them to tell you when they've submitted, then
  continue.
* **Never run a git command with side effects here** — no `push`, no
  `commit`, no `tag`. Read-only ones (`status`, `log`, `diff`,
  `rev-parse`) are fine, and are how you check whether a push is
  needed. If one is, say what's unpushed and ask the user to push;
  don't do it for them.
* **The script has to be on GitHub first** for anything that imports or
  syncs from a raw URL — Greasy Fork fetches the file from
  `raw.githubusercontent.com`, so an unpushed commit imports the *old*
  content (or 404s).

## The three scripts

Run any of them with `--help` for the full flag list; only the typical
lines are repeated here.

| Script | Job |
| --- | --- |
| `scripts/greasyfork-scripts.py` | Look up what's published; match it to local files; record IDs in the manifest; print the GitHub raw URL a local script file lands at. Read-only against Greasy Fork (a JSON API, no login). |
| `scripts/greasyfork-url.py` | Build and open a prefilled Greasy Fork form URL (`new`, `update`, `import`). |
| `scripts/extract-description.py` | Pull the publishable description and the screenshot list out of a script's `.md` doc. |

`greasyfork-url.py` works by putting the values in the URL hash for
`sites/greasyfork.org/prefill-forms-from-hash.user.js` to read and type
into the form — so **that userscript has to be installed and enabled**
in the browser the URL opens in. Its `.md` doc has the full parameter
table and the form selectors, if a field stops filling.

## Where the IDs live

`script_manifest.json` is the list SourceMonkey loads: one entry per
script, in site order. An entry is an object with a `path`, and
SourceMonkey ignores every other field — which is where the Greasy
Fork id and URL go, on the same entry as the script they belong to:

```json
[
  { "path": "sites/feedly.com/scroll-index-to-top.user.js" },
  {
    "path": "sites/strava.com/fix-climb-slider.user.js",
    "greasyfork": {
      "id": 590960,
      "url": "https://greasyfork.org/scripts/590960-strava-fix-the-broken-climb-filter-on-segment-search"
    }
  }
]
```

A script with no `greasyfork` field hasn't been published. Don't add
the field by hand; `link` writes it from what Greasy Fork reports (see
below), and a hand-typed id that's wrong is worse than a missing one.

## Actions

### Check what's published

```bash
scripts/greasyfork-scripts.py list     # id, version, name, URL
scripts/greasyfork-scripts.py match    # local file <-> published script
```

`match` pairs them by `@name` — the only field both sides carry
verbatim — and marks with `*` any script whose local `@version`
differs from the posted one (i.e. we have changes that were never
posted). It also lists local scripts that were never published, and
published scripts with no local match.

Renaming a script's `@name` breaks the match. Re-run `link` after a
rename; the ID in the manifest is what keeps it straight.

### Publish by importing from GitHub (preferred)

The imported script keeps syncing from the raw URL, so later pushes
update it on Greasy Fork automatically — no re-upload per version.
Several scripts can go in one import.

1. **Check the scripts are pushed**, read-only:

   ```bash
   git status --short <script>...          # uncommitted changes?
   git log --oneline origin/main..HEAD     # committed but unpushed?
   ```

   If either shows something, stop and ask the user to commit and push
   — naming the files — then continue once they say it's done. Greasy
   Fork will fetch whatever is on GitHub at submit time, not what's on
   disk.

   `origin/main` is only as current as the last fetch, so treat a clean
   result as "probably fine", not proof. When it matters, ask rather
   than fetching.

2. **Open the import form**, prefilled:

   ```bash
   scripts/greasyfork-url.py import \
       sites/strava.com/fix-climb-slider.user.js \
       sites/feedly.com/sort-filter-presets.user.js \
       --sync-type automatic
   ```

   Each repo-relative path becomes the GitHub raw URL that serves it,
   built from the origin remote and the branch (`--branch`, default
   `main`). Nothing checks that the push landed — that's step 1.
   `scripts/greasyfork-scripts.py raw-url <path>` prints the same URL
   on its own, if you want to see it first.

3. **Wait for the user** to review the page and submit it, and to say
   they're done.
4. `scripts/greasyfork-scripts.py link` — re-reads the user page,
   finds the new IDs, and records them on the manifest entries.
   Confirm every script you just imported now shows an ID; if one is
   missing, say so rather than carrying on. (`link` refuses to record
   an ID for a script that isn't listed in the manifest — add it there
   first.)
5. **Set the descriptions** — the import form has no description
   field, so every script that just landed has a blank one. Run
   "Update the description and screenshots" below once per script,
   using the ID `link` recorded. The import isn't finished until
   that's done.

### Publish a standalone copy

Only use this when the script shouldn't sync from GitHub. The code is
inlined into the URL, so nothing needs to be pushed, but every future
version has to be posted by hand.

```bash
scripts/greasyfork-url.py new \
    --code-file sites/strava.com/fix-climb-slider.user.js \
    --extract-from-doc sites/strava.com/fix-climb-slider.md
```

This form *does* have a description field, so `--extract-from-doc`
fills it here and there's no follow-up pass. Once the user has
submitted, run `scripts/greasyfork-scripts.py link` to record the new
ID, as in step 4 of the import flow above.

### Update the description and screenshots

Greasy Fork keeps the description on the version form, so this is the
"post a new version" page with the code left alone (a synced script
takes its code from GitHub regardless).

```bash
scripts/greasyfork-url.py update 590960 \
    --extract-from-doc sites/strava.com/fix-climb-slider.md
```

* Take the ID from the script's manifest entry (or from `match`).
* Use `--extract-from-doc`, which uses `extract-description.py` to extract the
  description and images from the `Summary` section of the script's
  `.md` doc file.
* To see what will be posted before opening the page, run
  `extract-description.py --no-images` / `--images` on the doc, or add
  `--print` to print the URL instead of launching a browser.

### Post a new version by hand

Only use this for standalone (unsynced) scripts — a synced one picks
up the new code from GitHub on its own, once the user pushes. Bump
`@version` first.

```bash
scripts/greasyfork-url.py update 590960 \
    --code-file sites/strava.com/fix-climb-slider.user.js
```

## If images don't attach

Image uploads can't be inlined into the URL — the browser has to fetch
the file, and a `file://` fetch fails in userscript managers that run
the request from a service worker. If the images come out missing,
serve the repo over HTTP and point at that instead:

```bash
python3 -m http.server 8765 --directory .      # leave running
scripts/greasyfork-url.py update 590960 --http-base http://localhost:8765 …
```

Local paths under the repo root are then rewritten to `http://localhost:8765/…`.

## After publishing

* `link` again if anything new was posted. That edits the manifest —
  leave it staged-in-the-working-tree and tell the user; committing is
  their call, as everywhere else in this repo.
* A published script's `@name` and `@description` are what people see
  in Greasy Fork search results — if either changed, the description
  update above is what carries it over.
