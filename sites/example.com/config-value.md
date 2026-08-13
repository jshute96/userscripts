# example.com: Config value with context-menu update

## Summary

Test fixture. Adds a bullet to example.com showing a
user-configurable string, set from the userscript manager's menu and
stored in GM storage.

Exercises the `add-config-setting` pattern at its simplest — one
scalar value, one menu command to set it, one to clear it — covering
GM storage round-trips and menu commands that appear and disappear
with the stored state.

## Visible changes

- A bullet under "Installed userscripts" reads
  `config-value.user.js: the message_value is: <value>`, where `<value>` is
  the saved string or *unset* (italic) when nothing is stored.
- Userscript context menu gains `Set message_value` (always) and
  `Clear message_value` (only when a value is currently stored).
  `Set message_value` opens a `window.prompt` prepopulated with the
  current value; OK saves it, Cancel leaves the existing value alone.
- After Set/Clear, the bullet updates in place to reflect the new
  state.

## Implementation

- **Storage key**: `jshute-config-message_value`. Shape: scalar string.
- **Default**: unset (no key present). Rendered as italic *unset*.
  Distinguished from the empty string by reading `GM_getValue(KEY,
  undefined)` and treating `undefined` as the sentinel — an explicit
  empty string saved by the user round-trips as `""`, not unset.
- **Validation**: value must be at least four characters long.
  Shorter inputs trigger an `alert()` and re-open the prompt
  prepopulated with the rejected text so the user can edit rather
  than retype. Loop continues until the user enters a valid value or
  cancels.
- **Menu items**:
  - `Set message_value` — always registered. Opens `window.prompt`
    prepopulated with the current value (empty string when unset).
    Cancel is a no-op; OK saves the entered string verbatim.
  - `Clear message_value` — registered only when a value is stored.
    Deletes the key, reverting the display to *unset*.
  - Menu is rebuilt via unregister/re-register after each set/clear
    so the `Clear message_value` item appears and disappears in sync
    with the saved state.

The bullet's value cell is a single `<span>` (`valueSpan`) passed as
a DOM node into `jshuteAddInstalledScript`'s variadic description
parts; `renderValue()` clears and repopulates its contents, so
updates happen in place without re-finding the `<li>`. The italic
*unset* rendering is a child `<em>` rather than markdown/text so the
emphasis survives without depending on host CSS.

### What we assume stays stable

- `document.body` exists at `@run-at document-idle`.
- Tampermonkey honours `GM_registerMenuCommand` /
  `GM_unregisterMenuCommand` and returns IDs that round-trip through
  unregister — true for the Tampermonkey versions we target.
- The shared helper's globals (`jshuteAddInstalledScript`) are
  visible in this sandbox because Tampermonkey runs @require'd files
  in the same scope as the userscript body.
