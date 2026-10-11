# GitHub: View HTML files inline

## Summary

GitHub shows `.md` files rendered, with a Preview / Code / Blame
switch, but has no way to show rendered `.html` files. Even the Raw
button shows the HTML source, not the rednered page.

This script adds a **Preview** view to `.html` files, selected by
default, showing the page rendered below the file header, just like
Markdown is. Code and Blame views work as before.

The page is shown without its scripts, so it can't do anything on
github.com:

* Its scripts and forms don't run. Links work when clicked: they open
  in the GitHub tab, or a new tab when the page asks for one.
* Images and styles from the same repository load, as do links to
  other files in it, which open GitHub's view of them.
* Fonts, styles and images from other sites mostly don't load.
* In-page links (like a table of contents) work.

Static pages (reports, docs, generated tables) look as they should.
Pages that use JavaScript won't show their dynamic content.

## Visible changes

* A Preview item at the start of the Preview / Code / Blame switch on
  `.html` and `.htm` files, selected when the file opens. It stays in
  the Blame view too, where it goes back to the file with the preview
  on.
* The rendered page in place of the code while Preview is selected,
  sized to its full length.

## Implementation

### What we observed

* **The file's text** is in the code view's hidden
  `textarea#read-only-cursor-text-area`, whole, with no fetch needed.
  Very large files may not get one; then we fetch the Raw link, which
  redirects to `raw.githubusercontent.com`.
* **The view switch** is `ul[aria-label="File view"]`, a Primer
  `SegmentedControl` with one `li` per view. The selected `li` has
  `data-selected`, and its `.segmentedControl-content` has
  `anchor-name: --segmented-control-current-item`, which the white knob
  is positioned against (CSS anchor positioning).
* **The code** is in `section[class*="BlobContent-module"]
  [class*="blobContentSection"]`. GitHub's CSS-module class names come
  in two forms depending on the build (`Module__name__hash` and
  `Module_hash_name`), so selectors match the two parts separately.
* **Raw** is `a[data-testid="raw-button"]`, with a
  `/<owner>/<repo>/raw/<ref>/<path>` href. Its directory is the base for
  the page's images and styles.
* **github.com's CSP** (Content-Security-Policy) is inherited by
  `srcdoc` frames. It allows only
  GitHub's own scripts, only inline styles, and images from github.com
  and a list of GitHub hosts.

### What we assume stays stable

* The textarea, the `File view` list and its `data-selected` /
  `anchor-name` styling, the `BlobContent` section, and the Raw
  button's test id.
* That GitHub keeps the header across in-page navigation (it does), so
  we take our additions out when leaving an `.html` file. The Blame view
  (`/blame/` in place of `/blob/`) keeps the same header; there,
  Preview clicks GitHub's own Code item to get back to the file, then
  turns the preview on.

### How we modify the page

* **Preview item**: a clone of one of GitHub's `li`s, prepended to the
  list. We set `data-selected` only on our own item. While previewing,
  a `<style>` of ours (switched with its `media` attribute) hides the code
  section and draws GitHub's selected item as unselected (its
  `anchor-name` off, and Primer's unselected padding and weight). We
  never change React's attributes: React reuses these `li`s for the
  next file, and a changed attribute it doesn't know about sticks.
  - Not an attribute on `<html>`: GitHub's React drops those when it
    takes over the server-rendered page, which turned a reloaded page
    back to Code. Our `<style>` elements on `<html>` survive it.
* **Header room**: in some builds the file header is `position:
  absolute` inside a sticky `.react-blob-view-header-sticky` of no
  height, and the code section leaves room for it. The pane gets a top
  margin of the header's height minus the sticky container's, so it
  isn't drawn under the header.
* **The page**: the source goes through `DOMParser` (which runs
  nothing) and is rewritten before display, so it can do nothing but
  show itself and follow clicked links. The sandbox and the CSP would
  stop most of this anyway; the rewrite doesn't lean on them alone.
  - `<script>`, `<meta http-equiv>` (refresh, CSP) and the file's own
    `<base>` are removed. Declarative shadow roots (`<template
    shadowrootmode>`) lose that attribute, so they stay inert templates
    and every link is in reach of the rewrite.
  - Our `<base>` is the raw file's directory, so relative images load
    from `github.com/<owner>/<repo>/raw/...`, which sends the user's
    cookies and so works for private repos.
  - Stylesheets from the same repo are fetched and inlined as `<style>`,
    since the CSP blocks linked ones. At most 20, one at a time: each is
    a request with the user's cookies, made just by viewing the file.
    Relative `url()`s in them are rebased onto the stylesheet's own
    `github.com/.../raw/` URL. Other sites' stylesheets, and `@import`s,
    stay blocked.
  - Links (`<a>`, `<area>`, and SVG `<a>`, set with `setAttribute`
    since SVG's `href`/`target` properties are read-only): relative ones
    resolve against the file's own GitHub page
    (`/<owner>/<repo>/blob/<ref>/<dir>/`), so they open GitHub's view
    of the file they name. Only `http(s)`, `mailto` and `#` links are
    kept; others (`javascript:`, `data:`, ...) lose their `href`. `ping`
    attributes (a POST on click) are removed. Links
    get `target="_top"` (the frame can't load github.com pages itself),
    or keep `_blank` if they had it.
* **The frame**: `<iframe sandbox="allow-same-origin allow-popups
  allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
  srcdoc=...>`. With no `allow-scripts`, nothing in it runs and forms
  are off; only a real click can follow a link, which the other three
  let through. `allow-same-origin` is safe without scripts, and
  lets us size the frame to its content (`ResizeObserver` on its root)
  and turn `#` link clicks into scrolling the GitHub page. The frame has
  `scrolling="no"` and its scroll position is reset on each resize:
  once it was seen left scrolled part-way down, hiding the top of the
  page, and there's no reason for it ever to scroll.
  - Content sized by the viewport (`min-height: 100vh` plus a margin)
    grows each time the frame does. After 30 growths in 2 seconds we
    stop resizing and go back to the height before the run started;
    the frame never exceeds 50,000px.
* **In-page navigation**: the pane is only built once the Raw link
  names the current file (the header can briefly still be the previous
  file's), and a build that finishes after the user moved on is
  dropped.
* A `MutationObserver` on `<html>` re-checks after DOM changes (once
  per animation frame), covering GitHub's in-page navigation.
