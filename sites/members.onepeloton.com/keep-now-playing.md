# Peloton Player: Keep the Now-Playing song visible

## Summary

Keeps the Now-Playing song visible for the whole class.

Peloton's class player shows the current song in the top-left corner,
then fades it out after a few seconds of
mouse-idle.

This script pins the Now-Playing widget so it stays on screen, so you
can always see what's playing without using the mouse.

## Visible changes

- The album art / artist / track-name card in the top-left of the
  video player stays on screen, even after the mouse has been idle
  long enough that Peloton would normally slide it off.
- Top-right toolbar (fullscreen, captions, volume, theater-mode) is
  untouched and still auto-hides as before.
- Bottom status bar with "Power 60 / Logan Aldridge · Strength /
  kcal / END" plus the JW Player seek bar above it is untouched and
  still auto-hides as before.

## Implementation

### What we observed

- The Peloton class player at `/classes/player/<classId>` is a JW
  Player instance wrapped in Peloton's own overlay UI.
- Peloton's React code toggles a small set of class names on overlay
  containers based on its own "user inactive" timer:
  - `slide-out-when-inactive` on the song container
    (`[data-test-id="videoSongContainer"]`) and the heart-rate row.
  - `hide-when-inactive` on the top-right toolbar group and a couple
    of presently-empty backdrop divs.
- The class is **added** when controls should be hidden and
  **removed** when they should be visible. React re-renders the
  className on every toggle, so attribute-scrubbing (e.g. via
  `MutationObserver`) loses the race with React.
- The bottom status bar (Power 60 / kcal / END) is rendered *inside*
  JW Player's control bar and hides via JW Player's native
  `jw-flag-user-inactive` mechanism — independent of Peloton's
  `*-when-inactive` classes.
- CSS for the `*-when-inactive` classes lives in an external
  stylesheet (none of the inline `<style>` blocks in our captured
  snapshot define rules for them), so we couldn't read the exact
  properties — but the names imply opacity and transform-based
  animations, both of which CSS can override.

### What we assume stays stable

- `[data-test-id="videoSongContainer"]` continues to identify the
  song widget. It's an authored test-id, not a hashed style class,
  so it survives deploys.
- Peloton's hiding mechanism continues to be CSS-class-based
  (`slide-out-when-inactive`), not e.g. JS that directly mutates
  inline styles on the song container. If they switch to inline
  styles, our `!important` overrides would still beat them.

### How we modify the page

- On `document-idle`, append a single `<style>` element to
  `<head>` with one rule:

  ```css
  [data-test-id="videoSongContainer"] {
      transform: none !important;
      opacity: 1 !important;
      visibility: visible !important;
  }
  ```

  These three properties between them defeat whatever combination
  the slide-out animation uses (CSS transform, opacity transition,
  or a `visibility: hidden` end state). We deliberately don't touch
  `pointer-events` — the widget is decorative (`aria-hidden="true"`
  in the DOM) and we want clicks to pass through to the player
  underneath, matching the original behavior.

- A `<style>` override is preferable to a MutationObserver here:
  React keeps re-adding the class on every idle/active transition,
  so a JS-driven attribute scrub would fight every re-render. A
  static CSS rule wins on specificity (with `!important`) and never
  has to run again.

- Peloton is a single-page app. `@match` is broadened to
  `members.onepeloton.com/*` (rather than only
  `/classes/player/*`) so the script is registered no matter which
  page the user initially opened. The injected CSS targets a
  player-only `data-test-id`, so it's inert on non-player pages, and
  the `<style>` element stays in `<head>` across SPA navigations —
  no URL-change listener needed here.
