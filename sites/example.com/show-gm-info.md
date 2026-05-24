# example.com: show GM_info

## Summary

Test fixture. Adds a "Show GM_info" button to example.com whose click
handler dumps the `GM_info` JSON payload as an indented text blob
under the bullet.

## Visible changes

- A bullet under "Installed userscripts" reads
  `show-gm-info.user.js: adds [Show GM_info] button`, where
  `[Show GM_info]` is a real `<button>` element embedded inline in
  the bullet text.
- Clicking the button appends an indented `<pre>` to the bullet's
  `<li>` containing `JSON.stringify(GM_info, null, 2)`. Clicking
  again removes it (toggle).

## Implementation

The button is passed as a DOM node directly into
`jshuteAddInstalledScript`'s variadic description parts, so it
renders inside the bullet's `<li>`. The click handler finds that
enclosing `<li>` via `button.closest('li')` and appends/removes the
`<pre>` there — no reference passing or helper changes required.

`@grant GM_info` is requested explicitly. Tampermonkey exposes
`GM_info` even with `@grant none`, but the explicit grant documents
the dependency and is portable to other userscript managers.

The script is idempotent on `BUTTON_ID`: if the button is already
present (e.g. a re-injection) it logs and returns before
re-registering. The output `<pre>` is idempotent on `OUTPUT_ID`:
the click handler toggles between "create" and "remove" based on
whether it already exists in the DOM.

### What we assume stays stable

- `document.body` exists at `@run-at document-idle`.
- The shared helper's globals (`jshuteAddInstalledScript`) are
  visible in this sandbox because Tampermonkey runs @require'd
  files in the same scope as the userscript body.
- `GM_info` is a plain JSON-serializable object (Tampermonkey
  populates it with strings/numbers/nested objects — no cycles or
  exotic values that would break `JSON.stringify`).
