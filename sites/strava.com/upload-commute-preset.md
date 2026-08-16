# Strava Upload: One-click defaults for my preferred commute settings

## Summary

I always set the same defaults for the commutes I upload.
This adds a *Set* button next to `Commute` to set them in one click.

The defaults are set at the top of the script:

```js
const SET_COMMUTE = true;
const GEAR_NAME = 'Trek Domane';
const VISIBILITY = 'only_me';
```

`GEAR_NAME` is the bike as it's named in the upload page's Bike drop-down.
`VISIBILITY` is one of `everyone`, `followers_only`, or `only_me`.

## Visible changes

* A **Set** button appears beside the Commute tag on each activity form on the
  upload page (one form per uploaded file).
* Clicking it ticks Commute, selects the configured bike, and selects the
  configured privacy setting.
* Settings already at their target value are left untouched; the console logs
  which ones were changed and which were skipped.

## Implementation

### What the page looks like

`https://www.strava.com/upload/select` renders one `<form class="good">` per
uploaded file, inside `#uploadProgress ul.uploads li`. A hidden
`<script id="activity-template" type="text/template">` holds the markup used to
build each one — because it lives inside a `<script>`, `querySelectorAll` never
sees it, so the script doesn't have to exclude it.

Everything the script touches is scoped to one of those forms:

* **Commute tag** —
  `input[type="checkbox"][name="activity[tags][]"][value="Commute"]`.
  All the tag pills share that `name`; only `value` distinguishes them. Each
  sits in a `div.input-field` that Strava shows or hides depending on the
  activity type (`data-tag-sports` lists the sports the tag applies to).
* **Bike** — `div.drop-down-menu.bike`, Strava's legacy (non-`<select>`)
  drop-down: a `div.selection` showing the current bike's name, and a
  `ul.options` of `li[data-value="<gear id>"] > a` items whose text is the bike
  name.
* **Privacy** — `input[type="radio"][name="visibility"][value="only_me"]`,
  rendered by a React component (`data-react-class="VisibilitySetting"`).

The form element ids (`:r3:-commute`, `:r6:-commute`) are React-generated and
change per render, so nothing keys off them.

### What we assume stays stable

* One `form.good` per uploaded activity, each self-contained — so scoping every
  lookup to the form is enough to keep two uploads from interfering.
* The tag checkboxes keep `name="activity[tags][]"` with `value="Commute"`.
* The bike drop-down keeps the `.drop-down-menu.bike` / `.selection` /
  `ul.options li a` structure, and clicking `.selection` then an option is what
  selects a bike.
* The privacy radios keep `name="visibility"` with the documented values.

### How the change is made

A `MutationObserver` on `document.body` (debounced 100ms) runs after each DOM
change and appends the button to any commute `div.input-field` that doesn't
already have one — new upload forms appear as files finish processing. The
button is marked with `data-jshute-commute-preset`, which is both the
idempotency check and the test hook. It goes *inside* the commute pill's
wrapper rather than beside it, so it inherits the show/hide Strava applies to
that wrapper when the activity type changes.

Styling copies the classes off the page's own primary button
(`button.action-button` — Save & View / Upload Selected), minus the classes
that place it in the footer, then overrides the color to blue inline so it
doesn't read as one of Strava's orange actions.

The page contains **more than one** Save & View button, and they aren't styled
alike: an older variant carries the legacy `btn` class and renders 40px tall
with `10px 30px` padding, while the one actually shown is `btn-primary` alone
at 34px with `6px 16px` padding. Only the *rendered* one is a valid model, so
the script picks the first `.action-button` with a non-zero height. Those
buttons stay hidden until the activity is ready to save, so on each observer
tick it recomputes the classes and restyles any button it already inserted —
the "upgrade the className when a better reference appears" pattern from
`CLAUDE.md`.

A few things also have to be set explicitly:

* `line-height: normal` — the tag pills set `line-height: 33px`, and a button
  inheriting that comes out far taller than Strava's own buttons.
* `height` *and* `min-height` (`BUTTON_HEIGHT`, 28px — a little shorter than
  Strava's 34px buttons), plus zeroed vertical padding. The class's own
  `min-height` wins over a shorter `height` alone, so both are needed.
* The hover color, since the inline background beats Strava's `:hover` rule;
  `mouseenter`/`mouseleave` swap it.

The click handler reads the current state of each control and only acts if it
differs from the target, per the repo's rule for option-setting scripts:

* Checkbox and radio are driven by the page's own handlers — jQuery for the
  tags, React for the privacy radios — so the script calls `.click()` rather
  than assigning `.checked`, which would fire no event for either.
* The bike drop-down needs the menu open before an option click registers, so
  the script clicks `.selection` first, then the matching `<a>`, then verifies
  `.selection` now reads the target name and logs a failure if it doesn't.

### Testing

The script was exercised against a saved HTML snapshot of a real upload page
(two activity forms) loaded over CDP: both buttons were inserted, the commute
checkbox and privacy radio were set on click, and an already-correct bike was
correctly skipped. The bike *change* path can't be verified that way — the
snapshot has no live jQuery bound to the drop-down — that path has to be
checked on the live site.
