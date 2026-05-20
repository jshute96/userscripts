# Feedly: Sort/Filter presets

## Summary

Adds two preset buttons — "Oldest" and "Newest" — to a Feedly feed
page's header toolbar. Each button applies a paired Sort by / Filter by
combination in one click, so we don't have to walk the three-dots menu.

## Visible changes

- Two new buttons appear at the left edge of the existing toolbar
  (which sits at the top right of the feed view, next to Mark-as-read,
  Add-to-Favorites, and the three-dots menu).
- "Oldest": sets Sort by → Oldest and turns Filter by → Unread only on.
- "Newest": sets Sort by → Newest and turns Filter by → Unread only off.
- Only active on subscription/feed pages
  (`feedly.com/i/subscription/content/feed*`). The script loads on
  every Feedly page so it survives in-app navigation, but does
  nothing on non-feed paths.

## Implementation

### What we observed

- Feedly feed pages render a `.FeedPage` wrapper (previously
  `.StreamPage` — renamed in May 2026) containing a `<header>` (which
  also carries a literal `Header` class on the element itself) with a
  title section on the left and a toolbar of icon buttons on the
  right. The toolbar (in DOM order) is: Mark-as-read (with a count
  badge) → Toggle Ask AI Panel → Add to Favorites → an unlabeled icon
  → the three-dots "more" menu trigger.
- We anchor on `.FeedPage header` and fall back to `header.Header`
  in case Feedly renames the wrapper again — both are PascalCase
  React component names, not hash-suffixed, so they're as stable as
  anything we get here.
- The three-dots button is a `<button>` with
  `aria-haspopup="listbox"`. The matching `aria-controls` attribute is
  only present while the menu is open, so we cannot rely on it.
  Mark-as-read also exposes `aria-haspopup="listbox"`, but on its
  wrapping `<div role="combobox">` rather than the inner `<button>`,
  so `header button[aria-haspopup="listbox"]` uniquely targets the
  three-dots trigger.
- When the more-menu opens, its rows are `<li role="menuitem">`. Each
  row's first `<span>` holds the visible label ("Change View",
  "Filter by", "Sort by", …) and a sibling `<p>` shows the current
  value (e.g. "Oldest", "1 enabled").
- Activating "Sort by" or "Filter by" *replaces* the main menu with a
  submenu (it doesn't stack). The submenu's first `<li>` is a
  breadcrumb containing a `<button role="menuitem"
  aria-label="Back to Main Menu">` and the parent label as text;
  subsequent items are the actual options. Filter options use
  `role="checkbox"` (Sort options use `role="radio"`), with the
  visible label directly as `textContent` and current state on
  `aria-checked`. Note the visible label casing differs from what
  appears elsewhere in the UI — e.g. the main-menu summary says "1
  enabled" but the submenu reads "Unread Only" (capital O), so we
  match labels case-insensitively.
- All Feedly class names in this area are obfuscated/hashed and change
  across deploys, so we avoid them entirely.

### What we assume stays stable

- The presence of either `.FeedPage header` or a `<header>` element
  with class `Header` on subscription/feed pages.
- That the three-dots is the only `button[aria-haspopup="listbox"]`
  inside the header (other listbox comboboxes in the header use that
  attribute on a wrapping `<div>`, not on a `<button>`).
- Menu items expose their label via a child `<span>` and current value
  via a child `<p>`.
- Submenu options expose `role="radio"` (Sort) or `role="checkbox"`
  (Filter) and their `textContent` contains the visible label
  ("Oldest", "Newest", "Unread Only"). We match case-insensitively to
  absorb future capitalization changes.
- `button[aria-label="Mark as read"]` exists in the same toolbar
  container — we use it as the second anchor when locating where to
  inject our buttons.

### How we modify the page

- Feedly is a SPA, so `@match` is the site root
  (`https://feedly.com/*`) and the script self-gates on
  `location.pathname` matching `/i/subscription/content/feed*`.
  `injectButtons()` is a no-op on other paths. We also wrap
  `history.pushState`/`replaceState` (and listen for `popstate`) so
  navigations into a feed page from elsewhere in the app trigger an
  immediate re-injection attempt, not just the next mutation tick.
- A `MutationObserver` on `document.body` watches for the header
  appearing or being re-rendered (e.g. when navigating between feeds
  in this SPA). Each tick we look for a marked button via the
  `data-jshute-preset` attribute; if absent, we re-inject.
- The injection point is the smallest header descendant that contains
  both the Mark-as-read button and the three-dots button. We prepend a
  `<span>` wrapper holding two plain `<button>` elements styled
  inline (no Feedly classes). This places them visually to the left
  of Feedly's own toolbar icons.
- Clicking a preset:
  1. Ensure the more-menu is open on its main page. Three branches:
     if the main-menu "Sort by" item is already in the DOM we're done;
     if a submenu is showing we click its `aria-label="Back to Main
     Menu"` button (Feedly does not auto-return after a selection,
     and clicking the trigger from a submenu state goes back one
     level rather than fully closing); otherwise we click the
     three-dots trigger to open the menu.
  2. Find the "Sort by" `[role="menuitem"]` by its label span. If its
     `<p>` value already shows the desired value, skip; otherwise
     click it, wait for the submenu option to appear, then click the
     option ("Oldest" or "Newest"). After the click the submenu stays
     open in its post-selection state.
  3. Run step 1 again to navigate from that submenu back to the main
     menu, then click "Filter by", wait for the "Unread Only" option,
     read `aria-checked`, and click only if the state needs to flip.
  4. Dismiss the menu by dispatching `Escape` keydown events on
     `document.body` in a small loop, watching `aria-expanded` on the
     trigger until it clears. Clicking the trigger from a submenu
     state doesn't reliably close, so Escape is the only consistent
     close path.
- Each step uses a small polling helper (`waitFor`) that re-checks on
  every animation frame until a 2-second timeout. All transitions
  emit `[feedly presets]` console logs so failures (timeouts, missing
  selectors) are visible without DevTools breakpoints.
