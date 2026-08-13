# example.com: Installed-list helper

## Summary

Shared `@require`-able helper rather than a fixture in its own right.
Lets each example.com userscript register a bullet under a single
"Installed userscripts" section at the bottom of the page.

Exercises `@require` end to end — resolving a relative path against
the userscript's source URL, and several separately-sandboxed scripts
collaborating through the live DOM.

## Visible changes

- Adds an `<h2>Installed userscripts</h2>` and a `<ul>` at the bottom
  of `<body>` the first time a script registers itself.
- Each registering script appends one `<li>` listing its name and a
  short description of what it does.

## Implementation

### Why it exists

It's the test fixture for verifying that `@require` actually works
end-to-end through Tampermonkey. The example.com scripts are tiny
and otherwise unrelated; the shared `@require` lets them collaborate
on one DOM section.

### How scripts use it

Each script adds the directive:

```
// @require installed-list.js
```

The path is resolved relative to the userscript's source URL — for
a github raw install it picks up the sibling file in the same
directory, and for an `install-pointer` install it picks it up from
the same local directory. Tampermonkey downloads (or reads) the
file once at install time and runs it in the userscript's sandbox
immediately before the body. The body then
calls:

- `jshuteAddInstalledScript(filename, ...descriptionParts)` —
  idempotently creates the heading + `<ul>` on first call (looked
  up by ID), then appends a `<li>`. `filename` is the full
  userscript basename (e.g. `'bold-on-hover.user.js'`) and is
  rendered as inline `<code>`. Each `descriptionParts` entry may be
  a string or a DOM Node — pass `jshuteCode('Error')` to embed an
  inline `<code>` segment mid-sentence.
- `jshuteCode(text)` — returns a `<code>` element with `text` as
  its content. Use for inline code/keyword formatting inside a
  bullet description.
- `jshuteAppendAboveInstalledList(node)` — inserts arbitrary UI
  above the heading if the section already exists, otherwise appends
  to body. Used by `error-button` so the button stays visible above
  the bullet list.

### What we assume stays stable

- example.com's `<body>` is the right container for both the
  trailing installed-list and any per-script UI we add.
- Each example.com userscript runs in its own sandbox (separate
  copies of these top-level `function` declarations and constants).
  The collaboration is via the live DOM, keyed off the heading and
  list IDs.
