# Google Maps: Correct names: Lake Ontario & Gulf of Mexico

## Summary

Google Maps shows place names according to the country it thinks you are in.
In the US, some names are wrong. Lake Ontario is labeled **Lake America**,
and the Gulf of Mexico is labeled **Gulf of America**.

This script loads Google Maps with a non-US region, so those features appear
under their original names again everywhere (map labels, info boxes, search
results, etc.)

### Choosing a region

Google shows each country its own preferred names and gives everyone else a
combined form, so there is no neutral region that renders every name plainly.
The script uses Canada by default, which is the best single answer for these
two features:

| Region | Lake Ontario | Gulf of Mexico |
| --- | --- | --- |
| `us` (default) | Lake America | Gulf of America |
| `ca` (this script) | Lake Ontario | Gulf of Mexico (Gulf of America) |
| `mx` | Lake America (Lake Ontario) | Gulf of Mexico |
| `gb` | combined form | combined form |

To use a different one, edit `REGION` at the top of the script. If you pick a
region whose language is not English, also set `REGION_LANG` to `'en'` —
otherwise `mx` will switch the whole interface to Spanish.

Only place naming changes. Your location, search ranking, and Google account
settings are untouched, and the setting applies to Maps alone rather than to
Google as a whole.

## Visible changes

* Map labels, search results, and place panels use the original names rather
  than the US-only ones.
* The address bar carries a `gl=ca` parameter on the first load of a Maps page.
* Place URLs reflect the restored name, e.g. `/maps/place/Gulf+of+Mexico+(Gulf+of+America)/`.

## Implementation

### What the page does

Region is selected by the `gl` query parameter on the Maps URL, and it is
honored on a cold request — no cookie or signed-in session is involved. The
server bakes the choice into the document it returns:

* `<html lang>` reflects it — `en` for US, `en-CA` for `gl=ca`, `es-419` for
  `gl=mx`, `en-GB` for `gl=gb`.
* Map tile requests carry a matching region token, `!3sus!` vs `!3sca!`
  (`gl=gb` maps to `uk`).
* The names in the search list and place panel are ordinary DOM text.

The map label itself is **not** in the DOM. It is rendered from the tile data
into the map canvas, so it cannot be reached by rewriting page text — which is
why this script works at the region level instead of by find-and-replace. A
text-replacement approach would fix the panels and silently do nothing to the
map.

### What we assume stays stable

* `gl` on a `/maps` URL selects the naming region, without authentication.
* The parameter survives long enough to affect the initial server render. Maps
  strips it from the address bar shortly after load via `history.replaceState`,
  but the region stays in effect for that document.
* Region does **not** persist across document loads. Every full page load
  without `gl` comes back as US, including in a tab that was showing Canadian
  names a moment earlier. It does persist across in-app SPA navigation, since
  no new document is loaded.

### How the script works

It runs at `document-start` and does one thing: if the URL has no `gl`
parameter, it rewrites the URL to add one and calls `location.replace()`.

The `gl` check doubles as the state check and the loop guard. The script only
ever redirects to a URL that carries `gl`, and such a URL fails the check on
arrival, so a second redirect cannot happen even if Google were to stop
honoring the parameter. Nothing is stored, so there is no stale state to clear.

`location.replace()` rather than `assign()` keeps the un-regionalized URL out
of history, so the back button is unaffected.

`document.documentElement.lang` looks like an appealing "am I already in the
right region?" test, but it is `null` at `document-start` — the `<html>`
element has not been parsed yet. It is only usable after `document-end`, which
is far too late to redirect without a visible flash of the wrong page. The URL
parameter is available immediately and is what the script uses.

The cost is one extra document fetch per real Maps page load. The first load is
abandoned at `document-start`, before tiles or the app bundle are requested.
In-app navigation is unaffected.
