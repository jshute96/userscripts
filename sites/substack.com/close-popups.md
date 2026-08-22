# Substack: Auto-close the subscribe and sign-in popups

## Summary

Reading a Substack post means dismissing two interruptions:

* A **"Discover more from ..." subscribe modal** that covers the text
  and dims the page behind it.
* A **"Sign in to *blog* with substack.com" bubble** under the
  browser's address bar, offering to hand the blog your Substack name,
  email, and profile picture.

This script gets rid of both. The subscribe modal is closed as soon as
it appears, and the sign-in bubble never opens at all — it's browser UI
rather than part of the page, so instead of closing it, the script
declines the request that would have summoned it.

Signing in through the blog's own **Sign in** link still works as
usual; only the automatic browser prompt is suppressed. Sign-in
prompts from other sites are left alone.

Substack blogs run on their own domains as well as on `*.substack.com`,
so as well as matching Substack's own domains the script matches any
site whose URL path starts with `/p/` — the shape every Substack post
URL has, whatever the domain. On the handful of unrelated sites that
also use `/p/` paths, it does nothing.

If you'd rather block the sign-in bubble without a script, Chrome can
do it per site under Settings → Privacy and security → Site settings →
Third-party sign-in, i.e. `chrome://settings/content/federatedIdentityApi`.

## Visible changes

* The subscribe modal and its dimming overlay disappear on their own,
  usually before you notice them.
* The sign-in bubble under the address bar never appears.

## Implementation

### Where it runs

`@match https://*.substack.com/*` plus `@match https://*/p/*`. A
custom-domain post is `https://<domain>/p/<slug>`, and a match pattern
can only test the URL, never the page, so the path shape is what
identifies a Substack post from the header.

Two consequences:

* A custom-domain blog's homepage, `/archive`, and `/about` aren't
  covered — the popups can still appear there. On `*.substack.com`
  domains every page is covered.
* Instagram gives every post a `/p/<shortcode>` URL, which is a lot of
  pages to load on for nothing, so it's excluded outright:
  `@exclude https://*.instagram.com/*`. That's a deliberate one-off
  rather than the start of a list — `@exclude` is only checked against
  the initial document load, so it's not a general answer to
  false-positive matches.
* For any other site that uses `/p/` paths, both halves gate themselves
  at runtime instead: the modal half checks the page is Substack's
  before it observes anything, and the sign-in patch checks each
  request's provider before declining it. Nothing is watched and
  nothing is intercepted.

`@run-at document-start`, because the sign-in patch has to be in place
before the page's own scripts run.

### The sign-in bubble

The prompt is Chrome's **FedCM** (Federated Credential Management) UI —
the browser's own federated sign-in dialog, drawn outside the page, so
no DOM element for it exists to click or hide.

The browser only shows it because the page asks. On load, Substack
calls:

```js
navigator.credentials.get({
  identity: { providers: [{
    configURL: 'https://substack.com/fedcm/config.json',
    clientId: 'substack_custom_domain',
  }] },
});
```

That call is the trigger, and it's ordinary page JavaScript we can get
in front of. We replace `navigator.credentials.get` with a wrapper:

* Calls carrying an `identity` option are federated sign-in requests.
  We check each listed provider's `configURL` host: if one is
  `substack.com` (or a subdomain), we log it and return a rejected
  promise instead of calling through — a `NetworkError` `DOMException`,
  which is what the browser itself returns when the user dismisses the
  prompt, so the page's existing error handling takes its normal path.
  A `configURL` may be relative and a bare `new URL()` throws on those,
  so it's parsed against `location.href` inside a `try`, and an
  unparseable one is simply not ours.
* Everything else — another site's federated sign-in, a password or
  passkey the user actually asked for — is passed through to the
  original function untouched.

What we assume:

1. The prompt is requested through `navigator.credentials.get` with an
   `identity` member (the FedCM shape), rather than by some future
   browser-initiated path.
2. Substack tolerates the request failing — it's an optional
   convenience, and a user dismissing the bubble produces the same
   rejection.
3. Substack's provider stays on a `substack.com` host.
4. The patch is wrapped in a `try`/`catch`. It runs before the modal
   half, in the same IIFE, so an exception here — assigning to
   `creds.get` throws under `'use strict'` if a browser or extension
   ever makes it non-writable — would otherwise take the modal half
   down with it, silently.
5. The userscript manager runs the script in the page's JavaScript
   world, so patching `navigator.credentials.get` is visible to the
   page. (Under `@grant none` it does.) If `init` shows on a Substack
   page but `declining federated sign-in request: …` never does, the
   manager is sandboxing the script away from the page's `navigator`
   and the patch isn't reaching the page.

### The subscribe modal

The modal is rendered inside the post's `<article>`, positioned
absolutely, with a sibling element for the dimming overlay:

- `div[role="dialog"][aria-label="Subscribe modal"]` — the modal
  itself. Its class list also carries a `subscribeDialog-<hash>`
  CSS-module class, but the hash rotates on every deploy, so we match
  on the role/aria-label instead.
- `button[aria-label="close"]` inside it — the X button, also
  `title="Close"`, holding a `lucide-x` SVG.
- A sibling `div` with a `background-<hash>` class and an animated
  inline `opacity` — the dimming overlay. Substack removes it as part
  of its own dismissal, so we don't touch it directly.

In practice the modal is already in the DOM by the time the document is
parsed on a post page, so it's usually closed before it's visible;
Substack can also insert it later, hence the observer. Substack
remembers the dismissal (site storage), so it generally doesn't come
back on later visits until that's cleared.

What we assume:

1. The modal keeps `role="dialog"` and `aria-label="Subscribe modal"`.
2. The close button stays a descendant `<button>` with
   `aria-label="close"`, and responds to a plain `.click()`.
3. Dismissal either removes the modal from the DOM or hides it via
   `display` / `visibility` / `offsetParent`.

What we change:

1. **Start at `DOMContentLoaded`, on a Substack page only.** There's no
   DOM to inspect at `document-start`, so the modal half waits (and
   starts immediately if the manager injected us later than the header
   asks, i.e. `readyState` is no longer `loading`). It then confirms the
   page is Substack's — the hostname, or `[class*="pencraft"]` /
   `link[href*="substackcdn.com"]` in the markup, `pencraft` being
   Substack's design-system class prefix — and otherwise does nothing
   at all.

   Measured on a live post, the modal is server-rendered and in the DOM
   28ms *before* `DOMContentLoaded` fires, along with those markers, so
   waiting costs nothing in practice:

   ```
   0ms     document-start   modal=absent  pencraft=no
   1181ms  modal first seen modal=present pencraft=yes
   1209ms  DOMContentLoaded modal=present
   1542ms  load             modal=present
   ```

2. **Watch for later ones.** `tryClose()` runs once up front, then a
   `MutationObserver` on `document.documentElement` watches
   childList/subtree mutations — the modal being re-inserted — plus
   `style` / `class` attribute changes, for later visibility toggles.
   Because the overlay animates its inline opacity, callbacks arrive
   once per frame during the fade-in; they're coalesced into one check
   per 100ms tick, with `setTimeout` rather than
   `requestAnimationFrame`, which doesn't run at all in a background
   tab.
3. **Close whenever visible.** `tryClose()` finds a visible modal and
   clicks its close button. React tears the modal down on a later
   render, and the overlay fades out first, so the result is confirmed
   by polling every 200ms for up to 3s — gone or hidden is logged as a
   success, still there at the timeout is logged as a warning. A
   `clickPending` flag keeps the observer from clicking again while a
   close is still settling, and after three clicks that closed nothing
   the script logs an error and stops trying — otherwise a broken close
   button turns every page mutation into another attempt, forever.
4. **Never disconnect.** Substack shows the modal more than once per
   page, and moves between posts client-side, so the observer stays
   attached for the life of the page. The success log includes a count
   so repeat closes are visible in the console.
