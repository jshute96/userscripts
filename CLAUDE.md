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

* NOTE: If the header changes (`@match` rules, permissions, etc), the userscript needs to be reinstalled.

## Testing

Tests run against a real browser using Playwright. Tests for a script
live next to it: `sites/<domain>/<name>.spec.js`. Shared fixtures are
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
