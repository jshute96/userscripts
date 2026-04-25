---
name: tampermonkey
description: Interact with the Tampermonkey chrome extension for installing or editing usersripts.
---

## Target page

Tampermonkeys control page is avaialable at
`chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo/options.html`

The site name is a hash of the extension ID and should be consistent for everyone and across versions.

## Available actions

These can be opened in Chrome by running `google-chrome <URL>`.

* `dashboard`: List existing scripts
  `chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo/options.html#nav=dashboard`

* `new`: Create a new script
  `chrome-extension://dhdgffkkebhmkfjojejmpbldmpobfkfo/options.html#nav=new-user-script+editor`

* `install`: Open page for user to install a new script, copying content from the clipboard
  - You need to know which script. If it's not obvious which one we're working on, ask the user.
  - You need to know if the user wants to install the raw script, or a script with a pointer to the local file. If it's not clear, ask.
  - Use `install-raw` or `install-pointer` as below to copy script contents to the clipboard.
  - Tell the user "Script <name> copied to clipboard. Paste and save in the browser."
  - Open the `new` page as above.

* `install-raw`: Install a copy of the raw script contents.
  - Follow instructions in `install` above.
  - To copy the script to the clipboard, use `cat <script> | xclip -selection clipbaord`

* `install-pointer`: Install a script that dynamically loads the content from a local file.
  - Follow instructions in `install` above.
  - To copy the script to the clipboard, use `<repo-root>/scripts/convert-to-file-pointer.py <script> | xclip -selection clipbaord`
