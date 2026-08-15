---
name: install-in-sourcemonkey
description: Interact with the SourceMonkey chrome extension for installing or editing userscripts.
---

## Target page

SourceMonkey's control page is avaialable at
`chrome-extension://chrome-extension://bkgahdlbeddjginplgbipcefkefaflfa/collections.html`

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

## Picking up edits to a script

SourceMonkey re-reads local script files on every page load, so for a
page the script *already* targets, the user just reloads the page. 
`refresh` is needed for new script files or changed targeting metadata.

## Manifest files (`script_manifest.json`)

* SourceMonkey uses `script_manifest.json` files as an alternative way to find and load userscripts.
* **Write it as a flat array of objects, one per script, each with a
  `path` relative to the manifest's own location:**

  ```json
  [
    { "path": "sub/one.user.js" },
    { "path": "sub/two.user.js", "greasyfork": { "id": 590960 } }
  ]
  ```

  SourceMonkey ignores every field but `path`. We use other fields for
  additional script metadata, including `greasyfork` which we use to
  record metadata if we publish scripts later.
* If `script_manifest.json` exists, update it after adding a new userscript,
  following its current format.
