# go-grip: Add path box and Up button

## Summary

[go-grip](https://github.com/chrishrb/go-grip) is a local markdown
previewer that renders files GitHub-style in the browser. When you
browse to a directory, it shows a bare list of links.

This script adds a local bar at the top:

- **Path**: the current file or directory, relative to the one go-grip
  serves.
  Edit it and press Enter (or click **Go**) to jump to another
  directory or file.
- **Up**: go to the directory the file or directory is in.

It also lists directories first, then a blank line, then files, also adding a
`..` directory entry if this isn't the top-level directory.

The bar also shows on go-grip's "404 page not found" page, so a
mistyped path is easy to fix.

The script runs on `localhost` ports 6419 (go-grip's default) to 6422,
for running a few go-grip servers at once with `-p`. For other ports,
add an `@match` line.

## Visible changes

- A bar across the top of the page, staying in view as you scroll:
  `Path:`, a text box with the current path, and **Go** and **Up**
  buttons.
  - **Up** is disabled at the top directory.
- The listing is grouped: `..` (except at the top), directories, a
  blank line, then files.
- The same bar on go-grip's plain-text 404 page and on rendered
  markdown files. On markdown files it follows go-grip's light or dark
  theme, and go-grip's theme toggle moves up into it.

## Implementation

go-grip renders `.md` files itself and hands every other path to Go's
`http.FileServer`. For a directory with no `index.html`, that writes a
bare listing: `<!doctype html>`, a viewport `<meta>`, and a `<pre>` with
one `<a>` per entry (directories end in `/`). go-grip appends its
auto-reload `<script>` after the `<pre>`. A directory URL without the
trailing slash redirects (301) to the slash form.

We treat a page as a listing when the path ends in `/`, the document is
`text/html`, and `<body>`'s first element is a `<pre>` whose children
are all `<a>` (an empty directory is an empty `<pre>`). A missing path
gets Go's `404 page not found` as `text/plain`, which Chrome shows
inside a `<pre>`; we match it by content type and text.

To group the listing, we split the `<pre>`'s links by whether the
`href` ends in `/`, and rebuild its children as directories, a blank
line, then files, one per line, keeping Go's sorted order within each.
The original `<a>` elements are reused; nothing else holds references
to them. Outside the top directory we add an `<a href="../">..</a>`
first. The rebuilt `<pre>` must not start with a newline: the HTML
parser drops the one after `<pre>`, but a script-inserted one renders.

A rendered markdown page loads go-grip's
`<script src="/static/js/theme-switch.js">`, and has
`class="markdown-body"` on `<body>`, and go-grip's theme toggle
(`#theme-toggle`, class `theme-toggle`), fixed 20px from the top right.

On every page the bar is prepended to `<body>`, as a full-width strip
with `position: sticky; top: 0`, so it stays in view. Its controls are
32px tall, like the toggle. On markdown pages:

- We move `.theme-toggle` buttons to `top: 8px`, which puts them inside
  the strip. That includes the auto-reload script's button, which uses
  the same class. The strip keeps 104px clear on the right for both.
- `scroll-padding-top` on `<html>` keeps in-page links (headings) from
  landing under the strip.
- Dark mode follows go-grip's `data-theme` on `<body>`.

On listings and the 404 page, the strip's negative margin cancels the
body's default 8px margin.

The bar is a `<form>`, so Enter in the box submits it (a form with one text box
needs no submit button for that). **Go** and **Up** are `<a>` elements
styled as buttons, so middle-click and the context menu work natively.
Go's `href` is updated on each `input` event; Up at the top directory
has no `href`, which the CSS shows as disabled. The box shows
`location.pathname` decoded, without the leading `/`. On submit, each `/`-separated segment is encoded with
`encodeURIComponent` and joined under `/`, so spaces, `#` and `?` in
names work. **Up** strips the last path segment.

### What we assume stays stable

- Go's directory listing format: a `<pre>` of `<a>` links as the first
  element of `<body>`.
- Go's 404 body is exactly `404 page not found`, sent as `text/plain`.
- go-grip's markdown page: the `/static/js/theme-switch.js` script
  (its title is the document's own since v0.10.0), `markdown-body` and
  `data-theme` on `<body>`, and `#theme-toggle` with class
  `theme-toggle`, fixed at the top right.
