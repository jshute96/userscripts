# calendar.google.com: highlight local rooms

## Summary

Highlight meeting locations matching a configurable regex with a soft yellow
background in the Google Calendar event details popover, so the room in your own
building is easy to spot in a long list.

Where a location is a single comma-separated blob of many rooms, the script also
splits it into one room per line before highlighting.

## Visible changes

- Booked meeting rooms and locations matching the configured regex get a soft
  yellow background, slightly darker on hover. A room is matched on its full
  "building room floor" text, e.g. `AAA-BBB-BLDG1 Aspen 3-C`.
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

### Why `data-text` is load-bearing

Skipping the hidden label depends on recognising `span.XuJrye` — a build hash
with the same rotation risk as `iGpjxc`. Simulating that rotation (stripping the
class from the capture) shows why it needs a backstop: the label stops being
"ignorable", becomes an ordinary text leaf, and — sorting *before* the address in
document order — gets picked as the location element. The result is that the
feature silently does nothing, and a short regex highlights the invisible
`Location:` label instead. Both failure modes reproduce the original `CA` bug in
a form you cannot see on screen.

So `getLocationTextEl()` does not simply take the first leaf. It prefers the leaf
whose normalised text equals `#xDetDlgLoc`'s own `data-text`, falling back to the
first leaf only when that attribute is missing. With the cross-check in place,
deleting `XuJrye` from the capture leaves behaviour unchanged: the address still
highlights, and `/CA/i` still matches nothing.

A more general alternative — identifying visually hidden elements by their
clipped ~1×1 geometry rather than by class — was considered and rejected for now:
it cannot be verified against a saved snapshot, because Google's external CSS
does not load offline, so computed styles there do not reflect the live page.

### What we assume stays stable

- `div#xDetDlg` is the details card, and `span#rAECCd` (or any `[role="heading"]`
  inside it) is the event title.
- `div#xDetDlgLoc` is the location field, and the visible address is in a
  text-only leaf element inside it. The script finds that leaf structurally
  (`visibleTextLeaves`) rather than by class, so a hash rotation on `UfeRlc`
  does not break it.
- `#xDetDlgLoc[data-text]` holds the location string verbatim, and is used to
  pick the right leaf — see "Why `data-text` is load-bearing" below.
- `span.XuJrye` marks visually hidden label text. This is a build hash, and the
  one dependency whose failure used to be both silent and harmful; `data-text`
  is its safety net.
- Room lists inside a text location carry a capacity marker such as `(16)`,
  which is how `looksLikeRoomList()` tells a room blob from a street address.
- Each booked room is a single element holding building, room and floor, found
  via `span.iGpjxc` or via the `/meeting room/i` map-link `aria-label`, and the
  room name is repeated in an `aria-hidden` tooltip sibling that must be
  excluded.
- `#xDetDlgRoom` marks the first room row, and is used only to tell "this event
  has no rooms" apart from "the room selectors broke".

### Room resource rows

Verified against a second snapshot, of an event with two rooms booked. Each
booked room renders as:

```html
<div class="nBzcnc OcVpRe">                      <!-- one row per room -->
  <div aria-hidden="true">…inline svg building icon…</div>
  <div class="toUqff" id="xDetDlgRoom">          <!-- FIRST room row only -->
    … <div class="UfeRlc">
        <span data-is-tooltip-wrapper="true">
          <span class="iGpjxc">                  <!-- the room entry -->
            <span class="muGyXc">AAA-BBB-BLDG1</span>       <!-- building -->
            <a class="…a1YAZe…" href="https://…/?q=…"
               aria-label="Link to the meeting room Aspen in building AAA-BBB-BLDG1 on a map">
              <span>Aspen</span><span>3-C</span>            <!-- room, floor -->
            </a>
          </span>
          <div role="tooltip" aria-hidden="true">Aspen</div>
        </span>
      </div>
      <div class="AzuXid"><i …>people</i>10</div>  <!-- capacity, separate -->
  </div>
</div>
```

Three things drive the implementation:

- **`span.iGpjxc` is the unit to match and highlight.** Its text is
  `"AAA-BBB-BLDG1 Aspen 3-C"`. Its *sibling* `div[role="tooltip"]` repeats the
  room name, so matching any higher container would double-count it.
- **Rooms span several `div.nBzcnc.OcVpRe` rows, and only the first carries
  `#xDetDlgRoom`.** Scoping the search to `#xDetDlgRoom` silently drops every
  room after the first — we hit exactly that bug while writing this. The search
  is therefore dialog-wide, excluding `#xDetDlgLoc`. `OcVpRe` is not
  room-specific either: the location row of a room-less event also carries it.
- **The parts are joined with non-breaking spaces**, so a pattern typed with an
  ordinary space (`BLDG1 Aspen`) would not match the raw `textContent`. All
  regex tests run against whitespace-normalised text (`matchableText()`).

Note the capacity (`10`) renders in a separate `div.AzuXid` with a people icon,
*not* as `(10)` inside the room text. The `(N)` signature that
`looksLikeRoomList()` keys on belongs to the location-field blob format only —
the two features see different renderings and are independent. An event can have
rooms and no `#xDetDlgLoc` at all, which is the case in this snapshot.

`ROOM_BLOCK_CANDIDATES` holds the selectors, tried in order:

1. `span.iGpjxc:not(#xDetDlgLoc span)` — current, verified.
2. Map links — `a[aria-label]` matching `/meeting room/i`, taking the anchor's
   parent, which is the same span. Verified by deleting the `iGpjxc` class from
   the snapshot and confirming both rooms still highlight. Note `aria-label` is
   **localised**: this candidate only works on an English Calendar UI, and goes
   dead (leaving just the warning) in other locales.

`iGpjxc` is a rotating build hash, hence the second candidate. Finding no rooms
is *not* logged as an error, because most events book none — but if
`#xDetDlgRoom` is present and non-empty while every candidate comes up empty,
rooms exist and the selectors have broken, and that is warned about once.

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
  pattern like `CA` matches substrings. The prompt says so. Text is
  whitespace-normalised before matching, so a literal space in the pattern
  matches the non-breaking spaces Calendar uses between room name parts.
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
