# Greasy Fork: Support URL parameters for all fields in install/update/import form pages

## Summary

Fill Greasy Fork's script-posting forms from parameters in the URL
hash, so posting a script, a new version, or a batch import can be
launched from the command line with `google-chrome '<url>#<params>'`
instead of typed into the page.

Covers three pages — **Post a new script**
(`/script_versions/new`), **Post a new version**
(`/scripts/<id>/versions/new`) and **Import scripts** (`/import`).

It fills text fields, enables options, attaches real files to the
upload inputs, and switches the additional-info pane to Preview. It
never submits — you preview the filled form and click the button.

## Parameters

All parameters go in the URL **hash** (after `#`), as
`key=value` pairs joined by `&`. Every value must be
percent-encoded with `encodeURIComponent`. The hash never leaves the
browser, so script code isn't written to Greasy Fork's request logs
along the way.

Paths starting with `/` are treated as `file:///…`. Anywhere a
parameter takes a file or URL, both an absolute local path and an
`http(s)://` URL are accepted — but see
[Local files](#local-files) below, because `file://` reads don't work
in every userscript manager.

One parameter applies on every page:

| Parameter | Value |
| --- | --- |
| `keep_hash` | Leave the parameters in the address bar (they're stripped by default). |

Yes/no parameters (`keep_hash`, `adult`, `source_editor`) accept
`1`/`true`/`yes`/`on` and `0`/`false`/`no`/`off`, and a bare
`#keep_hash` with no value counts as yes. Anything else is reported in
the console and ignored, as are misspelled parameter names and
parameters aimed at a different page.

**There is no auto-submit.** A `submit` parameter is recognised only so
it can tell you it's disabled — see
[Why there's no auto-submit](#why-theres-no-auto-submit).

### Post a new script / Post a new version

The two forms are nearly the same; the "Page" column marks the
parameters that only exist on one of them.

| Parameter | Page | Value |
| --- | --- | --- |
| `code` | both | Script source, inline. Goes in the Code textarea. |
| `code_url` | both | Load the Code textarea from a URL or local path. |
| `code_upload` | both | Attach a file to the "Or upload" input instead of using the textarea. |
| `additional_info_html` | both | Sets the markup radio to HTML and fills Additional info. |
| `additional_info_markdown` | both | Same, with the Markdown radio. |
| `additional_info_html_url` | both | As above, text loaded from a URL or local path. |
| `additional_info_markdown_url` | both | As above, text loaded from a URL or local path. |
| `image_files` | both | Comma-separated image paths/URLs, uploaded **in the order given**. |
| `script_type` | both | `public`, `unlisted` or `library` (or `1`/`2`/`3`). |
| `name` | both | Library name field (only shown for `script_type=library`). |
| `description` | both | Library description field. |
| `adult` | both | Ticks the adult-content self-report. |
| `source_editor` | both | Turns Greasy Fork's syntax-highlighting code editor on or off. |
| `script_locale` | new script | Script language. Accepts the option's numeric id, its label (`Spanish`), or its code (`es`). |
| `changelog_html` | new version | Sets the changelog markup radio to HTML and fills the changelog. |
| `changelog_markdown` | new version | Same, with the Markdown radio. |
| `changelog_html_url` / `changelog_markdown_url` | new version | As above, text loaded from a URL or local path. |
| `remove_images` | new version | `all` ticks every "remove" checkbox on the images already attached. |

`code` / `code_url` / `code_upload` are alternatives — pass one. Same
for the `_html` / `_markdown` pairs: whichever is present wins, with
HTML checked first.

### Import scripts

| Parameter | Value |
| --- | --- |
| `urls` | Source URLs to import, separated by newlines or commas. |
| `language` | `detect`, `js` or `css`. |
| `sync_type` | `automatic` or `manual`. |

### Behaviour notes

* **Preview.** When Additional info (or the changelog) is filled, that
  pane is switched from Write to Preview, so the rendered markup is
  what you see on arrival.
* **Hash stripping.** After filling, the hash is removed from the
  address bar so a reload doesn't clobber manual edits with a stale
  prefill. Pass `keep_hash=1` to keep it.
* **No parameters, no action.** With an empty hash the script does
  nothing at all, so the pages behave normally when you browse to
  them by hand.

### Building the URLs

`scripts/greasyfork-url.py` assembles these URLs from file paths and
launches the browser, which beats percent-encoding a whole doc file by
hand:

```
scripts/greasyfork-url.py update 590960 \
    --code-file sites/strava.com/fix-climb-slider.user.js \
    --info-file sites/strava.com/fix-climb-slider.md \
    --image-files sites/strava.com/screenshots/fix-climb-slider-before.png \
    --image-files sites/strava.com/screenshots/fix-climb-slider-after.png \
    --changelog-text 'Line the icons up with the slider.'

scripts/greasyfork-url.py import <raw-url> --sync-type automatic
```

`--code-file` and `--info-file` are read at build time and inlined, so
they need no browser-side fetch at all; `--info-file` also picks the
markup mode from the extension. `--image-files` takes a comma-separated
list and is repeatable, keeping the order given. `--print` shows the URL
instead of opening it; `--http-base` rewrites local paths to `localhost`
URLs (see [Local files](#local-files)). Run it with no arguments for a
usage line per subcommand.

Its flags are named after the hash parameters they set:

| CLI flag | Hash parameter |
| --- | --- |
| `--code-file` | `code` — the file is read locally and inlined |
| `--code-url` | `code_url` |
| `--code-upload` | `code_upload` |
| `--info-file` / `--info-text`, `--info-format` | `additional_info_html` / `additional_info_markdown` |
| `--changelog-file` / `--changelog-text`, `--changelog-format` | `changelog_html` / `changelog_markdown` |
| `--image-files` | `image_files` |
| `--script-type`, `--script-locale`, `--name`, `--description`, `--adult` | `script_type`, `script_locale`, `name`, `description`, `adult` |
| `--source-editor` / `--no-source-editor` | `source_editor` |
| `--remove-images` | `remove_images` |
| `urls`, `--language`, `--sync-type` | `urls`, `language`, `sync_type` |
| `--keep-hash` | `keep_hash` |

The `--*-file` flags are the exception: they name where the *text*
comes from on this side, and set the plain text parameter on the other.
The remaining flags (`--base`, `--locale`, `--print`, `--browser`,
`--http-base`, `--http-root`) shape the URL or the launch rather than
the hash — note that `--locale` is the URL's locale segment, while
`--script-locale` is the script's own language field.

### Examples

The same thing as a raw URL — post a new version, filled but not
submitted, with two screenshots and the doc file as the description:

```
google-chrome 'https://greasyfork.org/en/scripts/590960/versions/new#code_url=/home/me/dev/userscripts/sites/strava.com/fix-climb-slider.user.js&additional_info_markdown_url=/home/me/dev/userscripts/sites/strava.com/fix-climb-slider.md&image_files=/home/me/shot-before.png,/home/me/shot-after.png&changelog_markdown=Fixed%20the%20icon%20alignment.'
```

Import two scripts from GitHub:

```
google-chrome 'https://greasyfork.org/en/import#urls=https%3A%2F%2Fraw.githubusercontent.com%2Fme%2Fuserscripts%2Fmain%2Fa.user.js,https%3A%2F%2Fraw.githubusercontent.com%2Fme%2Fuserscripts%2Fmain%2Fb.user.js&sync_type=automatic'
```

## Visible changes

* On the three form pages, fields named in the URL hash arrive
  already filled in.
* Markup-mode radios (HTML / Markdown) are selected to match whichever
  parameter was used.
* Image attachments and the code upload appear as genuinely selected
  files on the upload inputs, images in the order listed.
* Console warnings for misspelled parameters, parameters meant for a
  different page, unusable values, and combinations where one value
  would silently win over another.
* Additional info and changelog panes open on the Preview tab rather
  than Write.
* The parameters disappear from the address bar once applied.

## Implementation

### Pages and how they're detected

Greasy Fork is a server-rendered Rails app, not a single-page app —
every one of these pages is a full document load — so the script does
its work once at `document-idle` and needs none of the URL-change
plumbing our SPA scripts use.

There are two matching layers. `@match` keeps the script off every
other page on the site, one pair of patterns per page — a bare one and
a locale-prefixed one, since Greasy Fork serves both `/import` and
`/en/import`:

```
https://greasyfork.org/script_versions/new*
https://greasyfork.org/*/script_versions/new*
https://greasyfork.org/scripts/*/versions/new*
https://greasyfork.org/*/scripts/*/versions/new*
https://greasyfork.org/import*
https://greasyfork.org/*/import*
```

The trailing `*` is needed because a match pattern's path is compared
against the path *and* query string, and the language-switcher form on
these pages navigates to e.g. `/script_versions/new?locale=…`. (The
fragment isn't part of matching, so our hash never affects it.)

Then `location.pathname` is matched against three regexes, each
allowing one optional leading locale segment (`/en`, `/zh-CN`, …):

| Page | Pattern |
| --- | --- |
| new script | `/script_versions/new` |
| new version | `/scripts/<id-or-slug>/versions/new` |
| import | `/import` |

The second layer isn't redundant: `@match` wildcards span slashes, so
they can't express "at most one locale segment", and the script needs
to know *which* of the three pages it landed on regardless.

### Form controls we depend on

Both script forms are one `<form id="new_script_version">`
(`enctype="multipart/form-data"`), and the fields are addressed by id:

| Field | Selector |
| --- | --- |
| Code | `#script_version_code` (textarea) |
| Code upload | `#code-upload` (`name="code_upload"`) |
| Additional info | `#script-version-additional-info-0` |
| Additional info markup | `#script_version_additional_info_0_value_markup_{html,markdown}` |
| Changelog | `#script_version_changelog` |
| Changelog markup | `#script_version_changelog_markup_{html,markdown}` |
| Attachments | `#script_version_attachments` (`multiple`) |
| Existing attachment removal | `input[id^="remove-attachment-"]` |
| Script type | `#script_script_type_{1,2,3}` |
| Library name / description | `#library-name`, `#library-description` |
| Locale | `select[name="script[locale_id]"]` |
| Adult content | `#script_adult_content_self_report` |

The import form is `form[action*="/import/add"]` with
`#sync-urls`, `#sync-language-{detect,js,css}` and
`#sync-type-{1,2}` (`sync-type-2` is *automatic*, `sync-type-1` is
*manual* — the numbering follows Greasy Fork's internal enum, not the
display order).

The additional-info and changelog textareas each sit inside a
`div.previewable` that also contains `div.tabs` with
`a.write-tab` and `a.preview-tab`. Switching to preview is a
`.click()` on `a.preview-tab`, found by walking up from the textarea
with `closest('.previewable')` — there are two such wrappers on the
new-version page, so an anchor relative to the textarea is what keeps
them apart.

### Filling controls

Text fields get `.value` assigned followed by bubbling `input` and
`change` events, so any of Greasy Fork's own listeners see the change.

File inputs can't be given a path — that's a browser security rule
with no way around it — but their `files` property *is* assignable
from a `FileList`, and a `DataTransfer` is the only way to build one.
So each path is fetched into a `Blob`, wrapped in a `File` (name from
the last path segment, MIME type from the extension), added to a
`DataTransfer` in order, and the resulting `FileList` assigned. Image
attachments are fetched sequentially rather than with
`Promise.all` so their order in the list is deterministic — Greasy
Fork displays them in upload order.

### The syntax-highlighting source editor

Both script forms carry an "Enable syntax-highlighting source editor"
checkbox (`input.enable-source-editor`). Greasy Fork's
`app/javascript/source-editor.js` runs its change handler on page load
as well as on click: when the box is checked it hides
`#script_version_code`, builds an **ace** editor next to it in
`#ace-editor` seeded from the textarea's value *at that moment*, and
registers a submit hook — on both the form's `submit` event and the
reCAPTCHA button's click — that copies the editor's content back over
the textarea.

That means anything written into the textarea while the editor is up is
silently discarded when the form posts. The box starts unchecked, but
Chrome restores checkbox state across reloads, so it can be on at load.

`ensureSourceEditorOff()` handles it, and the ordering is deliberate:

* Unchecking is done *before* writing the code. Unchecking makes Greasy
  Fork copy ace's content into the textarea, so doing it afterwards
  would wipe what we just wrote.
* It also removes `#ace-editor` outright if it's there. Greasy Fork
  imports the ace module before building the editor, so the editor can
  appear *after* our uncheck — and unchecking a box whose editor
  doesn't exist yet does nothing. The submit hook only copies while
  that element exists, so its absence is what actually protects the
  value. The code is written again if anything was torn down on the
  second pass.
* `source_editor=1` is applied *after* the code is set, so ace seeds
  itself from our text.

### Local files

Fetching happens through `GM_xmlhttpRequest` (with `@connect *`) so
cross-origin sources like `raw.githubusercontent.com` work, falling
back to `fetch()` if the grant isn't available.

**`file://` reads depend on the userscript manager.** A manager that
performs the request from a background service worker gets an
*opaque* response for `file://` URLs — the read appears to succeed but
the body is unreadable — and the script reports
`empty response for file://…`. The portable alternative is to serve
the files over HTTP from the repo root and pass `localhost` URLs:

```
python3 -m http.server 8765 --directory ~/dev/userscripts
# then: image_files=http://localhost:8765/sites/strava.com/screenshots/a.png
```

Inline `code=` always works regardless, since nothing is fetched.

### Submitting

### Why there's no auto-submit

The parameters live in a URL, and a URL is clickable from anywhere — an
email, a forum post, a redirect. A working `submit` parameter would
mean that one click on a link someone else wrote posts a script to your
Greasy Fork account, with nothing shown to you first. Prompting for
confirmation first would be no better than the intended workflow, which
is to read the filled form and click Greasy Fork's own button.

So the submit code is commented out in the script rather than deleted,
with the notes below, and a `submit` parameter in the hash logs that
it's disabled. Were it ever re-enabled, the two forms submit
differently, which is why it clicks a button rather than calling
`form.submit()`:

* New version and import have a plain
  `input[type="submit"][name="commit"]`.
* The new-script page's control is
  `button.g-recaptcha[type="submit"]` with a
  `data-callback="submitInvisibleRecaptchaFormScriptVersion"` — an
  invisible reCAPTCHA Enterprise widget. The captcha token is
  obtained by the widget's own click handler, so the form must be
  submitted *through* a click; `form.submit()` would post without a
  token and be rejected. A scripted click still runs that handler,
  but the challenge is scored, so an automated post of a brand-new
  script would be the least reliable case. The new-version and import
  forms carry no captcha.

Every form also carries a Rails `authenticity_token` hidden field.
Because the page's own already-rendered form is what gets posted, that
token comes along untouched — which is also why this is a userscript
and not a `curl` script.

### What we assume stays stable

* The three URL paths, and the optional locale prefix on each.
* The field ids in the tables above, particularly the
  `script_version_additional_info_0_*` naming for the first (default)
  additional-info block.
* The `div.previewable` / `a.preview-tab` structure around the
  markup-backed textareas.
* `name="commit"` on the version and import submit buttons, and the
  `g-recaptcha` class on the new-script one.
* Attachment ordering following upload order.
