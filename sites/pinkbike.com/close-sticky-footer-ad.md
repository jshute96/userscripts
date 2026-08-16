# Pinkbike: Auto-close the sticky footer ad

## Summary

Closes the sticky ad banner that Pinkbike pins across the bottom of
every page, as soon as it appears.

## Visible changes

* The sticky footer ad that overlays the bottom of Pinkbike pages is
  closed automatically the moment it appears.

## Implementation

### What Pinkbike's page looks like

The sticky footer ad is rendered as a single container element with a
stable id, inside which a close button also has a stable id:

- `#nfs_footer` — the outer container for the sticky footer ad. Present
  in the DOM whenever the ad is active. Hidden/shown via CSS (`style`
  and `class` attributes) rather than being added/removed.
- `#sticky-footer-pb-close` — the X / close button inside the ad.
  Clicking it triggers Pinkbike's own dismissal flow.

The container is sometimes injected after `document-idle` (it is added
by the ad script, not present in the initial HTML), and may toggle
visibility several times during a page's life.

### What we assume

The script will break if any of these change:

1. The container keeps the id `nfs_footer`.
2. The close button keeps the id `sticky-footer-pb-close` and is a
   direct click target (i.e. `el.click()` is enough — no synthetic
   pointer events required).
3. Visibility toggles are reflected in `style` / `class` attribute
   changes on `#nfs_footer`, or via descendant insertions/removals
   that change `offsetParent`.

### What we change

On `document-idle`:

1. **Locate the container.** If `#nfs_footer` already exists, attach
   to it directly. Otherwise observe `document.documentElement` for
   childList/subtree mutations until the element appears, then
   disconnect that observer.
2. **Watch for visibility.** A `MutationObserver` on `#nfs_footer`
   filters for `style` and `class` attribute changes and re-runs the
   close attempt each time, since the ad can be hidden and re-shown.
3. **Close once visible.** Visibility is checked with both
   `offsetParent !== null` and `getComputedStyle(...).display`. When
   the container is visible and `#sticky-footer-pb-close` is present,
   the script clicks the close button. If the click successfully hides
   the footer, we set a `dismissed` flag, disconnect the observer, and
   stop. Otherwise we log a warning and let the observer fire again on
   the next change.
