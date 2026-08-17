#!/usr/bin/env bash
#
# Launch Playwright's bundled Chromium with a remote-debugging port,
# using the project-local profile dir. Tests then attach via
# chromium.connectOverCDP — they do NOT launch the browser themselves.
#
# Why: when Playwright launches Chromium itself (launchPersistentContext,
# storageState load, etc.) Google detects the automation flags and
# blocks sign-in. Manual launch + CDP-attach gets around that — the
# browser looks "real" to Google, and tests connect to an already
# authenticated session.
#
# Usage:
#   scripts/open-browser.sh                 # opens about:blank
#   scripts/open-browser.sh https://feedly.com
#
# First-time setup:
#   pnpm install
#   pnpm exec playwright install chromium
# Then run this script, log in to whatever sites you'll test, leave
# the browser running, and run `pnpm test` in another terminal.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
PROFILE_DIR="$PROJECT_DIR/.playwright-profile"
# Distinct from the SeeWhatISee project's 9222 so the two can run
# simultaneously without test runs hitting the wrong browser.
DEBUG_PORT=9233
URL="${1:-about:blank}"

# Use Playwright's bundled Chromium — same binary the test runner
# would have launched, but started here without automation flags so
# Google won't refuse logins.
CHROME=$(find "$HOME/.cache/ms-playwright/chromium-"*/chrome-linux64/chrome 2>/dev/null | sort -V | tail -1)
if [[ -z "$CHROME" ]]; then
  echo "Playwright's bundled Chromium not found." >&2
  echo "Install it with: pnpm exec playwright install chromium" >&2
  exit 1
fi

mkdir -p "$PROFILE_DIR"

echo "Opening Chromium for userscript tests."
echo "Binary:   $CHROME"
echo "Profile:  $PROFILE_DIR"
echo "CDP:      http://127.0.0.1:$DEBUG_PORT"
echo ""
echo "Log in to test sites once; sessions persist in the profile dir."
echo "Leave the browser running, then run \`pnpm test\` in another shell."
echo ""

# --disable-features=IsolateOrigins,site-per-process puts cross-origin
# iframes in the parent's renderer process instead of running them as
# out-of-process iframes (OOPIFs). With OOPIFs, Playwright's
# connectOverCDP issues Page.createIsolatedWorld for each iframe during
# initial attach, and Chrome 147 silently never responds for some
# embeds (Feedly's Twitter widget, Google's New Tab Page widgets) —
# the whole connect hangs until timeout. Same-process iframes
# respond to createIsolatedWorld synchronously, so the hang
# disappears. Acceptable for a test browser we control; we wouldn't
# want this in a regular browsing profile.
exec "$CHROME" \
  --user-data-dir="$PROFILE_DIR" \
  --no-first-run \
  --no-default-browser-check \
  --disable-features=IsolateOrigins,site-per-process \
  --remote-debugging-port="$DEBUG_PORT" \
  "$URL"
