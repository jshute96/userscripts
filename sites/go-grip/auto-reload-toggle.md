# go-grip: Add toggle to pause auto-reload

## Summary

[go-grip](https://github.com/chrishrb/go-grip) is a local markdown
previewer that renders files GitHub-style in the browser. It reloads
the page whenever a file in its directory changes, which can be too
often while you're trying to read.

This script adds a button beside go-grip's dark-mode toggle, with
three states:

- **On** (pressed in): the page reloads when the file changes. Click
  to turn auto-reload off.
- **Off**: the page doesn't reload. Click to turn auto-reload on.
- **Off, with a blue dot**: the file has changed since the page
  loaded. Click to reload once, leaving auto-reload off.

go-grip reloads the page when *any* file in its directory changes.
The script checks whether this page or any image it shows actually
changed, and skips the reload (or the dot) when they didn't.

Auto-reload starts on. The setting is remembered per port.

The script matches `localhost` with ports 6419 (go-grip's default) to 6422.

When go-grip runs with `--no-reload`, reloads never happen, so the
button doesn't get added.

## Visible changes

- No reload when go-grip signals a change that doesn't affect this
  page's HTML or its images.
- A reload toggle button (↻) left of the theme toggle, top right.
  - On: drawn pressed in.
  - Off: a plain button, and the page doesn't reload.
  - Off, with changes waiting: a blue dot on the button. Clicking
    reloads once; the next click turns auto-reload on.

## Implementation

go-grip's page ends with an inline script that opens a WebSocket to
`/reload_ws` and calls `location.reload()` when:

- it gets a `"reload"` message (a file changed), or
- it reconnects after the socket closed (`onopen` on a retry).

The server closes the socket after each reload message, so the client
reconnects about a second later, and that reconnect would reload too.

`location.reload` can't be overridden (it's an unforgeable property),
so the script runs at `document-start` with `@grant none` (page world)
and replaces `window.WebSocket` with a subclass. For a socket whose URL
contains `/reload_ws`, it defines `onmessage` and `onopen` on the
instance, wrapping the handler the page sets: while auto-reload is off,
a `"reload"` message or an `open` is swallowed and marks the page stale.
Other messages and other sockets pass through.

go-grip's reloader watches the whole directory and signals on any file
change. So when the page opens its reload socket, we fetch its own URL
(`cache: 'no-store'`) as a baseline, and on each reload signal fetch it
again and compare the text. go-grip renders the same HTML for the same
file (checked), and MathJax and Mermaid render client-side, so equal
text means nothing to show. Unchanged: skip the reload and clear the
dot. Changed, or either fetch failed: reload, or show the dot if off.

Images are checked too, since a changed image doesn't change the
page's HTML. For each `<img>` on the page served by go-grip (same
origin, not its own `/static/` assets), we send a `HEAD` request and
compare its `Last-Modified` with the page's load time
(`performance.timeOrigin`), so there's no baseline to fetch. go-grip's
file server sends `Last-Modified` in whole seconds, and it's on this
machine, so the clocks agree. An image now missing counts as changed
only if it loaded before. The rendered page itself has no
`Last-Modified`, which is why the HTML is compared by content.

The server only signals connected pages, and closes the socket after
each signal, so a change during the ~1s reconnect gap arrives as the
reconnect (`onopen`), which goes through the same check.

The setting is in `localStorage` under `go-grip-auto-reload`, like
go-grip's own `go-grip-theme`, so it's per origin (per port).

The button reuses the theme toggle's `theme-toggle` class (copied from
the live element) for its look, and sits 40px to its left. The
pressed look (keyed on `aria-pressed`) and the dot are our own CSS.

### What we assume stays stable

- The reload socket's URL contains `/reload_ws`, and its handlers are
  set with `ws.onmessage` / `ws.onopen` (not `addEventListener`).
- The reload message is the string `"reload"`.
- The theme toggle is `#theme-toggle`, fixed 20px from the top right
  and 32px wide.
- go-grip serves non-markdown files with `Last-Modified`.
- The page title starts with `go-grip` (used, with `#theme-toggle`, to
  check it's a go-grip page before adding the button).
- With `--no-reload`, go-grip leaves the reload script out of the page
  (it's injected by its reload middleware). We add the button only if
  a `/reload_ws` socket was opened by `DOMContentLoaded`; the inline
  script at the end of `<body>` has run by then.
