# <img src="../../site-icons/chrome-logo.png" width="24" height="24" alt=""> Chrome: Better JSON viewer

## Summary

Chrome has a built-in JSON viewer, but it only works on `application/json`
pages, and it shows the JSON unformatted (sometimes one long line) until you
tick its Pretty-print checkbox.

This replaces that with a viewer that pretty-prints by default, with a
checkbox to show the raw file. It also works on `.json` files served as
`text/plain` (like those served on raw.githubusercontent.com).

For it to work on `file://` URLs, "Allow access to file URLs" needs to be
enabled for your userscript manager in `chrome://extensions`.

## Visible changes

* JSON pages open indented, under a blue Pretty-print bar that replaces
  Chrome's grey one.
* `.json` files shown as plain text get the bar and formatting too.
* Invalid or already formatted JSON is left as it was, with the checkbox
  greyed out and "Parsing failed" or "Already formatted" beside it.

## Implementation

What Chrome's JSON viewer gives us (Chrome 153):

* It applies to documents whose `document.contentType` is
  `application/json` (or `application/<x>+json`), from any URL, including
  `file://` URLs ending in `.json`.
* `.json` files served as `text/plain` (raw.githubusercontent.com does
  this) get no viewer, just the same `body > pre`, so we format those too,
  going by the `.json` path.
* The light DOM is just `<body>` with a `<pre>` holding the raw JSON text,
  and an empty `<div class="json-formatter-container">`.
* The toolbar with the Pretty-print checkbox, and Chrome's formatted view,
  are in a closed shadow root on that div. `shadowRoot` is `null` and the
  checkbox isn't in the accessibility tree, so a script can't tick it.
* With the box unchecked, the viewer shows the `<pre>` text, so changing
  that text changes what's shown. With it checked, Chrome shows its own
  formatting (short arrays on one line) and hides the `<pre>`.

What we assume stays stable:

* `document.contentType` identifies JSON documents.
* The raw text is in `body > pre`.
* The toolbar is inside `.json-formatter-container`, and hiding it
  leaves the `<pre>` showing.

How we change it:

* Parse the `<pre>` text and format it with `JSON.stringify(value, null, 2)`.
  The parse keeps each number's source text (`JSON.rawJSON` in a reviver),
  so large integers and forms like `1.0` or `1e3` show as sent.
* Add a `<style>` that hides `.json-formatter-container`, removes the 20px
  `padding-top` the viewer gives the `<pre>` to clear its toolbar, and sets
  the body margin to 0 (plain-text pages have 8px) so our bar spans the
  page.
* Prepend our bar (`.json-viewer-bar`, `position: sticky`) to `<body>`. Its
  checkbox swaps the `<pre>` text between the original and the formatted
  copy. It's disabled when the formatted copy matches the original
  (trimmed), or when parsing failed.

The script matches every URL but returns at once on non-JSON documents. It
runs isolated (`@inject-into content`), since it needs nothing from the
page's world.
