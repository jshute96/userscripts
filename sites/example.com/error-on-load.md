# example.com: Error on load

## Summary

Test fixture. Registers its bullet on example.com and then throws an
unhandled `Error`, so the script aborts partway through initial
injection.

Exercises how a manager reports a crash during injection, and
confirms that DOM changes made before the throw stick and that the
other userscripts on the page are unaffected.

## Visible changes

- A bullet `error-on-load.user.js: throws during init` appears under
  "Installed userscripts" (the filename rendered in `<code>`) — the
  script registers itself first, then throws.
- DevTools console shows `[error load] init` followed by the
  uncaught error from the throw.

## Implementation

The script's IIFE registers its bullet via
`jshuteAddInstalledScript` and *then* throws. This exercises the
"crash partway through init" case: confirm that other example.com
userscripts on the same page still register themselves normally —
each userscript runs in its own sandbox, so an uncaught throw in
one doesn't affect siblings — and that DOM mutations made before
the throw stick.

### What we assume stays stable

- Tampermonkey isolates each userscript's IIFE: an uncaught throw
  from one userscript propagates to that script's console only and
  does not affect sibling userscripts on the same page.
