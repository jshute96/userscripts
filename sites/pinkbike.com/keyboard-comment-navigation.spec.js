// Tests for keyboard-comment-navigation.user.js.
//
// Pinkbike articles are public — no login needed. Run the launcher in
// one terminal and leave it running:
//
//     scripts/open-browser.sh https://www.pinkbike.com
//
// Then in another terminal:
//
//     pnpm test
//
// Override the article under test with PINKBIKE_ARTICLE_URL if the
// default ever stops being available. The article only has to have
// at least two top-level threads with replies (which any moderately
// active news post will).

const path = require('path');
const { test, expect } = require('../../test/fixtures');

const SCRIPT_PATH = path.join(__dirname, 'keyboard-comment-navigation.user.js');

const ARTICLE_URL = process.env.PINKBIKE_ARTICLE_URL
  || 'https://www.pinkbike.com/news/new-vision-same-mountain-mammoth-mountain-to-reimagine-bike-park.html';

// Wait for the script's `keys:` init line — confirms the handler is
// registered before any keypress is dispatched. Pair it with a goto.
async function waitForInit(page) {
  await page.waitForEvent('console', {
    predicate: msg => /^\[pb nav\] keys:/.test(msg.text()),
    timeout: 15000,
  });
}

// Dispatch a key and wait for the userscript's matching action log.
// Returns the matched log text so callers can extract the target id.
async function pressAndWait(page, key, logPattern) {
  const got = page.waitForEvent('console', {
    predicate: msg => logPattern.test(msg.text()),
    timeout: 5000,
  });
  await page.keyboard.press(key);
  const msg = await got;
  return msg.text();
}

// Comments are server-rendered, but on a slow load they can still be
// absent the instant the script's init log fires. Tests that reach
// straight into the DOM have to wait for the shape they need.
async function waitForSelector(page, selector) {
  await page.waitForFunction(
    sel => !!document.querySelector(sel), selector, { timeout: 15000 });
}

// Find a comment id by structural position (no hardcoded cm-ids).
// Selector is evaluated on the page and returns the element's id.
async function commentIdAt(page, selector) {
  return page.evaluate(sel => document.querySelector(sel)?.id, selector);
}

test.describe('pinkbike better comment navigation', () => {
  test.beforeEach(async ({ loadUserscript }) => {
    await loadUserscript(SCRIPT_PATH);
  });

  test('j advances to the next comment in document order', async ({ page }) => {
    await page.goto(ARTICLE_URL);
    await waitForInit(page);
    // Scroll the first comment to viewport top so findCurrentRow()
    // resolves to it.
    await page.evaluate(() => {
      document.querySelector('.cmcont').scrollIntoView({ block: 'start' });
    });
    await page.waitForTimeout(200);

    const firstId = await commentIdAt(page, '.cmcont');
    const secondId = await commentIdAt(page, '.cmcont + .cmcont, .cmcont ~ .cmcont');
    const log = await pressAndWait(page, 'j', /^\[pb nav\] j: next -> /);
    expect(log).toContain(`j: next -> ${secondId}`);
    // Sanity: that really is the comment after the first.
    expect(secondId).not.toBe(firstId);
  });

  test('k moves back to the previous comment', async ({ page }) => {
    await page.goto(ARTICLE_URL);
    await waitForInit(page);
    // Scroll the second cmcont to the top, then press k.
    const secondId = await page.evaluate(() => {
      const second = document.querySelectorAll('.cmcont')[1];
      second.scrollIntoView({ block: 'start' });
      return second.id;
    });
    await page.waitForTimeout(200);
    const firstId = await commentIdAt(page, '.cmcont');
    const log = await pressAndWait(page, 'k', /^\[pb nav\] k: prev -> /);
    expect(log).toContain(`k: prev -> ${firstId}`);
    expect(firstId).not.toBe(secondId);
  });

  test('p from a reply jumps to its thread root', async ({ page }) => {
    await page.goto(ARTICLE_URL);
    await waitForInit(page);
    await waitForSelector(page, '.cmcont.commentreply2');
    // Bring the first reply to the top.
    const { replyId, rootId } = await page.evaluate(() => {
      const reply = document.querySelector('.cmcont.commentreply2');
      reply.scrollIntoView({ block: 'start' });
      const root = reply.closest('.ppcont').querySelector('.cmcont:not(.commentreply2)');
      return { replyId: reply.id, rootId: root.id };
    });
    await page.waitForTimeout(200);
    const log = await pressAndWait(page, 'p', /^\[pb nav\] p: parent /);
    expect(log).toBe(`[pb nav] p: parent -> ${rootId}`);
  });

  test('p on a root comment is a no-op (logged, no jump)', async ({ page }) => {
    await page.goto(ARTICLE_URL);
    await waitForInit(page);
    const rootId = await page.evaluate(() => {
      const root = document.querySelector('.cmcont:not(.commentreply2)');
      root.scrollIntoView({ block: 'start' });
      return root.id;
    });
    await page.waitForTimeout(200);
    // `p` means "go up", and there is no up from a root — so it
    // reports that it has nowhere to go and doesn't scroll.
    const log = await pressAndWait(page, 'p', /^\[pb nav\] p: parent/);
    expect(log).toBe(`[pb nav] p: parent — nowhere to go from ${rootId}`);
  });

  test('n jumps to the next thread root', async ({ page }) => {
    await page.goto(ARTICLE_URL);
    await waitForInit(page);
    const { firstRootId, secondRootId } = await page.evaluate(() => {
      const threads = document.querySelectorAll('.ppcont');
      const a = threads[0].querySelector('.cmcont:not(.commentreply2)');
      const b = threads[1].querySelector('.cmcont:not(.commentreply2)');
      a.scrollIntoView({ block: 'start' });
      return { firstRootId: a.id, secondRootId: b.id };
    });
    await page.waitForTimeout(200);
    const log = await pressAndWait(page, 'n', /^\[pb nav\] n: parent-next /);
    expect(log).toBe(`[pb nav] n: parent-next -> ${secondRootId}`);
    expect(secondRootId).not.toBe(firstRootId);
  });

  test('c lands with the comments header at the top of the viewport', async ({ page }) => {
    await page.goto(ARTICLE_URL);
    await waitForInit(page);
    // Start scrolled to the very top of the article.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);

    const log = await pressAndWait(page, 'c', /^\[pb nav\] c -> /);
    // The fix targets the comments wrapper, not the bare #commenttop
    // span — make sure that's what got logged.
    expect(log).toMatch(/news-comments/);

    // Wait for the jump to settle. Poll the *container's* offset, not
    // scrollY: lazy-loaded images and ad slots above the comments keep
    // growing during the scroll, so scrollY can hold steady while the
    // target is still moving. The script re-corrects when that
    // happens, and this loop has to outlast those corrections.
    const containerTop = () => page.evaluate(() => {
      const el = document.querySelector('.news-comments-container');
      return Math.round(el.getBoundingClientRect().top);
    });
    let last = null, stable = 0, top = await containerTop();
    for (let i = 0; i < 100 && stable < 5; i++) {
      top = await containerTop();
      if (top === last) stable++; else { stable = 0; last = top; }
      await page.waitForTimeout(100);
    }

    // After the jump, the comments-container's top edge should be
    // at (or just above) the viewport top. We allow a few pixels
    // for browser rounding; we mainly care that we didn't land in
    // the related-articles / deals filler above the comments.
    expect(top).toBeGreaterThan(-5);
    expect(top).toBeLessThan(20);
  });

  test('jumping to the last comment does not report a failed scroll', async ({ page }) => {
    // The last comments sit within one viewport height of the document
    // end, so the scroll clamps and they never reach the viewport top.
    // That's the browser doing all it can — the drift correction has
    // to recognize it rather than retry and then log a failure.
    await page.goto(ARTICLE_URL);
    await waitForInit(page);
    // Park at the very bottom. Which comment `j` picks from here
    // doesn't matter — anything in the final viewport can't be raised
    // to the top, which is the case under test.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(300);

    const noise = [];
    const handler = msg => {
      const t = msg.text();
      if (/drifted|giving up|timed out/.test(t)) noise.push(t);
    };
    page.on('console', handler);
    await pressAndWait(page, 'j', /^\[pb nav\] j: next -> /);
    // Outlast the correction window (4s) so a retry loop would show.
    await page.waitForTimeout(5000);
    page.off('console', handler);

    // Guard the premise: if the page ever gets short enough that the
    // scroll isn't clamped here, this test stops covering anything.
    const state = await page.evaluate(() => ({
      scrollY: Math.round(window.scrollY),
      maxScroll: Math.round(
        document.documentElement.scrollHeight - window.innerHeight),
    }));
    expect(state.scrollY).toBeGreaterThanOrEqual(state.maxScroll - 1);
    expect(noise).toEqual([]);
  });

  test('keys are ignored while typing in a text field', async ({ page }) => {
    await page.goto(ARTICLE_URL);
    await waitForInit(page);
    // Inject and focus a textarea (Pinkbike's own reply box needs a
    // login). Then collect any [pb nav] logs while we type a key
    // that would otherwise navigate.
    await page.evaluate(() => {
      const ta = document.createElement('textarea');
      ta.id = '__test_input';
      ta.style.position = 'fixed';
      ta.style.top = '0';
      ta.style.left = '0';
      ta.style.zIndex = '99999';
      document.body.appendChild(ta);
      ta.focus();
    });
    const logs = [];
    const handler = msg => {
      const t = msg.text();
      if (t.startsWith('[pb nav]') && !t.startsWith('[pb nav] keys:') &&
        !t.startsWith('[pb nav] init')) {
        logs.push(t);
      }
    };
    page.on('console', handler);
    await page.keyboard.press('j');
    await page.waitForTimeout(400);
    page.off('console', handler);
    expect(logs).toEqual([]);
  });
  // ---------------------------------------------------------------
  // Keys derived from the tree rather than written per-site.
  // ---------------------------------------------------------------
  // Pinkbike's threads are one level deep, so the shared library
  // derives h/l/r/m from the same `parentOf` that powers p and n.
  // At this depth `r` coincides with `p` and `h` from a root
  // coincides with `m` — that collapsing is the intended behavior,
  // so every key works on every site.

  // Locate a reply, its thread root, and the next thread's root.
  async function threadLandmarks(page) {
    return page.evaluate(() => {
      const threads = [...document.querySelectorAll('.ppcont')];
      const i = threads.findIndex(t => t.querySelector('.cmcont.commentreply2'));
      if (i < 0 || i + 1 >= threads.length) return null;
      const reply = threads[i].querySelector('.cmcont.commentreply2');
      reply.scrollIntoView({ block: 'start' });
      return {
        replyId: reply.id,
        rootId: threads[i].querySelector('.cmcont:not(.commentreply2)').id,
        nextRootId: threads[i + 1]
          .querySelector('.cmcont:not(.commentreply2)').id,
      };
    });
  }

  test('r from a reply jumps to the root of its thread', async ({ page }) => {
    await page.goto(ARTICLE_URL);
    await waitForInit(page);
    const marks = await threadLandmarks(page);
    test.skip(!marks, 'article has no thread with a reply followed by another thread');
    await page.waitForTimeout(200);
    const log = await pressAndWait(page, 'r', /^\[pb nav\] r: root/);
    expect(log).toBe(`[pb nav] r: root -> ${marks.rootId}`);
  });

  test('r on a root has nowhere to go', async ({ page }) => {
    await page.goto(ARTICLE_URL);
    await waitForInit(page);
    const rootId = await page.evaluate(() => {
      const root = document.querySelector('.cmcont:not(.commentreply2)');
      root.scrollIntoView({ block: 'start' });
      return root.id;
    });
    await page.waitForTimeout(200);
    const log = await pressAndWait(page, 'r', /^\[pb nav\] r: root/);
    expect(log).toBe(`[pb nav] r: root — nowhere to go from ${rootId}`);
  });

  test('m from a reply skips the rest of the thread', async ({ page }) => {
    await page.goto(ARTICLE_URL);
    await waitForInit(page);
    const marks = await threadLandmarks(page);
    test.skip(!marks, 'article has no thread with a reply followed by another thread');
    await page.waitForTimeout(200);
    const log = await pressAndWait(page, 'm', /^\[pb nav\] m: root-next/);
    expect(log).toBe(`[pb nav] m: root-next -> ${marks.nextRootId}`);
  });

  test('h from a root steps to the next root (roots are siblings)', async ({ page }) => {
    await page.goto(ARTICLE_URL);
    await waitForInit(page);
    const { firstRootId, secondRootId } = await page.evaluate(() => {
      const threads = document.querySelectorAll('.ppcont');
      const a = threads[0].querySelector('.cmcont:not(.commentreply2)');
      const b = threads[1].querySelector('.cmcont:not(.commentreply2)');
      a.scrollIntoView({ block: 'start' });
      return { firstRootId: a.id, secondRootId: b.id };
    });
    await page.waitForTimeout(200);
    const log = await pressAndWait(page, 'h', /^\[pb nav\] h: sibling-next/);
    expect(log).toBe(`[pb nav] h: sibling-next -> ${secondRootId}`);
    expect(secondRootId).not.toBe(firstRootId);
  });
});

// -----------------------------------------------------------------
// The shared `?` help overlay
// -----------------------------------------------------------------
// Both Pinkbike scripts match /news/*, so both are live on an
// article. Each userscript is sandboxed and gets its own copy of the
// library, so the registry they collaborate through is a DOM node —
// this is the test that the collaboration actually works.

const IMAGE_SCRIPT_PATH = path.join(__dirname, 'article-image-navigation.user.js');

test.describe('shared keyboard-shortcut help', () => {
  test('? lists shortcuts from every userscript on the page', async ({ page, loadUserscript }) => {
    await loadUserscript(SCRIPT_PATH);
    await loadUserscript(IMAGE_SCRIPT_PATH);
    await page.goto(ARTICLE_URL);
    await waitForInit(page);
    await page.waitForEvent('console', {
      predicate: msg => /^\[pb img\] keys:/.test(msg.text()),
      timeout: 15000,
    });

    await page.keyboard.press('?');
    // Playwright's CSS engine pierces open shadow roots, so the
    // overlay's internals are addressable from the page.
    const dialog = page.locator('#userscript-shortcuts-help dialog');
    await expect(dialog).toBeVisible();

    // Grouped by userscript, using each script's own @name.
    const groups = await page.locator('#userscript-shortcuts-help h2')
      .allTextContents();
    expect(groups).toContain('Pinkbike: Keyboard comment navigation');
    expect(groups).toContain('Pinkbike: Keyboard navigation for article photos');

    const shown = await page.locator('#userscript-shortcuts-help kbd')
      .allTextContents();
    // All nine comment-navigation keys, plus both image keys.
    for (const key of ['j', 'k', 'h', 'l', 'p', 'n', 'r', 'm', 'c']) {
      expect(shown).toContain(key);
    }
    expect(shown).toContain('i');
    expect(shown).toContain('Shift-I');

    // Esc closes it and removes the host entirely.
    await page.keyboard.press('Escape');
    await expect(page.locator('#userscript-shortcuts-help')).toHaveCount(0);
  });

  // Regression: leaving Esc to <dialog>'s built-in close request broke
  // in both directions on real sites — NYTimes closed its comments
  // panel behind the overlay because the keydown kept propagating,
  // and WaPo's Coral drawer suppressed the default close so the
  // overlay wouldn't dismiss at all. The library now handles Esc
  // itself, in capture phase on window.
  test('Esc closes the overlay without the page seeing the keystroke', async ({ page, loadUserscript }) => {
    await loadUserscript(SCRIPT_PATH);
    await page.goto(ARTICLE_URL);
    await waitForInit(page);
    await page.evaluate(() => {
      window.__escSeen = 0;
      const count = e => { if (e.key === 'Escape') window.__escSeen++; };
      document.addEventListener('keydown', count);
      window.addEventListener('keydown', count);
    });

    await page.keyboard.press('?');
    await expect(page.locator('#userscript-shortcuts-help dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#userscript-shortcuts-help')).toHaveCount(0);
    expect(await page.evaluate(() => window.__escSeen)).toBe(0);

    // With no overlay open, Esc is none of our business.
    await page.evaluate(() => { window.__escSeen = 0; });
    await page.keyboard.press('Escape');
    expect(await page.evaluate(() => window.__escSeen)).toBe(2);
  });

  test('clicking outside the overlay closes it', async ({ page, loadUserscript }) => {
    await loadUserscript(SCRIPT_PATH);
    await page.goto(ARTICLE_URL);
    await waitForInit(page);
    await page.keyboard.press('?');
    await expect(page.locator('#userscript-shortcuts-help dialog')).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(page.locator('#userscript-shortcuts-help')).toHaveCount(0);
  });

  test('navigation keys do nothing while the help overlay is open', async ({ page, loadUserscript }) => {
    await loadUserscript(SCRIPT_PATH);
    await page.goto(ARTICLE_URL);
    await waitForInit(page);
    await page.keyboard.press('?');
    await expect(page.locator('#userscript-shortcuts-help dialog')).toBeVisible();

    const logs = [];
    const handler = msg => {
      if (/^\[pb nav\] [a-z]:/.test(msg.text())) logs.push(msg.text());
    };
    page.on('console', handler);
    await page.keyboard.press('j');
    await page.waitForTimeout(400);
    page.off('console', handler);
    expect(logs).toEqual([]);
  });
});
