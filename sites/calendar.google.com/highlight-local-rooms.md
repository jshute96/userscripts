# calendar.google.com: highlight local rooms

## Summary

Highlight meeting locations matching a configurable regex with a soft yellow
background in the Google Calendar event details popover, so the room in your own
building is easy to spot in a long list.

Where a location is a single comma-separated blob of many rooms, the script also
splits it into one room per line before highlighting.

## Visible changes

- Locations matching the configured regex get a soft yellow background, slightly
  darker on hover.
- A location field holding a comma-separated room list is reformatted to one
  room per line. The split ignores commas inside bracketed detail lists, e.g.
  `[Video Conf, Not Wheelchair Accessible]`, and only matching lines are
  highlighted.
- Highlights track the current event: navigating straight from one card to
  another re-splits and re-evaluates rather than leaving the previous event's
  rooms on screen.
- The whole location row remains clickable (it opens Maps), including the
  injected per-room lines.
- The matching regex is set from the userscript context menu.

## Implementation

### What we observed about the page's DOM

Verified against a captured snapshot of a June 2026 month view with an event
details card open (`calendar.google.com/calendar/u/0/r/month/2026/6/1`).

1. **Details card**: the popover is `div#xDetDlg`. It stays in the DOM, hidden,
   after the popover is dismissed — presence alone does not mean it is open.
   The event title is `span#rAECCd` (`role="heading"`).

2. **Content rows**: each field is a `div.nBzcnc` row containing an
   `aria-hidden="true"` icon wrapper (inline `<svg>`, *not* a Material icon
   ligature) plus a `div.toUqff` content wrapper carrying a stable id —
   observed: `xDetDlgWhen`, `xDetDlgLoc`, `xDetDlgAtt`, `xDetDlgDesc`,
   `xDetDlgNot`, `xDetDlgPrv`. The ids are the reliable anchors; every class
   name here is a rotating build hash.

3. **Location row**, the structure the script depends on most:

   ```html
   <div class="nBzcnc …" role="button" aria-label="Open <address> in Maps">
     <div aria-hidden="true" class="zZj8Pb EaVNbc"><span …><svg>…pin…</svg></span></div>
     <div class="toUqff …" id="xDetDlgLoc" data-text="<address>">
       <span jsslot="">
         <span class="XuJrye">Location:</span>   <!-- visually hidden a11y label -->
         <div class="bgOWSb">
           <div class="UfeRlc …"><address text></div>
           <div class="AzuXid O2VjS"></div>
         </div>
       </span>
     </div>
   </div>
   ```

   Two things matter here:
   - **There is no `<a>` anchor.** The entire `div.nBzcnc` row has
     `role="button"` and a `jsaction` click handler that opens Maps, which is
     why injected child lines stay clickable.
   - **`span.XuJrye` is a visually hidden accessibility label** reading
     `Location:`. It is a generic Calendar class — the same one labels every
     chip in the month grid.

4. **Virtual DOM recycling (Wiz)**: Calendar is built on Wiz (`jsaction`,
   `jscontroller`, `jsmodel` attributes). Nodes are recycled in place rather
   than re-created, so custom classes we add can be stranded on a node that now
   holds different text. Wiz's async detail load also overwrites the location
   text after first paint, which destroys injected children but *keeps*
   attributes — so a `data-` flag is not a reliable "already formatted" marker,
   while child presence is.

### Bug this cost us once

The original version matched `targetRoomRegex` against the *container's*
`textContent`, which includes the hidden `Location:` label. With a regex as
short as `CA`, the case-insensitive match hit "Lo**ca**tion" and every event
with any location at all was highlighted. Two rules follow:

- Match only against the visible text leaves, never a container's `textContent`.
- Skip anything inside `span.XuJrye` or `[aria-hidden="true"]`.

### What we assume stays stable

- `div#xDetDlg` is the details card, and `span#rAECCd` (or any `[role="heading"]`
  inside it) is the event title.
- `div#xDetDlgLoc` is the location field, and the visible address is in a
  text-only leaf element inside it. The script finds that leaf structurally
  (`visibleTextLeaves`) rather than by class, so a hash rotation on `UfeRlc`
  does not break it. `#xDetDlgLoc[data-text]` also mirrors the raw address and
  is a useful cross-check when debugging.
- `span.XuJrye` marks visually hidden label text.
- Room lists inside a text location carry a capacity marker such as `(16)`,
  which is how `looksLikeRoomList()` tells a room blob from a street address.

### Known gap: room resource rows

`highlightRoomResources()` previously found room resource blocks via
`span.iGpjxc`. **That class no longer exists anywhere in the page** — confirmed
by the snapshot (0 occurrences), so this feature is currently inert. The
`meeting_room` Material ligature the old code's comment referred to is also
absent; detail-row icons are inline SVG.

The selector lives in `ROOM_BLOCK_CANDIDATES`, a list tried in order, with the
dead class kept as the only (legacy) entry. To fix it properly we need a
snapshot of an event that actually *has* booked room resources, to see which row
id and text element they render into. Finding no room blocks is not logged as an
error, because most events legitimately have none.

### How we modify the page

1. **Scan scheduling**: one `MutationObserver` on `document.body`
   (`childList`, `subtree`) schedules a scan via `requestAnimationFrame`, so a
   burst of mutations coalesces into one pass. Each pass first checks the card
   is actually visible (`getBoundingClientRect().height > 0` — `offsetParent`
   is null for the fixed-position popover), so we stop rescanning once the
   popover closes.

2. **Highlighting is stateless with a sweep.** Each pass records the elements it
   affirmatively highlights in a `Set`; afterwards `sweepStaleHighlights()`
   strips the class from anything else inside the card still carrying it. This
   self-heals highlights stranded by node recycling *or* by a selector that
   stopped matching — which is what removed the frozen highlights the `CA` bug
   had baked into the page.

3. **Location reformatting**: if the location text looks like a room list, it is
   split with `splitOuterCommas()` (a bracket-depth state machine) and rebuilt
   as `div[data-jshute-room-line] > span` pairs using DOM node calls only —
   `replaceChildren()` and `createElement`, never `innerHTML`, which Trusted
   Types blocks. The raw text is stashed in `dataset.jshuteRawLocation` so the
   formatting can be undone.

4. **Card-to-card navigation**: the event title is compared on each pass. On a
   change, `resetLocationFormatting()` restores the stashed raw text and drops
   our injected lines, forcing a fresh split for the new event.

5. **Styles**: injected once into `<head>`, marked with
   `data-jshute-local-room-styles`. The rule sets `color: #202124` as well as
   the yellow background — without an explicit colour, Calendar's dark theme
   renders near-white text on pale yellow.

### User configuration

- **Storage keys**: `highlight-local-rooms:room-regex` (the pattern) and
  `highlight-local-rooms:first-run-prompted` (a boolean latch).
- **Value shape**: a string holding a regular expression, compiled with the `i`
  flag and matched *anywhere* in the text — it is not anchored, so a short
  pattern like `CA` matches substrings. The prompt says so.
- **Built-in default**: `BUILDING[12]`, a placeholder that matches nobody's real
  rooms.
- **Validation**: non-empty and must compile as a `RegExp`. A failure alerts
  with the parser message and re-prompts with the rejected text prefilled.
- **Menu command**: `Set local room regex`. There is deliberately no "clear"
  command — reverting to the placeholder default has no practical use, and the
  prompt already prefills the current value for editing.
- **First run**: if nothing is stored, the prompt opens once, 500ms after load.
  The latch is set *before* prompting, so cancelling means it never asks again —
  the menu command remains the way in.
