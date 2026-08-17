// Tests for scroll-index-to-top.user.js.
//
// These tests need a Feedly login in the persistent profile. Run the
// browser launcher in one terminal and leave it running:
//
//     scripts/open-browser.sh https://feedly.com
//
// Log in once (the profile dir persists the session). Then in a
// second terminal:
//
//     pnpm test
//
// The tests pick whichever feed appears first on /i/feedIndex — no
// need to hardcode a subscription URL. Override via FEEDLY_FEED_URL
// for ad-hoc runs.

const path = require('path');
const { test, expect } = require('../../test/fixtures');

const SCRIPT_PATH = path.join(__dirname, 'scroll-index-to-top.user.js');

// How far down the feed to scroll before navigating to the Index. Has
// to exceed the Index's own maximum scroll offset, or the carried-over
// value would be clamped to something small and the test couldn't tell
// a fix from a no-op.
const FEED_SCROLL_TOP = 4000;

// The feed has to be long enough that scrolling it produces an offset
// bigger than the Index's own maximum scroll — otherwise the carried-over
// value is clamped away and there's nothing to observe. Many feeds in a
// typical account hold one or two articles, so we probe candidates rather
// than taking the first link.
const MIN_FEED_SCROLL_HEIGHT = 3000;

let cachedFeedUrl = null;
async function getFeedUrl(page) {
  if (cachedFeedUrl) return cachedFeedUrl;
  if (process.env.FEEDLY_FEED_URL) {
    cachedFeedUrl = process.env.FEEDLY_FEED_URL;
    return cachedFeedUrl;
  }
  await page.goto('https://feedly.com/i/feedIndex');
  const feedLinks = page.locator('a[href*="/i/subscription/content/feed"]');
  // evaluateAll doesn't auto-wait — without this it runs against an
  // empty Index and finds nothing.
  await feedLinks.first().waitFor({ state: 'attached', timeout: 30000 });
  const hrefs = await feedLinks
    .evaluateAll(els => els.map(e => e.getAttribute('href')).filter(Boolean));
  if (hrefs.length === 0) {
    throw new Error(
      "Couldn't find a subscription/feed link on /i/feedIndex. " +
      "Are you logged in to Feedly in the persistent profile?"
    );
  }
  for (const href of hrefs.slice(0, 8)) {
    const url = new URL(href, 'https://feedly.com').href;
    await page.goto(url);
    await expect(page.locator('#feedlyFrame')).toBeVisible();
    await page.waitForTimeout(3000);
    const height = await page.evaluate(() => document.getElementById('feedlyFrame').scrollHeight);
    if (height >= MIN_FEED_SCROLL_HEIGHT) {
      cachedFeedUrl = url;
      return cachedFeedUrl;
    }
  }
  throw new Error(
    `None of the first 8 feeds had ${MIN_FEED_SCROLL_HEIGHT}px of scrollable content. ` +
    `Set FEEDLY_FEED_URL to a feed with plenty of articles.`
  );
}

// Visit the Index once so its content is rendered and cached. Without
// this the bug doesn't reproduce in a cold tab: the inherited scroll
// offset is clamped to the Index's maximum scroll *at the moment the
// content swaps in*, and an unrendered Index is barely taller than the
// viewport, so the offset is clamped to ~0 and the page looks correct by
// accident. Real browsing always has a warm Index.
async function warmIndex(page) {
  await page.goto('https://feedly.com/i/feedIndex');
  await page.waitForFunction(() => {
    const f = document.getElementById('feedlyFrame');
    return f && f.scrollHeight > f.clientHeight + 200;
  }, null, { timeout: 30000 });
}

// Feedly scrolls div#feedlyFrame, NOT the document — window.scrollY is
// always 0 here. See the sibling .md; getting this wrong is what made
// several versions of the userscript silently do nothing.
const frameScrollTop = page =>
  page.evaluate(() => document.getElementById('feedlyFrame').scrollTop);

async function scrollFeed(page, top) {
  await page.evaluate(y => {
    document.getElementById('feedlyFrame').scrollTo({ top: y, behavior: 'instant' });
  }, top);
  // Let the scroll settle (and any lazy content load) before navigating.
  await page.waitForTimeout(1000);
}

// Navigate to the Index the way a user does: the g,i keyboard shortcut.
// Using real key events matters — it exercises Feedly's own shortcut
// handler and the pushState that the userscript hooks.
async function pressGoToIndex(page) {
  await page.keyboard.press('g');
  await page.waitForTimeout(150);
  await page.keyboard.press('i');
  await page.waitForURL(/\/i\/(feedIndex|index)/, { timeout: 15000 });
}

async function openScrolledFeed(page) {
  const feedUrl = await getFeedUrl(page);
  await warmIndex(page);
  await page.goto(feedUrl);
  await expect(page.locator('#feedlyFrame')).toBeVisible();
  await page.waitForTimeout(3000); // let the feed's articles render
  await scrollFeed(page, FEED_SCROLL_TOP);
  expect(await frameScrollTop(page)).toBeGreaterThan(0);
}

test.describe('feedly scroll index to top', () => {
  test('lands the Index page at the top after g,i from a scrolled feed', async ({ page, loadUserscript }) => {
    await loadUserscript(SCRIPT_PATH);
    await openScrolledFeed(page);

    // Capture the userscript's arrival reading. Asserting only "ends at
    // 0" would pass even if the script did nothing — see the note below
    // on why a script-free control test isn't a reliable alternative.
    const arrival = page.waitForEvent('console', {
      predicate: msg => msg.text().includes('arrived at Index'),
      timeout: 20000,
    });
    await pressGoToIndex(page);
    const inherited = Number((await arrival).text().match(/scrollTop now ([\d.]+)/)?.[1]);
    expect(inherited).toBeGreaterThan(0);

    // Poll rather than sampling once: the assertion should hold, not just
    // be true at one instant.
    await expect.poll(() => frameScrollTop(page), { timeout: 5000 })
      .toBe(0);
    // Stay long enough to catch a late re-scroll if Feedly ever starts
    // doing one — the script no longer holds the position, so this is the
    // check that would notice.
    await page.waitForTimeout(3500);
    expect(await frameScrollTop(page)).toBe(0);
  });

  // NOTE: there is deliberately no "without the userscript, the Index
  // ends up scrolled" control test. It was tried and is not a stable
  // signal: the inherited offset is clamped when the Index's content
  // swaps in, and the result depends on how much of the Index has
  // rendered at that instant — observed landing at 686 (clamped to the
  // Index's maximum scroll) in one environment and 0 in another, from
  // the same starting offset. The `inherited > 0` assertion above
  // covers the same ground without the flakiness: it proves the
  // scroller really did carry a non-zero offset into the Index, which
  // is the bug.

  test('leaves a deliberate scroll alone after arriving', async ({ page, loadUserscript }) => {
    await loadUserscript(SCRIPT_PATH);
    await openScrolledFeed(page);
    await pressGoToIndex(page);
    await expect.poll(() => frameScrollTop(page), { timeout: 5000 }).toBe(0);

    await page.evaluate(() => {
      document.getElementById('feedlyFrame').scrollTo({ top: 400, behavior: 'instant' });
    });

    // Feedly emits several route events per visit. Because the script
    // acts only on the *transition* into the Index, those must not reset
    // the scroll — this is the test that guards that logic. Compared
    // loosely because scrollTop is fractional on a HiDPI display (400.18).
    await page.waitForTimeout(3000);
    expect(await frameScrollTop(page)).toBeCloseTo(400, 0);
  });
});
