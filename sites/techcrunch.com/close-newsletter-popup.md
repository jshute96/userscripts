# TechCrunch: Auto-close the newsletter popup

## Summary

Closes TechCrunch's "Save your valuable time with TechCrunch in your
inbox" newsletter popup, as soon as it appears.

## Visible changes

* The newsletter signup modal that interrupts reading on TechCrunch is
  closed automatically the moment it appears.

## Implementation

### What TechCrunch's page looks like

The newsletter popup is rendered inside a wrapper element with a
stable class, and contains a close button identified by its
`aria-label`:

- `.hb-modal-wrp` — the outer wrapper for the modal. Present in the
  DOM whenever the popup is active.
- `.hb-modal-wrp button[aria-label="close"]` — the X / close button
  inside the modal. Clicking it triggers TechCrunch's own dismissal.

The popup is injected after page load (by TechCrunch's marketing
script), so the script cannot rely on it being present at
`document-idle`.

### What we assume

The script will break if any of these change:

1. The wrapper keeps the class `hb-modal-wrp`.
2. The close button stays a `<button>` inside `.hb-modal-wrp` with
   `aria-label="close"`, and responds to a plain `.click()`.
3. Visibility is reflected by either being detached from the DOM
   after dismissal, or by `offsetParent` / `display` /
   `visibility` changes on the wrapper.

### What we change

On `document-idle`:

1. **Initial attempt.** Run `tryClose()` once in case the modal is
   already in the DOM at script start.
2. **Watch for injection.** If the modal isn't dismissed yet, attach a
   `MutationObserver` to `document.documentElement` that watches both
   childList/subtree mutations (to catch the popup being inserted)
   and `style` / `class` attribute changes (to catch later visibility
   toggles). Each callback re-runs `tryClose()`.
3. **Close once visible.** `tryClose()` looks up `.hb-modal-wrp`,
   confirms it is visible (`offsetParent` plus computed
   `display`/`visibility`), then clicks
   `.hb-modal-wrp button[aria-label="close"]`. After clicking, it
   re-checks the wrapper: if the modal has been removed or hidden,
   we set a `dismissed` flag, disconnect the observer, and stop.
   Otherwise we log a warning and wait for the next mutation.

