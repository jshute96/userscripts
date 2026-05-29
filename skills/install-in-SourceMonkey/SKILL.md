---
name: install-in-sourcemonkey
description: Interact with the SourceMonkey chrome extension for installing or editing userscripts.
---

## Target page

SourceMonkey's control page is avaialable at
`chrome-extension://chrome-extension://bkgahdlbeddjginplgbipcefkefaflfa/sources.html`

The site name is a hash of the extension ID and should be consistent for any installation from unpacked files.

## Available actions

* `dashboard`: List existing scripts
  - Run `google-chrome chrome-extension://bkgahdlbeddjginplgbipcefkefaflfa/sources.html`

* `install`: Add a new script, pointing at an individual script's file.
  - Run `google-chrome chrome-extension://bkgahdlbeddjginplgbipcefkefaflfa/sources.html?add_source=/path/file.user.js`
  - Point the filename at the absolute path.
  - Update the manifest file if it exists (see below).

* `install-directory`: Add a directory source. SourceMonkey will add all scripts under that directory (up to two levels down).
  - Run `google-chrome chrome-extension://bkgahdlbeddjginplgbipcefkefaflfa/sources.html?add_source=/path/directory`
  - Point the filename at the absolute path.
  - Typically, we'd run this once, for the `userscripts` directory covering this repo.
  - After adding new scripts under this directory, use the `refresh` command so SourceMonkey finds and loads them.

* `refresh`: Refresh all loaded scripts
  - Run `google-chrome chrome-extension://bkgahdlbeddjginplgbipcefkefaflfa/sources.html?refresh`

## Manifest files (`script_manifest.json`)

* SourceMonkey uses `script_manifest.json` files as an alternative way to find and load userscripts.
* The file includes a JSON array of strings, where string is a relative path to a userscript file, starting from manifest file's directory.
* If `script_manifest.json` exists, update it after adding a new userscript.
