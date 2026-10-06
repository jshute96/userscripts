# TODOs

Possible ideas

* Clean up and refactor hints accumulated in CLAUDE.md into a skill.
* Extract skills and other pieces as a copyable template.
* We have some fallback patterns (e.g. window.onurlchange workaround for VM) copy/pasted in multiple scripts. We could make a library for these.
* Set up a way to test on firefox or other browsers for checking portability.
* Find why some sites' service workers stall loads in the shared test
  browser's profile (`.playwright-profile`). nytimes.com and youtube.com
  took about 6.5s to start each load there, and every other load
  stalled, failing their specs in full runs; a fresh profile starts
  them in well under a second.
  * Clearing the site's service workers and cache storage fixed
    nytimes. YouTube re-registered its worker and went back to slow, so
    its spec now uses `tempBrowserTest`.
  * Not the cause: SourceMonkey (same with it disabled), site isolation
    on or off, leftover tabs, Playwright leaving workers paused.
  * Untested guess: being signed in to those sites in the profile
    changes what their service workers do.
