# Xfinity Stream: Allow watching on Linux

## Summary

Xfinity Stream's web player refuses to load on Linux. Opening
`xfinity.com/stream` sends any Linux browser to an "upgrade your device"
page, even in a recent Chrome. Xfinity's dumb
[system requirements](https://www.xfinity.com/support/articles/xfinity-tv-website-requirements)
page lists only Windows and Mac, and makes Linux unsupported for no good reason.

This changes the user agent to report Windows instead of Linux, so the
site loads normally and login works.

Note: The userscript must run before the page's own scripts. Some
userscript managers start it too late, even with `@run-at
document-start`, and then the page still redirects, especially on
reloads of a cached page.

## Visible changes

* `xfinity.com/stream` loads the Stream site instead of redirecting to
  `/stream/upgrade`.

## Implementation

### What the page does

* An inline `<script>` in the `<head>` of every Stream page runs the
  compatibility check. It sets `XTV.uaParser = new UAParser(...)`
  (the ua-parser-js library, which parses `navigator.userAgent`), then:
  - `o()` fails when `os.name` matches `/linux/i` (except mobile, and
    one Edge-on-Linux screen-size special case).
  - `i()` checks `XTV.isValidNextGenBrowser` / `isValidNextGenOS`.
  - On `XTV.compatibilityCheckType === 'main'`, a failure sets
    `location` to `/stream/upgrade`. The upgrade page runs the same
    check and sends a passing browser back to `/stream/`.
* The redirect is client-side only: the server returns the same page
  for Linux and Windows user agents.
* `XTV.drmBrowserSupport` parses the user agent again later, with a new
  `UAParser`, for the player's DRM check.

### How we change it

* Runs at `document-start` in the page world (`@grant none`), before the
  inline check, and overrides getters on `Navigator.prototype`:
  `userAgent` (the `(... Linux ...)` OS part replaced with
  `(Windows NT 10.0; Win64; x64)`), `appVersion` and `platform`.
* Also overrides `navigator.userAgentData.platform` and the `platform`
  and `platformVersion` returned by `getHighEntropyValues` (User-Agent
  Client Hints), in case the site reads those.
* HTTP request headers still say Linux. The server doesn't appear to
  check them.

### What we assume stays stable

* The check runs in the page and reads `navigator.userAgent`. If it
  moves server-side, a header rewrite would be needed instead, which a
  userscript can't do.

### Testing note

* The script must run before the page's inline scripts. sm-dev's
  default (push) backend injects too late for that on this page, so the
  redirect still happens there. Test with `--extension`, or with a
  Playwright `page.addInitScript` of the script file.
* A headless browser (`--temp-browser`) redirects anyway: its user agent
  says `HeadlessChrome`, which `isValidNextGenBrowser` doesn't allow.
  Use the `--open-browser` browser.
