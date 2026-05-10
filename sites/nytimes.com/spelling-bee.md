# NYT Spelling Bee: tweaks

## Summary

Quality-of-life tweaks for the NYT Spelling Bee puzzle page and
its Spelling Bee Buddy companion: skip splash screens, add a
toolbar link to Buddy, and show an inline definition popup when
you hover or click any found word.

## Visible changes

* "Welcome Back" splash and the rank-up "Genius / Keep playing"
  splash are auto-dismissed.
* A **Buddy ↗** link is added after **Hints ↗** in the top
  toolbar, opening the Spelling Bee Buddy companion in a new tab.
* Found words on the main page and Buddy page become interactive
  (subtle `cursor: help`).
  - Hovering a word shows an inline definition popup.
  - Clicking a word pins the popup open (works on touch / when
    hover doesn't fire); clicking outside or clicking the same
    word again dismisses it.
  - The popup includes an "Open on Cambridge Dictionary →" link
    for the full entry.

## Implementation

### What the page looks like

The Spelling Bee page renders various "moment" overlays (welcome
back, congratulations, etc.) inside containers with the class
`pz-moment` plus a moment-specific modifier. The relevant elements
for the welcome splash:

- `.pz-moment__welcome` — outer container for the "Welcome Back"
  splash. Present in the DOM whenever this splash is being shown.
- `.pz-moment__welcome .pz-moment__button.primary` — the black
  Continue button inside the splash. The visible label is
  `Continue`; the button responds to a plain `.click()` and
  triggers the page's own dismissal logic.
- `.pz-moment__congrats` — outer container for the rank-up
  ("Genius!", etc.) splash that appears when the user crosses a
  rank threshold mid-game.
- `.pz-moment__congrats .pz-moment__close_text` — a top-right
  button with text "Keep playing" inside it. A plain `.click()`
  dismisses the splash.

The splash is rendered after the main puzzle scripts hydrate, so it
isn't necessarily in the DOM at `document-idle`.

The top toolbar lives inside `.pz-toolbar-right` and contains
`Stats`, `Yesterday's Answers`, a `Hints` link, and a `More`
dropdown, in that order. The Hints link is the model we copy for
the Buddy item:

```html
<a class="pz-toolbar-button pz-toolbar-button__hints"
   href="..." target="_blank" rel="noreferrer">
  Hints<i class="pz-toolbar-icon external"></i>
</a>
```

The `.pz-toolbar-button` class supplies the typography and spacing,
and `.pz-toolbar-icon.external` is the small outgoing-link arrow
shown after the label.

The found-words panel renders each word as
`<li><span class="sb-anagram">word</span></li>` inside
`ul.sb-wordlist-items-pag`. Pangrams have an additional `pangram`
class on the span (and are rendered bold). New words are appended
to the same `<ul>` as the user finds them, without a full re-render
of the list.

The "Yesterday's Answers" modal renders each entry as
`<li data-testid="yesterdays-answer-word"><span class="check"></span><span class="sb-anagram">word</span></li>`
inside `ul.sb-modal-wordlist-items` — the `.sb-anagram` span is
still a direct child of an `<li>`, so the same `li > .sb-anagram`
selector matches it.

The Spelling Bee Buddy page is a separate Svelte app
(`https://www.nytimes.com/interactive/2023/upshot/spelling-bee-buddy.html`).
It renders **two** distinct found-word lists with **different**
markup:

**Bottom "You've already found:" tile list** — uses
`div.word-row.found`, with the word reconstructed from per-letter
divs:

```html
<div class="word-row svelte-XXXXXX found">
  <div class="word-container svelte-XXXXXX">
    <div class="word svelte-XXXXXX">
      <div class="letter svelte-XXXXXX">p </div>
      <div class="letter svelte-XXXXXX">e </div>
      ...
    </div>
  </div>
  <div class="checkbox-container ..."><button>Reveal clue</button></div>
</div>
```

**Top "You vs. Other Bee Buddy Visitors" bar-graph table** — uses
a different Svelte component, rendered as a `<table>`:

```html
<tr class="row user-found svelte-YYYYYY" aria-hidden="true">
  <td class="found-check ..."><span class="spelling-bee-icon ..."></span></td>
  <td class="word ...">hope</td>
  <td class="bar-group ...">...</td>
</tr>
```

In this table, the word is plain text inside a `<td class="word">`.
Pangrams add an extra class on the row (e.g. `.pangram`) but we
don't differentiate.

Combining the two, our buddy-page selector is
`.word-row.found, .row.user-found`. In both cases the word lives
inside a child element with class `.word`; reading
`.textContent` and stripping whitespace gives the lowercase word
in either case ("p e e p h o l e " → "peephole"; "hope" → "hope").

The `svelte-XXXXXX` suffixes are build hashes that change between
deploys, so we don't rely on them.

For the hover popup, the data source is the **Free Dictionary
API** (`https://api.dictionaryapi.dev/api/v2/entries/en/<word>`)
— JSON, no auth, no ads, and concise. The "Open on Cambridge
Dictionary" link inside the popup still points at Cambridge as
the preferred landing page when the user wants the full entry.

The API returns an array of entries, each with `word`, optional
`phonetic`, and `meanings[]` containing `partOfSpeech` and
`definitions[]` (each with `definition` and optional `example`).
A 404 means "no definitions found"; we render a fallback message
linking to the full Cambridge page in that case.

### What we assume

The script will break if any of these change:

1. The welcome-splash container keeps the class
   `pz-moment__welcome`.
2. The dismiss button stays inside that container with the classes
   `pz-moment__button primary`, and a plain `.click()` still
   dismisses the splash. Likewise the rank-up splash keeps
   `pz-moment__congrats` and a `.pz-moment__close_text` close
   button that dismisses it on click.
3. Visibility is reflected by the standard `offsetParent` /
   computed `display` / `visibility` checks (i.e. the page either
   removes the moment from the DOM or hides it via CSS, rather than
   leaving a visible-but-disabled stub).
4. The toolbar container keeps the class `pz-toolbar-right`, the
   Hints link keeps `pz-toolbar-button__hints`, and the
   `pz-toolbar-button` / `pz-toolbar-icon external` classes still
   provide the visual styling we piggy-back on for the Buddy link.
5. Each found word stays rendered as `.sb-anagram` inside an `<li>`,
   with the lowercase word as the span's text content. We also
   assume the page doesn't itself attach a click handler to the
   `.sb-anagram` span that we'd be clobbering by stopping
   propagation; the page's own per-row click affordances (e.g.
   Buddy's "Reveal clue" button) live on sibling elements, not
   the word itself.
6. On the Spelling Bee Buddy page, found-word rows keep the
   `word-row` + `found` classes, and the per-character `.letter`
   children of `.word` keep the lowercase characters as their
   text content (concatenated, with whitespace stripped, this is
   the word).
7. The Free Dictionary API
   (`https://api.dictionaryapi.dev/api/v2/entries/en/<word>`)
   stays online and free, returns a stable JSON shape, and 404s
   cleanly for unknown words.

### What we change

On `document-idle`:

1. **Initial attempt.** Run `tryDismissWelcome()` once in case the
   splash is already in the DOM.
2. **Watch for the splash.** Attach a `MutationObserver` to
   `document.documentElement` that watches childList/subtree
   mutations (to catch the moment being inserted) plus `style` /
   `class` attribute changes (to catch later visibility toggles).
   Each callback re-runs `tryDismissWelcome()`.
3. **Click Continue once visible.** `tryDismissWelcome()` looks up
   `.pz-moment__welcome`, confirms it's visible, then clicks the
   primary `.pz-moment__button` inside it. After the first
   successful click we set a `welcomeDismissed` flag so we don't
   re-trigger if the user navigates back to it within the same
   page load.
4. **Inject the Buddy toolbar link.** `tryAddBuddyLink()` finds
   `.pz-toolbar-right`, checks we haven't already injected (by
   looking for our own `.pz-toolbar-button__buddy` class), then
   builds an `<a>` with the same `pz-toolbar-button` styling plus
   the `pz-toolbar-icon external` arrow icon, and inserts it
   immediately after the Hints link via `insertAdjacentElement`.
   It re-runs from the same MutationObserver so it works even if
   the toolbar mounts after `document-idle`.
5. **Wire hover/click handlers onto the found-word elements.**
   `attachLookupHandlers()` runs in two passes:
   - **Puzzle page pass.** Iterate every `li > .sb-anagram` (this
     covers both the found-words panel and the Yesterday's Answers
     modal). Skip any `.sb-anagram` already marked with
     `data-sb-lookup-added`. For each new one, set
     `cursor: help` on the span and attach mouseenter / mouseleave
     / click listeners.
   - **Buddy page pass.** Iterate every `.word-row.found, .row.user-found`
     and find the inner `.word` element. Skip ones already marked.
     Reconstruct the word by reading `.word`'s text content with
     whitespace stripped, then attach the same handlers to the
     `.word` element directly.

   Both passes mark the word element itself (not the parent row)
   with `data-sb-lookup-added` so the MutationObserver callback
   is idempotent. The Buddy page is served from a different URL,
   so the userscript header has a second `@match` for it.

   The handlers behave as follows:
   - **Hover.** After a ~250 ms debounce, `fetchDefinition(word)`
     issues a `GM_xmlhttpRequest` to
     `https://api.dictionaryapi.dev/api/v2/entries/en/<word>`,
     parses the JSON response, and renders our own minimal HTML
     for the entries (word, phonetic, then a `meaning` section
     per part-of-speech with a numbered list of definitions and
     examples). The popup auto-hides on `mouseleave` (after a
     short grace period so the user can move into the popup
     itself).
   - **Click.** Pins the popup: shows it immediately and disables
     the auto-hide. This is the primary trigger on touch devices,
     where `mouseenter` / `mouseleave` don't fire reliably. We
     `stopPropagation` and `preventDefault` so the row's own
     handlers (e.g. Buddy's "Reveal clue" button) don't fire from
     the same click. A pinned popup is dismissed by clicking
     outside it (we listen on `document` in the capture phase) or
     by clicking the same word again, which toggles it off.

   The rendered HTML is shown inside an
   `<iframe srcdoc="...">` with
   `sandbox="allow-popups allow-popups-to-escape-sandbox"`
   (scripts off, but `target="_blank"` links can open new tabs)
   and a `<base target="_blank">` so the bottom "Open on
   Cambridge Dictionary →" link, plus any future links, open as
   new tabs. Successful results are cached in an in-memory `Map`
   keyed by word so subsequent hovers are instant; transient
   errors are evicted from the cache so they don't poison the
   session. The popup auto-positions next to the word and shares
   hide logic between the word and the popup, so the user can
   move into the popup without it disappearing.
