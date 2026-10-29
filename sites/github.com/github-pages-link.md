# <img src="../../site-icons/github.com.png" width="24" height="24" alt=""> GitHub: Link to github.io pages

## Summary

When a repo publishes a GitHub Pages site (`<owner>.github.io/<repo>`),
GitHub's file view has no link to a file's published copy.

This script adds a **github.io** button next to Raw on file pages,
opening the same file on the repo's Pages site. It shows only when the
site has that file.

It looks for the file at the same path on the site, which works for
sites published from the root of a branch. Sites published from a
`/docs` folder, or built by a workflow that moves files around, get no
button.

**Example:**

![Example](screenshots/github-pages-link.png)

## Visible changes

* A github.io button before Raw, in the same button group, on files
  that are on the repo's Pages site.

## Implementation

### What we observed

* **Raw** is `a[data-testid="raw-button"]`, a Primer `LinkButton`
  inside an item of a `ButtonGroup` (`div[class*="ButtonGroup-Item"]`),
  with the copy and download buttons in the same group.
* **Pages URLs**: a repo's site is `https://<owner>.github.io/<repo>/`,
  or `https://<owner>.github.io/` for the repo named
  `<owner>.github.io`. A site with a custom domain redirects there.
* **github.io 404s** tell the two cases apart by their `<title>`:
  "Site not found" when the repo has no Pages site, "Page not found"
  (or the site's own `404.html`) when the site exists but the file
  doesn't.
* **No API**: GitHub's REST API needs a login token for a repo's Pages
  settings, and its public deployments data is limited to 60 requests
  an hour per IP address, so we don't use it.

### What we assume stays stable

* The Raw button's test id, and its group item being its parent.
* The github.io URL scheme and the "Site not found" title.
* That the ref in `/blob/<ref>/<path>` is one path segment. Branch
  names can have slashes, but the ones Pages sites use (`main`,
  `gh-pages`) don't.

### How we modify the page

* On a `/<owner>/<repo>/blob/<ref>/<path>` page, once the Raw link
  names the current file (during in-page navigation the header can
  still be the previous file's), we send a `HEAD` for the file's
  github.io URL with `GM_xmlhttpRequest` (github.com's CSP blocks a
  page `fetch` there).
  - 200: we show the button, linking to the final URL after redirects.
  - 404: a `GET` of the same URL reads the 404 page. "Site not found"
    is stored in GM storage (`nosite:<owner>/<repo>`) for 12 hours, so
    the repo's other files send no requests meanwhile.
* The button is a clone of Raw, labeled `github.io`, in its own clone
  of Raw's group item, inserted before Raw's, so the group draws its
  borders.
* A `MutationObserver` (once per animation frame) handles GitHub's
  in-page navigation: our item is removed when the path changes, and
  put back if React's redraw of the header drops it.
* A failed request is logged, and the page shows no button.
