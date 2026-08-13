# The Atlantic Games: Link to today's puzzle

## Summary

Adds a **Today's Puzzle** link on the completed-puzzle screen in The
Atlantic's games (Bracket City and its siblings).

Their page has a "Return to Puzzle" link that goes back to the one you've
already solved. There's no obvious or easy way to navigate back to today's
puzzle (from yesterday's completion screen) without navigating out and
re-entering the puzzle page.

## Visible changes

* On the puzzle-completed endsheet ("PUZZLE SOLVED!"), a "Today's
  Puzzle" link appears directly below "Return to Puzzle", right-aligned
  and styled to match it.
* The link points at the current game's URL with the `?date=` query
  param stripped, i.e. today's puzzle. It's a normal link — a full page
  load, so a stale tab left open overnight picks up the new day's
  puzzle.

## Implementation

### What The Atlantic's page looks like

The game itself runs in an iframe (`/games-embed/<game>/`), but the
**endsheet is rendered in the top-level document**, injected when the
puzzle is solved and removed when you return to the puzzle. Relevant
structure (CSS-module class names, hash suffixes rotate per deploy):

```html
<div class="GamesEndsheet_root__sOIi2" role="dialog" aria-modal="true">
  <div class="GamesEndsheet_content__vSmsb">
    <button class="GamesEndsheet_returnToPuzzle__7h1yU">
      <span>Return to Puzzle</span><svg class="GamesEndsheet_returnIcon__XpPuv">…</svg>
    </button>
    <div class="GamesEndsheet_body__4Vo_a">
      <header class="GamesEndsheet_header__lfCZj">
        <h2 class="GamesEndsheet_title__2CyeH">PUZZLE SOLVED!</h2>
        …
```

The relevant host CSS (from The Atlantic's Next.js CSS bundle):

```css
.GamesEndsheet_returnToPuzzle__7h1yU {
  text-decoration: none; border: 0; background: transparent;
  display: flex; align-items: center; gap: 6px;
  margin: 0 0 24px auto;                     /* right-aligned via auto left margin */
  font-family: "Logic Monospace", monospace;
  font-size: 14px; line-height: 16px; font-weight: 500;
  letter-spacing: .5px; color: inherit; cursor: pointer;
}
```

The date is carried purely in the query string:
`/games/bracket-city/?date=2026-07-25`. Dropping the query gives
today's puzzle, which is why the link href is just
`location.origin + location.pathname` — that derivation works for any
game under `/games/`, not just Bracket City, which is why `@match`
covers the whole games section.

### What we assume

The script will break (silently, or with a console warning) if any of
these change:

1. The endsheet root keeps a class starting `GamesEndsheet_root` and
   lives in the **top document**, not inside the game iframe. (We match
   on the prefix only — the `__sOIi2` hash rotates on every deploy.)
2. The return link stays a `<button>` whose class starts
   `GamesEndsheet_returnToPuzzle`, inside the endsheet root.
3. That button's own class supplies the typography we copy; our own
   rules only override width / margin-top / text-decoration.
4. The dateless game URL keeps serving the current day's puzzle, and
   the date stays a query param rather than moving into the path.

### What we change

At `document-idle` (and `@noframes`, since the endsheet is in the top
document):

1. **Insert once per endsheet.** `insertLink()` finds
   `[class*="GamesEndsheet_root"]`, then the
   `button[class*="GamesEndsheet_returnToPuzzle"]` inside it, and
   inserts an `<a id="atlantic-games-todays-puzzle">` immediately after
   the button with `insertAdjacentElement('afterend', …)`.
2. **Idempotency by ID.** If `document.getElementById(LINK_ID)` already
   exists we only refresh its `href` (in case a client-side navigation
   changed which game we're on). A torn-down endsheet takes our link
   with it, so `getElementById` returning null is the correct signal to
   re-insert.
3. **Styling.** We copy the live button's `className` onto the link so
   the monospace font, size and letter-spacing track the site, then add
   a `<style>` block keyed on our element's **ID** (which outranks the
   host's class rules regardless of stylesheet order) for three
   overrides:
   - `width: max-content` — the host rule right-aligns with
     `display: flex` + `margin-left: auto`. That works for a
     shrink-to-fit `<button>`, but a block-level `<a>` would stretch to
     full width and the auto margin would collapse to 0, left-aligning
     it. `max-content` restores shrink-to-fit.
   - `margin-top: -18px` — the button carries `margin-bottom: 24px`;
     pulling up 18px leaves a 6px gap so the link reads as a second
     line of the same control.
   - `text-decoration: underline` — the host button is undecorated; we
     want ours to look like a link.
4. **Watch for the endsheet.** A `MutationObserver` on `document.body`
   (childList + subtree, coalesced through `requestAnimationFrame`)
   re-runs `insertLink()`. It is deliberately never disconnected: the
   endsheet can be dismissed and shown again within one page load.
5. **URL changes.** The games section is a Next.js app, so we also
   re-run on `popstate` and on a `pushState`/`replaceState` wrapper
   event, per the SPA idiom in `CLAUDE.md`. This only matters for
   keeping the `href` current — endsheet detection is already covered
   by the observer.

### Logging

`[atlantic games] init` on load, `endsheet detected` plus
`added Today's Puzzle link -> <url>` on insertion, and a one-shot
`console.warn` if the endsheet is present but the return button doesn't
match our selector (re-armed once the endsheet goes away, so it can't
spam). There's deliberately no "still waiting" log: the endsheet
appears only when a puzzle is solved, which may be hours after load, so
its absence isn't a symptom.

### Verifying without a solved puzzle

The endsheet only exists after you solve that day's puzzle, which makes
it awkward to reach in a test browser. What worked: capture the live
page's HTML, extract the `GamesEndsheet_root` subtree into a standalone
fixture file that `<link>`s The Atlantic's
`cdn.theatlantic.com/_next/static/css/*.css` bundles, open it in the
CDP browser, inject the script body, and check the inserted link's
`getBoundingClientRect()` against the button's plus a screenshot. That
confirmed the 6px gap and that both elements' right edges line up.
