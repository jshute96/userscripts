# example.com: updated script

## Summary

Test fixture for detecting whether script changes are actually being
picked up. Has a `VERSION_LABEL` constant near the top of the source
file; the constant is included in this script's bullet under
"Installed userscripts".

## Visible changes

- A bullet appears under "Installed userscripts" reading
  `updated-script.user.js: change-detection probe — version 10`
  (the filename rendered as inline `<code>`; the trailing number
  tracks the current value of `VERSION_LABEL`).

## Implementation

Edit `VERSION_LABEL` in the source file, save, then reload the
target page in the browser. If the bullet text updates, change
propagation is working as expected for the current install style:

- For a `install-pointer` install, every page load re-fetches the
  source from disk, so any edit lands immediately.
- For an `install-raw` install, only `@updateURL`-driven updates
  refresh the body; an edit on disk won't appear until reinstalling.

So this script doubles as a "which install mode am I in?" diagnostic
without needing to open Tampermonkey's dashboard.

### What we assume stays stable

- The shared `jshuteAddInstalledScript` global is in scope because
  Tampermonkey runs `@require`'d files in the userscript sandbox
  before the body.
