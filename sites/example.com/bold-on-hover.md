# example.com: Bold word on hover

## Summary

Test fixture. Makes the single word under the mouse cursor bold and
red while hovering over text on example.com.

The simplest end-to-end check that a userscript is installed and
running — a change you can see the moment the page loads, without
opening DevTools. Also exercises repeated DOM mutation from a
high-frequency `mousemove` handler.

## Visible changes

- As the cursor moves over text, the word directly under it becomes
  bold and red.
- Moving to an adjacent word transfers the highlight to the new
  word; moving off text removes the highlight entirely.

## Implementation

### What the page looks like

example.com is a single static document with a few text nodes
(`<h1>`, two `<p>`s — one of which contains a `<a>`). Everything we
care about is a leaf text node inside a simple element; there's no
SPA routing, no shadow DOM, and no dynamic content insertion to
worry about. That makes it safe to mutate the DOM directly on
mousemove without needing a `MutationObserver`.

### Detecting the word under the cursor

`document.caretPositionFromPoint(x, y)` returns a `{offsetNode,
offset}` pair pointing at the text node and character offset
nearest the cursor. We fall back to the older
`document.caretRangeFromPoint` for engines that don't implement
the newer API. From that offset we scan left and right through
the text node's `.data` using a Unicode-aware word-character
regex (`/[\p{L}\p{N}'’\-]/u`) to find the word boundaries.

If the cursor isn't sitting on a word character (whitespace,
punctuation, the edge of a paragraph), we strip any existing
highlight and bail.

### Applying the highlight

We wrap the word in `<span class="jshute-bold-hover">` via
`Range.surroundContents`. On the next mousemove we unwrap it
(re-parent its children and `normalize()` the parent so adjacent
text nodes merge back) before highlighting the new word. We
explicitly no-op when the cursor moves *within* the same
highlighted word — `caretPositionFromPoint` reports the text node
inside our span, so we check `currentSpan.contains(caret.node)`
and skip.

### Styling

The highlight uses `font-weight: bold; color: #d00;` so the word
both thickens and turns red — chosen for visibility over the
earlier `text-shadow` synthetic-bold (which preserved layout but
wasn't visible enough). Real bold *does* widen the glyph and so
can shift surrounding text by a pixel or two, but in practice the
bolded word grows around the cursor's original position, so the
hit-test rect still contains the cursor and ping-pong doesn't
happen on this page.

### Performance

Mousemove fires very frequently. We coalesce events with
`requestAnimationFrame` — the handler just stashes the latest
`{x, y}` and schedules a single per-frame `process()` call that
does the caret lookup and DOM mutation. This keeps DOM churn to
~60/sec max even under rapid movement.

### What we assume stays stable

- example.com remains a static, document-mode page with normal
  text in normal elements.
- The browser supports either `caretPositionFromPoint` (Firefox,
  Chrome 128+) or `caretRangeFromPoint` (older Chromium).
- `Range.surroundContents` works on a range within a single text
  node (it would throw if the range crossed an element boundary —
  the script catches and bails).
