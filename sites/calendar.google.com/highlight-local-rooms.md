# calendar.google.com: highlight local rooms

## Summary

Highlight rooms that belong to the user's local building with a soft yellow background in the Google Calendar event details popover. This handles both standard room resource lists and complex, auto-populated, comma-separated custom text location lists, with full resilience against dynamic card navigation and Virtual DOM node-recycling page updates.

## Visible changes

- **Room Resource Highlights**: Meeting rooms matching the configured pattern listed under a calendar event (e.g., `BLDG-1`) are automatically highlighted with a soft yellow background.
- **Location List Reformatting & Highlights**:
  - When an event features a massive, single-line comma-separated list of room resources in its "Location" text field (represented with a maps pin icon), the list is automatically reformatted into one room per line.
  - The split correctly ignores commas inside details brackets, e.g. `[Video Conf, Not Wheelchair Accessible]`.
  - Only the individual lines matching the local building prefix regex (e.g., `/BUILDING[12]/i`) are highlighted with a soft yellow background.
- **Dynamic Stability**: Highlighting and split-formatting remain 100% accurate and visually stable across dynamic page refreshes, fast async card details loading, and direct navigation from one event to another.
- **Hover Effects**: The highlighted text blocks transition to a slightly darker yellow highlight on hover.
- **Link Integrity**: Clickable map links remain fully functional on all rooms.

## Implementation

### What we observed about the page's DOM

1. **Details Dialog Anchor**:
   - The event details popover resides under the static ID `#xDetDlg`.
   - Popover data (rooms, description, locations) loaded via APIs is populated into this dialog asynchronously.

2. **Rooms List Wrapper (Resource Bookings)**:
   - Meeting room resource bookings are listed inside standard detailed row layouts: `div.nBzcnc.OcVpRe`.
   - Every room text block is wrapped in a standard sub-wrapper: `span.iGpjxc`.

3. **Location Field Wrapper (Custom Text Fields)**:
   - A custom text location (address or combined room text) shows up under a maps pin icon within `div#xDetDlgLoc`.
   - The text itself is contained inside a standard navigation anchor: `a.a1YAZe`.

4. **Virtual DOM Node Recycling (Wiz Framework)**:
   - Google Calendar uses Wiz as its web framework (observable in DevTools via `jsaction`, `jscontroller`, and `jsmodel` attributes). Wiz uses an in-place Virtual DOM recycling pattern. When navigating directly between card pages or loading card data dynamically, DOM node wrappers (like `span.iGpjxc` rows) are **reused in-place** and their text contents are mutated rather than detaching/re-rendering.
   - In-place row updates preserve custom styling classes that Wiz does not manage, leading to **stale highlights** (e.g. a remote room loaded into a recycled DOM node previously carrying a local room match keeps its yellow background capsule!).

5. **Asynchronous Double-Loads**:
   - When first opening a details card, Wiz does a fast first-paint placeholder load, followed by a dynamic API detail load that completely **overwrites** the location link text content with the raw comma-separated value, wiping out any manual DOM formatting we injected.

### What we assume stays stable

- The event details popover container has the static ID `#xDetDlg`.
- The event title heading inside the popover is rendered under `#rAECCd` (or `[role="heading"]`).
- The list rows in the popover carry the global detailed row class combination `.nBzcnc.OcVpRe`.
- Meeting room text wrappers inside standard list rows use the parent container `span.iGpjxc`.
- The text location is contained inside `div#xDetDlgLoc` and wraps a child anchor `a.a1YAZe`.
- Meeting room lists inside the text location field contain capacity parameters (e.g., `(16)`, `(8)`), serving as a unique signature.
- The target local building code is matched case-insensitively using a configurable regular expression (defaulting to `/BUILDING[12]/i`).

### How we modify the page

#### 1. Mutation Tracking & Performance Coalescing
- A global `MutationObserver` on `document.body` monitors all subtree changes while `#xDetDlg` is visible.
- Since all DOM write blocks are fully stateless, our own writes trigger the observer exactly once recursively and then settle, preventing infinite loops without complex observer filtering.
- An 8-second diagnostic alert timer is set on startup: if `#xDetDlg` is not visible within 8 seconds, it logs a warning message to prove the script successfully initialized and is actively listening.

#### 2. Highlights on Room Resource Rows
- We search `#xDetDlg` for all room resource text blocks *outside* the text location field using the exclusion selector:
  `span.iGpjxc:not(#xDetDlgLoc span)`
- This targets the room text wrappers directly, working seamlessly whether the room text contains an embedded map link or plain text.
- **Stateless Self-Healing**:
  - If the text matches `/BUILDING[12]/i`, we add the highlight class `jshute-local-room-highlight`.
  - If the text does **not** match, we aggressively **strip the class**! This immediately heals any stale highlights caused by Wiz's cell recycling when a remote room overwrites a recycled room cell.

#### 3. Reformatting & Highlights on Text Locations
- We find the location element inside `#xDetDlgLoc` (targeting the link anchor `a` if present, or falling back to the element itself if unlinked plain text).
- **Wiz Double-Load Resiliency (DOM-Stateful Check)**:
  - Instead of stashing a static dataset state marker on the link (which is easily bypassed when Wiz performs dynamic asynchronous overwrites), we check if the link already contains **child DOM line spans**:
    `const hasChildLines = link.querySelector('div, span') !== null;`
  - If child lines exist, the link is already in a reformatted state, so we exit immediately.
  - If no child lines exist, it is a raw text block. This triggers a split and format pass, successfully capturing and repairing Wiz's dynamic asynchronous rewrites.
- **Splitting and Highlighting**:
  - We run a state-machine parser `splitOuterCommas(str)` that splits the list on commas *only* outside of matching square brackets `[...]`.
  - We clear the anchor using `replaceChildren()` (complying with Trusted Types policies by avoiding `innerHTML` sinks) and re-render individual inline-block lines (`span.jshute-room-line` wrapped in block-level `div` containers).
  - Only matching lines get the `jshute-local-room-highlight` class.
  - For single text locations, we highlight the anchor itself if local matches, or cleanly strip highlights on non-matches.

#### 4. Active Card-to-Card Transition Resets
- Wiz reuses the entire details card DOM tree in-place when clicking directly from one event to another.
- We monitor the heading text content of the dialog (`#rAECCd`). If the event title changes, it triggers a **state reset**, dynamically cleaning up last processed values to ensure the new event card renders the location list accurately.

#### 5. Stylings Integration
- A style sheet is dynamically added to `<head>`:
  - `.jshute-local-room-highlight` sets background to `#fff9c4 !important` (soft material yellow).
  - `.jshute-local-room-highlight:hover` sets background to `#fff59d !important` (hover state feedback).

### User Configuration

The target room matching regular expression is fully user-configurable at runtime, allowing users to target any building prefix or specific room names.

- **Storage Key**: `highlight-local-rooms:room-regex`
- **Value Shape**: Scalar string representing a regular expression pattern. The pattern is matched case-insensitively (using flag `i`).
- **Built-in Default**: `"BUILDING[12]"` (matches Building 1 and Building 2).
- **Validation Rules**:
  - Cannot be empty.
  - Must compile as a valid JavaScript regular expression. An invalid pattern will display a follow-up warning alert showing the RegExp parser error message, and loop back to re-prompt the user with their rejected value.
- **First-run Onboarding Prompt**:
  - If the script initializes on a page and detects that no setting has been configured yet, it **automatically launches the onboarding setup prompt** after a tiny rendering buffer (500ms). This ensures that new users are directed to configure their local room matcher immediately upon first usage.
- **Context Menu Command**:
  - **Set local room regex**: A static command available on the extension context dropdown that manually triggers the prompter. If verified, updates the active regex matcher and dynamically applies/removes highlighting in-place on any open details card immediately without reloading.
