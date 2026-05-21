# example.com: error button

## Summary

Test fixture. Adds an "Error" button to example.com whose click
handler throws an unhandled exception.

## Visible changes

- A bullet under "Installed userscripts" reads
  `error-button.user.js: adds [Error] button that throws when clicked`,
  where `[Error]` is a real `<button>` element embedded inline in
  the bullet text. The filename is rendered as inline `<code>`.
- Clicking the embedded button does nothing visible; DevTools
  console shows the thrown error.

## Implementation

The button is passed as a DOM node directly into
`jshuteAddInstalledScript`'s variadic description parts, so it
renders inside the bullet's `<li>` rather than as a separate UI
element elsewhere on the page.

The script is idempotent on `BUTTON_ID`: if the button is already
present (e.g. a Tampermonkey re-injection), it logs and returns
before re-registering. Since `jshuteAddInstalledScript` is itself
not idempotent on the bullet content, the BUTTON_ID guard is what
keeps the bullet from duplicating too.

### What we assume stays stable

- `document.body` exists at `@run-at document-idle`.
- The shared helper's globals (`jshuteAppendAboveInstalledList`,
  `jshuteAddInstalledScript`) are visible in this sandbox because
  Tampermonkey runs @require'd files in the same scope as the
  userscript body.
