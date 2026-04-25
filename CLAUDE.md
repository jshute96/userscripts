## Organization

* Save userscripts for domain `example.com` in a subdirectory called `sites/example.com`.
* The filename should briefly state the main purpose.
* Each userscript has a sibling `.md` doc file with the same basename
  (e.g. `foo.user.js` and `foo.md`). See "Doc files" below.

## Skills

* `tampermonkey` is a public plugin with general guidance on userscript syntax and development
  - Read this for advice whenever writing or reviewing userscripts.
* `userscript` is my skill with my tools and conventions, how to install them, etc

## Tips

* When writing userscripts, add `console.log` logging to give more debugging visibility.
  - Use a short `[name]` prefix, two words at most.
  - Log when the script initializes.
  - Log when it detects the activity or finds the element it's trying to fix.
  - Log when it successfully makes a change.
  - Log any failures.

* To make a script updatable, include update URLs in the header pointing at the corresponding path in github, like:
```
// @updateURL    https://github.com/jshute96/userscripts/raw/refs/heads/main/sites/example.com/script.user.js
// @downloadURL  https://github.com/jshute96/userscripts/raw/refs/heads/main/sites/example.com/script.user.js
```

* During development, if the userscript is installed as a pointer-to-local-file, the user just needs to click Reload in the browser to get updates.

* To get scripts to update from github, increment the `@version` (in the last number field) before final commit and push.

* After creating the first version of a userscript, suggest the user install it.
  Use the `userscript` skill, and do `install-pointer` action for this script.
  Then the user can get incremental updates just by doing Reload in the browser.

## Documentation files for each userscript

Each userscript has a sibling `.md` with three sections: `Summary`,
`Visible changes`, `Implementation`.

* **Summary**: one or two sentences. Brief and scannable. Example:
  "Improve navigation on Hacker News comments pages by adding keyboard
  navigation and additional navigation links."
* **Visible changes**: a short bulleted list of user-visible behaviour
  changes. Brief — readers should be able to scan it. Group related
  points; don't over-explain.
* **Implementation**: the longer section, written for the future
  maintainer (probably us, after the site changes and the script
  breaks). Cover:
  - What we observed about the page's DOM and behaviour that the
    script depends on (selectors, attributes, structural anchors).
  - What we are assuming will stay stable.
  - How we modify the page to produce the visible changes.

  The point isn't exhaustive detail — it's enough context that
  someone can compare the doc to a future version of the site, see
  what's changed, and fix the script.

* Refer to the things we write as "userscripts", not "Tampermonkey
  scripts" or other branded names.
