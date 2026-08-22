---
name: install-in-sourcemonkey
description: Interact with the SourceMonkey chrome extension for installing or editing userscripts.
---

## Target page

SourceMonkey's control page is available at
`chrome-extension://bkgahdlbeddjginplgbipcefkefaflfa/collections.html`

The site name is a hash of the extension ID and should be consistent for any installation from unpacked files.

## Available actions

* `dashboard`: List existing scripts
  - Run `google-chrome chrome-extension://bkgahdlbeddjginplgbipcefkefaflfa/collections.html`

* `install`: Add a new script, pointing at an individual script's file.
  - Run `google-chrome chrome-extension://bkgahdlbeddjginplgbipcefkefaflfa/collections.html?add_source=/path/file.user.js`
  - Point the filename at the absolute path.
  - Update the manifest file if it exists (see below).

* `install-directory`: Add a directory source. SourceMonkey will add all scripts under that directory (up to two levels down).
  - Run `google-chrome chrome-extension://bkgahdlbeddjginplgbipcefkefaflfa/collections.html?add_source=/path/directory`
  - Point the filename at the absolute path.
  - Typically, we'd run this once, for the `userscripts` directory covering this repo.
  - After adding or removing scripts under this directory, use the `refresh` command so SourceMonkey picks up the change.

* `refresh`: Re-scan the installed sources for scripts and their targeting
  - Run `google-chrome chrome-extension://bkgahdlbeddjginplgbipcefkefaflfa/collections.html?refresh`
  - It opens a browser tab, so don't fire it speculatively — one
    refresh once the change is complete, not one per edit.
  - **Not needed after editing an existing script's body.** Only run it
    when *which* scripts run where has changed.

## Picking up edits to a script

SourceMonkey re-reads local script files on every page load, so for a
page the script *already* targets, the user just reloads the page — no
`refresh`, and nothing for us to do after an edit.

`refresh` is needed only when the set of scripts, or where they run,
changes.

That covers local `@require` files too, including a local file
overriding a remote URL (see below): reloading the page re-reads them
as well. A `@require` actually fetched over http(s) is *not* re-checked
on reload, so editing what it points at needs a `refresh`.

## Local overrides for remote `@require`s

For library development, SourceMonkey **reads local files in place of
http references**. For a script run from a local file, if a file exists
under the script's own directory — or under the directory of the
collection it came from — whose path matches any suffix of the
requested `@require` host and path, that local file is read instead of 
fetching the URL. So a shared `lib/` at the top of a scripts directory is
reachable from a script nested anywhere inside it.

Extra directories can be added to the search path on SourceMonkey's
Options page.

The effect is that a script can keep its published `@require
https://…/lib/foo.js` line unchanged and still be developed against the
local `lib/foo.js` — no path juggling between development and
publishing. Since the resolved file is local, edits to it are picked up
by a plain page reload.

## Manifest files (`script_manifest.json`)

* SourceMonkey uses `script_manifest.json` files as an alternative way to find and load userscripts.
* **Write it as an object with a `scripts` array, one entry per script,
  each with a `path` relative to the manifest's own location:**

  ```json
  {
    "scripts": [
      { "path": "sub/one.user.js" },
      { "path": "sub/two.user.js", "greasyfork": { "id": 590960 } }
    ]
  }
  ```

  A bare array (just the `scripts` value, with no wrapper) also works,
  and is what older manifests look like.

  SourceMonkey ignores every field but `path`. We use other fields for
  additional script metadata, including `greasyfork` which we use to
  record metadata if we publish scripts later.
* Sibling keys beside `scripts` are ours, not SourceMonkey's. This repo
  keeps a `libraries` list there for the shared `@require` helpers under
  `lib/` — SourceMonkey doesn't load those (they aren't userscripts),
  we just track them and where they're published.
* If `script_manifest.json` exists, update it after adding a new userscript,
  following its current format.
