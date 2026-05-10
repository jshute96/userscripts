## My userscripts repository

Github: https://github.com/jshute96/userscripts

## Setup

### Tampermonkey / userscript skills

Wookstar plugins: https://github.com/henkisdabro/wookstar-claude-plugins

```
/plugin marketplace add henkisdabro/wookstar-claude-plugins
/plugin install tampermonkey@wookstar-claude-plugins
```

### Test harness

Tests live next to each script (`sites/<domain>/<name>.spec.js`) and
run via Playwright against a manually-launched Chromium so logins
persist. One-time setup:

```
npm install
npx playwright install chromium
```

To run tests:

```
# terminal 1: launch the browser, log in to test sites, leave running
scripts/open-browser.sh https://feedly.com

# terminal 2:
npm test                                                  # all tests
npx playwright test sites/feedly.com                      # one site's tests
npx playwright test sites/feedly.com/sort-filter-presets.spec.js  # one file
npx playwright test -g "Newest preset"                    # by test name
```

See `CLAUDE.md`'s "Testing" section for why we don't let Playwright
launch the browser itself, and `test/fixtures.js` for the shared
fixtures (`page`, `loadUserscript`).
