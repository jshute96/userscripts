# example.com: Error button

## Summary

Test fixture. Adds two "Error" buttons to example.com whose click
handlers throw unhandled exceptions — one thrown from the script
body, one from `@require`'d library code.

Exercises how a userscript manager reports an error thrown at
runtime, and in particular whether a stack frame originating in
`@require`'d code is attributed to that file and its own line
numbers, or to an offset into the combined injected source.

## Visible changes

- A bullet under "Installed userscripts" reads
  `error-button.user.js: adds [Error] and [Error from @require] buttons
  that throw when clicked (the second from @require'd code)`, where
  both `[…]` are real `<button>` elements embedded inline in the
  bullet text. The filename is rendered as inline `<code>`.
- Clicking either button does nothing visible; DevTools console shows
  the thrown error.

## Implementation

### Why two buttons

The second one is the point of the fixture: it probes how a manager
reports **stack traces** for frames that originate in `@require`'d
code. If a manager concatenates `@require`'d files into the script's
own injected source, it then has to map such a frame back to that
library's own filename and line numbers — otherwise the frame surfaces
as an offset into the combined source. Which of those actually happens,
and in which manager, is what this fixture exists to determine; we
haven't recorded a verified answer yet.

- **Error** — the control case. The click handler calls
  `throwFromScriptBody()`, a local function in `error-button.user.js`,
  which throws. Both top frames should name `error-button.user.js`.
- **Error from @require** — the handler calls `jshuteThrowFromRequire()`
  in `error-thrower.js`, which throws one frame deeper still. If frames
  map back correctly, the top two name `error-thrower.js` at its own
  line numbers, with `error-button.user.js`'s handler beneath them.

Click both and compare. What DevTools shows (it applies the injected
entry's source map) may differ from what a manager's own log pane shows
(it parses raw `err.stack` strings, and may not). Record the observed
results here once you've run it.

### How the buttons are built

Both buttons are passed as DOM nodes directly into
`jshuteAddInstalledScript`'s variadic description parts, so they
render inside the bullet's `<li>` rather than as separate UI
elements elsewhere on the page.

The script is idempotent on `BUTTON_ID`: if that button is already
present (e.g. a re-injection), it logs and returns before
re-registering either button. `REQUIRE_BUTTON_ID` is not guarded
separately — both buttons are created together in a single pass, so
the first ID's presence implies the second's. Since
`jshuteAddInstalledScript` is itself not idempotent on the bullet
content, that one guard is also what keeps the bullet from
duplicating.

### What we assume stays stable

- `document.body` exists at `@run-at document-idle`.
- The shared helper's globals (`jshuteAppendAboveInstalledList`,
  `jshuteAddInstalledScript`) and `error-thrower.js`'s
  `jshuteThrowFromRequire` are visible in this sandbox because
  managers run @require'd files in the same scope as the userscript
  body.
