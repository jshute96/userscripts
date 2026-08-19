# keyboard-shortcuts.js

A shared `@require` helper for userscripts that bind keyboard
shortcuts. Not a userscript itself — it has no metadata block and
isn't listed in `script_manifest.json`.

```js
// @require https://raw.githubusercontent.com/jshute96/userscripts/main/lib/keyboard-shortcuts.js
```

SourceMonkey rewrites that URL to the local file when the script is
installed from a local directory, so the same line works for both a
github-raw install and an `install-pointer` install.

## Summary

Key registration for userscripts. A binding is a key spec, a label and
a handler; the library owns dispatch and the guards every key handler
needs — no unbound modifier combinations, nothing while the user is
typing, letters matching regardless of Caps Lock.

The labels are what make it more than a dispatcher: `?` opens a help
overlay listing every shortcut registered on the page, **including
ones registered by other userscripts**.

### Usage

```js
const keys = KeyboardShortcuts.create({ tag: '[pb img]' });
keys.register('i', 'Next photo', () => jumpImage('next'));
keys.register('shift-i', 'Previous photo', () => jumpImage('prev'));
keys.logKeys();
```

`create(options)`:

| Option | Meaning |
| --- | --- |
| `tag` | Log prefix, e.g. `'[pb nav]'`. |
| `name` | Heading shown on the help screen. Defaults to the userscript's own `@name` via `GM_info`. |
| `capture` | Bind in capture phase and `stopImmediatePropagation` on handled keys, to beat a site's own bindings (Reddit's `j`/`k`). |

`register(spec, label, handler, extra)`:

* `spec` — zero or more dash-separated modifiers then one base key:
  `'j'`, `'shift-i'`, `'ctrl-alt-c'`, `'?'`.
* `label` — user-facing description, shown on the help screen.
* `extra.when` — predicate checked at keypress time. A binding whose
  `when` is false isn't handled at all, so the keystroke passes
  through to the site.
* `extra.note` — extra greyed text on the help screen, for a static
  caveat like "comments panel only".

`onUnhandledKey(cb)` fires for any keypress that passed the guards but
matched no binding. `logKeys()` prints a one-line summary generated
from the registered labels, so it can't drift from what's bound.

## Visible changes

* `?` opens a modal listing every shortcut on the page, grouped by
  which userscript registered it. Esc or a click outside closes it,
  and the site never sees that Esc.
* While the overlay is open, no other shortcut fires.
* Shortcuts are ignored while the user is typing in an `input`,
  `textarea`, `select`, or `contenteditable` — including inside an
  open shadow root.
* Letter bindings match regardless of Caps Lock.

## Implementation

### Caps Lock vs Shift

Bindings match on `e.key.toLowerCase()`, and **`shiftKey` is compared
only for single-letter keys**. That keeps `i` and `shift-i` distinct
while making Caps Lock irrelevant — reading the character case
directly would make CapsLock+i behave as Shift-I, silently reversing
the binding. Symbol keys are exempt because most of them (`?` among
them) are *produced* by shift, so requiring `shiftKey: false` would
make them unbindable.

### The cross-script registry

Each userscript runs in its own sandbox, so this file executes once
per script with its own private `bindings` array. Two scripts on the
same page can't see each other's JS state. What they do share is the
document, so the registry is a DOM node:

```html
<div id="userscript-shortcuts" hidden>
  <script type="application/json" data-userscript="Pinkbike: Keyboard comment navigation">
    [{"keys":"j","label":"Next comment"}, …]
  </script>
  <script type="application/json" data-userscript="Pinkbike: Keyboard navigation for article photos">
    [{"keys":"i","label":"Next photo"}, …]
  </script>
</div>
```

* The host div is created idempotently — whichever script loads first
  wins — and hangs off `<html>` rather than `<body>`. Registration
  happens once at load, and these scripts stay resident across SPA
  navigation; if a site replaced its `<body>` the registry would go
  with it, and nothing would rebuild it, since the other sandboxes
  finished registering long ago.
* Each script owns exactly one child, keyed by `@name`, so a re-run
  replaces its entry rather than duplicating it.
* `type="application/json"` keeps it inert: never executed, so no CSP
  concern, and out of layout.
* Only **metadata** crosses the sandbox boundary. Handlers stay
  private, which is all the help screen needs.
* Writes are batched into a microtask, so a run of `register()` calls
  produces one registry write.

### Which script renders the overlay

Every instance binds `?`, so on a page with two scripts both handlers
fire for the same keypress. `showHelp()` starts with an existence
check on `#userscript-shortcuts-help` — the first handler creates the
overlay and the rest no-op. There's no election protocol, and it
doesn't matter which one wins: the renderer reads the shared DOM
registry, so it draws every script's bindings.

The same existence check gates the keydown handler, so navigation keys
do nothing while the overlay is up.

### Overlay rendering

A `<dialog>` inside an **open shadow root** on the host div:

* The shadow boundary stops the site's CSS from reaching in.
* `showModal()` puts the dialog in the browser's top layer, so it's
  immune to z-index and stacking-context fights with the page.
* Clicking the `::backdrop` reports the dialog itself as the event
  target, which is how click-outside-to-close is detected.
* The UA draws a focus ring around the auto-focused dialog; it's
  suppressed, since nothing inside is keyboard-operable.

The overlay is removed from the DOM on close rather than hidden, so
the existence check doubles as the "is it open?" test.

### Esc is handled explicitly

`<dialog>` has a built-in Esc close, but relying on it failed in
opposite directions on two real sites:

* **NYTimes** — the dialog closed, but the keydown kept propagating
  and NYT's own Esc handler closed the comments panel behind it. One
  keystroke dismissed the help *and* what the user was reading.
* **Washington Post** — Coral suppresses the browser's default close,
  so the overlay stayed up and only a click outside dismissed it.

So the library binds Esc itself, on `window` in **capture phase**.
That's the very front of the propagation path, ahead of any
document-level handler the site registered earlier, and
`stopImmediatePropagation` keeps the site from seeing a keystroke that
was aimed at the overlay. The listener is added when the overlay opens
and removed when it closes, so Esc is left completely alone the rest
of the time.

### What we assume stays stable

Nothing site-specific — this file touches no site's DOM. It does
assume the browser supports `<dialog>.showModal()`, `attachShadow`,
`composedPath()`, and `CSS.escape`, all of which are long-settled in
Chrome.

### Known limitation

The rendering script **can't evaluate another sandbox's `when`
predicate** — those are live closures that don't cross the boundary.
So the help screen lists all registered bindings whether or not
they're currently active. Use `extra.note` for a static caveat rather
than trying to serialize live state, which would only go stale.

### Testing

There's no userscript manager in the Playwright suite, so
`test/fixtures.js` resolves `@require` itself: it parses the metadata
block, maps each URL back to a file in this repo, and concatenates the
sources ahead of the script body inside one wrapper — reproducing the
manager's rule that required code runs in the same scope immediately
before the body. It also synthesizes `GM_info` from the script's real
`@name` and `@version`.

Because each `loadUserscript` call builds its own wrapper, loading two
scripts into one page gives each its own copy of this library with the
DOM registry genuinely shared — a faithful simulation of the
two-sandbox case. `sites/pinkbike.com/keyboard-comment-navigation.spec.js`
uses that to assert `?` lists both Pinkbike scripts.
