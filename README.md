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
# Open the browser the tests use, with a persistent session.
# You may need to log in to sites the tests need to access.
scripts/open-browser.sh

npm test                                                  # all tests
npx playwright test sites/feedly.com                      # one site's tests
npx playwright test sites/feedly.com/sort-filter-presets.spec.js  # one file
npx playwright test -g "Newest preset"                    # by test name
```

`npm test`'s pretest hook launches the browser if it isn't already running on CDP 9233; subsequent runs reuse it. 
The direct `npx playwright test …` invocations skip the pretest hook, so launch the browser yourself for those.

See `CLAUDE.md`'s "Testing" section for why we don't let Playwright
launch the browser itself, and `test/fixtures.js` for the shared
fixtures (`page`, `loadUserscript`).
