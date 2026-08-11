---
name: install-in-tampermonkey
description: Interact with the Tampermonkey chrome extension for installing or editing usersripts.
---

## Target page

Tampermonkeys control page is avaialable at
`chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo/options.html`

The site name is a hash of the extension ID and should be consistent for everyone and across versions.

## Available actions

* `dashboard`: List existing scripts
  Run `google-chrome chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo/options.html#nav=dashboard`

* `new`: Create a new script
  Run `google-chrome chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo/options.html#nav=new-user-script+editor`

* `install`: Open page for user to install a new script, copying content from the clipboard
  - You need to know which script. If it's not obvious which one we're working on, ask the user.
  - You need to know if the user wants to install the raw script, or a script with a pointer to the local file. If it's not clear, ask.
  - Use `install-raw` or `install-pointer` as below to copy script contents to the clipboard.
  - Open the `new` page as above.
  - Give the user a task formatted as a checklist: "Script <name> copied to clipboard. Paste and save in the browser."

* `install-raw`: Install a copy of the raw script contents.
  - Follow instructions in `install` above.
  - To copy the script to the clipboard, use `cat <script> | xclip -selection clipboard`

* `install-pointer`: Install a script that dynamically loads the content from a local file.
  - Follow instructions in `install` above.
  - To copy the script to the clipboard, use `scripts/convert-to-file-pointer.py <script> | xclip -selection clipboard`

* `reinstall`: Redo install steps from above to update a script.
  - This works the same, but we need to give the user an additional task:
    "After saving, remove or disable the old version."

## Picking up edits to a script

* If installed with `install-pointer` (the default during development):
  the body is re-read from the local file, so the user just reloads
  the target page. **No action needed after an edit.**
  - Exception: the metadata block lives in the *installed* stub, not
    the local file, so changes to `@match`, `@grant`, `@require` etc.
    need a `reinstall`.
* If installed with `install-raw`: the full script contents were copied
  into Tampermonkey, so *any* edit needs a `reinstall` to take effect.
