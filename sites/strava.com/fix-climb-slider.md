# Strava: Fix climb slider

## Summary

Bug fix for broken layout on Strava's segment search page. It restores
the climb-category filter — the "Flat/Downhill … Climb" range slider —
to a horizontal layout, with the
category icons (uncategorised, 4, 3, 2, 1, HC) sitting under the slider
positions they correspond to.

Strava currently serves that widget with **no CSS at all**, so it falls
back to default block layout: the labels, the slider and all six
category icons stack in a single narrow column, and there's no way to
tell which categories the two slider handles have selected. This is
purely a styling patch — the slider itself still works, and nothing
about the search or its results is touched.

## Visible changes

* The climb-category widget lays out on one row again: **Flat/Downhill**
  label, the range slider with its category icons beneath it, then the
  **Climb** label.
* Each category icon is positioned under the exact point on the track
  where a slider handle for that category sits, so the selected band
  reads directly off the icons.
* If Strava ships the widget's CSS again, the script leaves the page
  alone and logs a console warning saying it's no longer doing anything
  and can be removed.

## Implementation

### What's actually broken

`/segments/search` renders the widget as:

```
span#ride-type
  div#segment-cat-container
    div.cat-label            "Flat/Downhill"
    div                      (no class)
      div.input-container
        div#slider-container
          div#segment-vals   jQuery UI slider, two handles
      div#segment-categories
        div.icon-container × 6  →  div.category-icon.icon-cat-{NC,4,3,2,1,HC}
        input[name=min-cat], input[name=max-cat]  (hidden)
    div.cat-label            "Climb"
```

Checked against the live stylesheets (`application-*.css` and the other
four `<link>`ed sheets on the page): there is **not one rule** matching
`#segment-cat-container`, `#segment-categories`, `.icon-container`,
`.cat-label`, `#slider-container`, `.input-container` or `#ride-type`.
The sheets still style `.category-icon` (the sprite) and `.ui-slider`
(Strava's own skin over jQuery UI), so only the widget's *layout* rules
went missing — presumably a page-specific stylesheet that stopped being
bundled into this page.

Without them everything is `display: block`, so it stacks; and because
`.inline-inputs` (the form row) is a flexbox, the column collapses to
the width of its widest text, "Flat/Downhill" — about 82px.

### How we fix it

Injected CSS, keyed off the IDs above:

* `#segment-cat-container` becomes a `flex` row with centred items, so
  the two `.cat-label`s sit either side of the slider column.
* The unclassed middle div (slider + icons) gets a starting width of
  210px, replaced in the same frame by `sizeSliderToIcons()`: it measures
  the icons and sets the column so consecutive icons sit `ICON_GAP_PX`
  (4px) apart, keeping the six levels compact instead of spread across
  the row. Because the track is narrower than its column — Strava gives
  `.ui-slider` a 5px left margin — the difference is measured rather
  than assumed. That column is named once, as `COLUMN_SELECTOR`, and the
  constant is interpolated into the stylesheet so the CSS and the
  measuring code can't drift apart.
* `#ride-type` gets `flex: 0 0 auto` so the surrounding flex row can't
  squeeze the widget back down.
* `#segment-categories` becomes a positioned box and each
  `.icon-container` is taken out of flow (`position: absolute` +
  `translateX(-50%)`), ready to be placed by script.

Then `positionIcons()` measures and places them: icon *i* of *n* goes at
`i/(n-1)` along the **measured** track box, offset relative to
`#segment-categories`. Measuring rather than assuming means the 5px left
margin Strava puts on `.ui-slider`, and any future width change, are
handled for free. A final nudge of `marginLeft + offsetWidth/2` is read
off a live `.ui-slider-handle`: Strava's skin gives handles
`width: 8px; margin-left: -6px`, so a handle is drawn about 2px left of
the value it represents, and the icons are shifted to match what's on
screen rather than the abstract percentage. Verified live: with the
range dragged to categories 2–4, both handle centres land within 1px of
the corresponding icon centres.

Both the decision below and re-alignment are driven by two triggers:

* **Window resize** — the track width comes from the layout.
* **`#ride-type`'s `style` attribute changing.** With Sport set to
  Running, Strava hides `#ride-type` inline and the slider has no
  measurable width at load; the widget can only be judged or placed once
  the Cycling switch reveals it. A `ResizeObserver` on the track was
  tried first and does **not** fire on that hidden→visible transition
  (checked in Chrome 148 — no callback at all, not even the initial
  one), so we watch the attribute Strava actually writes.

### Deciding whether it's still needed

Before touching anything, the script compares the bounding boxes of the
first two `.icon-container`s. If they share a top edge and the second is
to the right of the first, the widget is already horizontal — Strava
fixed it — and the script logs a `console.warn` and returns without
injecting its stylesheet. That's a behavioural check rather than a probe
for a specific rule, so it holds however Strava restores the layout.

The decision is **deferred while the widget is hidden**, because zero-
sized boxes can't be judged: on a Running search every icon measures
0×0, which reads as "not horizontal" and would assert the page is broken
without having observed it. So nothing is injected until `measurable()`
is true, at which point `decide()` runs once and either warns or fixes;
after that the triggers above only re-align. Deferring also has to come
*before* injection rather than after — once our own stylesheet is in,
the widget is horizontal by construction and the check can no longer
tell the two cases apart.

### What we assume stays stable

* Path `/segments/search`, server-rendered per page load.
* The element IDs and class names in the tree above, in that nesting.
* The slider is jQuery UI: `#segment-vals` is the track and
  `.ui-slider-handle` the handles, positioned by percentage along it.
* Icons appear in ascending category order and map linearly onto the
  slider's value range.
* Strava shows/hides the widget by writing `#ride-type`'s inline style.

Logging is under the `[strava-climb]` prefix: init, whether the decision
had to wait for the widget to be shown, which branch it took (vertical →
fixing, or already horizontal → warning), style injection, and icon
alignment. All four paths were checked live — Cycling/Running at load ×
Strava broken/fixed — by simulating a Strava-side fix with a stylesheet
that lays the widget out horizontally.
