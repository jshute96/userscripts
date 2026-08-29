// ==UserScript==
// @name         NYTimes Spelling Bee: Word definitions and other tweaks
// @namespace    https://github.com/jshute96/userscripts
// @version      1.0.24
// @description  Shows definitions when you hover or click a word, adds a toolbar link to Spelling Bee Buddy, and closes the splash screens for you.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://www.nytimes.com/puzzles/spelling-bee*
// @match        https://www.nytimes.com/interactive/2023/upshot/spelling-bee-buddy.html*
// @grant        GM_xmlhttpRequest
// @connect      api.dictionaryapi.dev
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[spelling-bee]';
  const WELCOME_SELECTOR = '.pz-moment__welcome';
  const WELCOME_CONTINUE_SELECTOR = '.pz-moment__welcome .pz-moment__button.primary';
  const CONGRATS_SELECTOR = '.pz-moment__congrats';
  const CONGRATS_KEEP_PLAYING_SELECTOR = '.pz-moment__congrats .pz-moment__close_text';
  // Two different screens render under `.pz-moment__congrats`:
  //   * the intermediate rank-up moment, which has a "Keep playing"
  //     `.pz-moment__close_text` — this is the one we dismiss;
  //   * the end-of-puzzle screen (Queen Bee / final stats), which has no
  //     "Keep playing" at all, just an X plus "Share your achievement"
  //     and "View all games".
  // The final screen is a legitimate end state, not a broken selector, so
  // we identify it by its own buttons and leave it alone silently.
  const FINAL_MOMENT_BUTTON_SELECTOR =
    '.pz-moment__congrats .pz-moment__button, .pz-moment__congrats .pz-moment__button-group';
  const FINAL_MOMENT_BUTTON_TEXT = /view all games|share your achievement/i;
  const TOOLBAR_RIGHT_SELECTOR = '.pz-toolbar-right';
  const HINTS_BUTTON_SELECTOR = '.pz-toolbar-right .pz-toolbar-button__hints';
  const BUDDY_BUTTON_CLASS = 'pz-toolbar-button__buddy';
  const BUDDY_URL = 'https://www.nytimes.com/interactive/2023/upshot/spelling-bee-buddy.html';
  const WORDLIST_ITEM_SELECTOR = 'li > .sb-anagram';
  // Buddy page: two distinct components render found-word lists.
  //   * `.word-row.found` — bottom "You've already found:" tile list
  //     (word built from per-letter divs inside `.word`).
  //   * `.row.user-found` — top "You vs. Other Bee Buddy Visitors"
  //     bar-graph table (word is plain text inside a `td.word`).
  const BUDDY_FOUND_ROW_SELECTOR = '.word-row.found, .row.user-found';
  const BUDDY_WORD_SELECTOR = '.word';
  // Marks the word element we've already wired up so the MutationObserver
  // doesn't double-attach listeners.
  const LOOKUP_MARKER_ATTR = 'data-sb-lookup-added';
  // "Open on Cambridge Dictionary" link inside the popup — the user
  // prefers Cambridge as the landing page when they actually click through.
  const DICTIONARY_URL = 'https://dictionary.cambridge.org/us/dictionary/english/';
  // Hover-popup data source: the Free Dictionary API. JSON, no auth, no
  // ads, and concise — much cleaner than scraping a full dictionary page.
  const DEFINITION_API_URL = 'https://api.dictionaryapi.dev/api/v2/entries/en/';
  // The API sits behind Cloudflare, and when its origin hiccups Cloudflare
  // caches the resulting 502 against that exact URL — so the *same* word
  // then fails on every retry while other words are fine. Appending a
  // unique query param produces a distinct cache key, which misses the
  // poisoned entry and reaches the origin again. Observed working: plain
  // `/entries/en/colon` returned 502 indefinitely, `?_cb=…` returned 200.
  const DEFINITION_RETRIES = 2;
  const RETRY_DELAY_MS = 400;
  // GM_xmlhttpRequest has no default timeout, so a stalled request never
  // settles and the popup sits on "Looking up…" forever. When the API's
  // origin is down, Cloudflare itself takes ~20s to give up and return a
  // 522, so we cut it off long before that.
  //
  // 1.5s is generous for a healthy response: a cache hit measured 0.13s, and
  // the API has no observed "slow but succeeds" regime — a lookup is
  // either fast or it's a 522, whose ~19.5s is Cloudflare's fixed
  // origin-connect timeout rather than a slow answer. So a longer timeout
  // buys no extra successes, only a longer wait before giving up.
  const REQUEST_TIMEOUT_MS = 1500;
  // Whole-lookup budget across all attempts. Without it, retrying a slow
  // failure multiplies the wait (3 x 20s was the observed freeze).
  const LOOKUP_DEADLINE_MS = 3000;
  let cacheBustCounter = 0;
  const HOVER_DELAY_MS = 250;
  const HIDE_DELAY_MS = 200;
  const POPUP_WIDTH = 480;
  const POPUP_HEIGHT = 360;

  console.log(TAG, 'initializing');

  function isVisible(el) {
    if (!el) return false;
    if (el.offsetParent !== null) return true;
    const cs = getComputedStyle(el);
    return cs.display !== 'none' && cs.visibility !== 'hidden';
  }

  let welcomeDismissed = false;
  let congratsDismissed = false;
  // These dismissers run from the MutationObserver, so a missing button
  // would otherwise log on every mutation for as long as the overlay is
  // up. Warn once per appearance, and re-arm when the overlay goes away
  // so a later failure is still reported.
  let welcomeWarned = false;
  let congratsWarned = false;
  let finalMomentLogged = false;

  // True for the end-of-puzzle screen, which shares the congrats class
  // but has nothing to dismiss.
  function isFinalMoment(moment) {
    return Array.from(moment.querySelectorAll(FINAL_MOMENT_BUTTON_SELECTOR))
      .some((el) => FINAL_MOMENT_BUTTON_TEXT.test(el.textContent || ''));
  }

  function tryDismissWelcome() {
    if (welcomeDismissed) return;
    const moment = document.querySelector(WELCOME_SELECTOR);
    if (!moment || !isVisible(moment)) { welcomeWarned = false; return; }
    const btn = document.querySelector(WELCOME_CONTINUE_SELECTOR);
    if (!btn) {
      if (!welcomeWarned) {
        welcomeWarned = true;
        console.warn(TAG, 'welcome screen visible but Continue button not found',
          '- selector:', WELCOME_CONTINUE_SELECTOR);
      }
      return;
    }
    console.log(TAG, 'welcome screen detected — clicking Continue');
    btn.click();
    welcomeDismissed = true;
  }

  function tryDismissCongrats() {
    if (congratsDismissed) return;
    const moment = document.querySelector(CONGRATS_SELECTOR);
    if (!moment || !isVisible(moment)) {
      congratsWarned = false;
      finalMomentLogged = false;
      return;
    }
    if (isFinalMoment(moment)) {
      if (!finalMomentLogged) {
        finalMomentLogged = true;
        console.log(TAG, 'end-of-puzzle screen — nothing to dismiss');
      }
      return;
    }
    const btn = document.querySelector(CONGRATS_KEEP_PLAYING_SELECTOR);
    if (!btn) {
      if (!congratsWarned) {
        congratsWarned = true;
        console.warn(TAG, 'congrats screen visible but Keep playing button not found',
          '- selector:', CONGRATS_KEEP_PLAYING_SELECTOR,
          '- buttons present:',
          Array.from(moment.querySelectorAll('button, [class*="button"], [class*="close"]'))
            .map((e) => e.className + '|' + (e.textContent || '').trim().slice(0, 30)));
      }
      return;
    }
    console.log(TAG, 'congrats screen detected — clicking Keep playing');
    btn.click();
    congratsDismissed = true;
  }

  function tryAddBuddyLink() {
    const toolbar = document.querySelector(TOOLBAR_RIGHT_SELECTOR);
    if (!toolbar) return;
    if (toolbar.querySelector('.' + BUDDY_BUTTON_CLASS)) return;
    const hints = toolbar.querySelector(HINTS_BUTTON_SELECTOR);
    if (!hints) {
      console.warn(TAG, 'toolbar present but Hints button not found — skipping Buddy injection');
      return;
    }
    const buddy = document.createElement('a');
    buddy.className = 'pz-toolbar-button ' + BUDDY_BUTTON_CLASS;
    buddy.href = BUDDY_URL;
    buddy.target = '_blank';
    buddy.rel = 'noreferrer';
    buddy.textContent = 'Buddy';
    const icon = document.createElement('i');
    icon.className = 'pz-toolbar-icon external';
    buddy.appendChild(icon);
    hints.insertAdjacentElement('afterend', buddy);
    console.log(TAG, 'added Buddy toolbar link');
  }

  // ---------- Definition popup ----------

  // Subtle "interactive" affordance for any wired-up word. Injected once
  // as a stylesheet rather than per-word inline styles, so we don't churn
  // the `style` attribute on every found word and feedback-loop our own
  // MutationObserver.
  const styleEl = document.createElement('style');
  styleEl.textContent = '[' + LOOKUP_MARKER_ATTR + '] { cursor: help; }';
  (document.head || document.documentElement).appendChild(styleEl);

  const definitionCache = new Map(); // word -> Promise<{ html, error, missing }>
  let popupEl = null;
  let popupContentEl = null;
  let hoverTimer = null;
  let hideTimer = null;
  let popupWord = null;
  // When the popup was opened by a click, "pin" it: don't auto-hide on
  // mouseleave. mouseleave never fires on touch devices, so click is the
  // primary trigger there and we need an explicit dismiss path
  // (click outside, or click the same word again).
  let popupPinned = false;

  // A transport-level failure (network error, timeout, no GM API) has no
  // HTTP status of its own. Use a distinct sentinel rather than 0, so it
  // stays distinguishable from an `onload` that simply didn't populate
  // `response.status` — some userscript managers omit it, and that case
  // must still fall through to the JSON parse.
  const TRANSPORT_FAILURE = -1;

  // One HTTP round-trip. Resolves to { status, text } — never rejects.
  function requestOnce(url, timeoutMs) {
    return new Promise((resolve) => {
      try {
        GM_xmlhttpRequest({
          method: 'GET',
          url: url,
          headers: { 'Accept': 'application/json' },
          timeout: timeoutMs,
          onload: (response) => {
            resolve({ status: response.status, text: response.responseText || '' });
          },
          onerror: (err) => {
            console.warn(TAG, 'definition fetch failed for', url, err);
            resolve({ status: TRANSPORT_FAILURE, text: '' });
          },
          ontimeout: () => {
            console.warn(TAG, 'definition fetch timed out for', url);
            resolve({ status: TRANSPORT_FAILURE, text: '' });
          },
        });
      } catch (err) {
        console.warn(TAG, 'GM_xmlhttpRequest unavailable', err);
        resolve({ status: TRANSPORT_FAILURE, text: '' });
      }
    });
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Only a server-side 5xx or a transport failure is worth another
  // attempt — that's the cached-502 symptom this retry exists for.
  // Notably 429 (rate limited) and other 4xx are NOT retried: attempts
  // 1+ bypass the CDN by construction, so retrying them would send three
  // requests to the origin for every hover and deepen the rate limit
  // rather than wait it out.
  function isRetryable(status) {
    return status === TRANSPORT_FAILURE || (status >= 500 && status <= 599);
  }

  // Fetch with cache-busting retries. Attempt 0 uses the plain URL so a
  // healthy edge cache still helps; later attempts add a unique `_cb`
  // param to route around a cached 502 (see DEFINITION_RETRIES above).
  async function fetchWithRetries(word) {
    const base = DEFINITION_API_URL + encodeURIComponent(word);
    let last = { status: TRANSPORT_FAILURE, text: '' };
    const deadline = Date.now() + LOOKUP_DEADLINE_MS;
    for (let attempt = 0; attempt <= DEFINITION_RETRIES; attempt++) {
      // Clamp each attempt to whatever is left of the budget, so
      // LOOKUP_DEADLINE_MS is a real ceiling on the whole lookup rather
      // than just a gate on starting another attempt. (Without this, an
      // attempt begun just under the deadline still runs its full
      // timeout past it.)
      const remaining = deadline - Date.now() - (attempt > 0 ? RETRY_DELAY_MS : 0);
      if (remaining <= 0) {
        console.warn(TAG, 'lookup deadline reached for', word, '- not retrying');
        break;
      }
      const url = attempt === 0 ? base : base + '?_cb=' + (++cacheBustCounter) + '-' + Date.now();
      if (attempt > 0) await delay(RETRY_DELAY_MS);
      last = await requestOnce(url, Math.min(REQUEST_TIMEOUT_MS, remaining));
      console.log(TAG, 'definition fetch', word, 'attempt', attempt,
        'status', last.status, 'len', last.text.length);
      if (!isRetryable(last.status)) return last;
      console.warn(TAG, 'retryable status for', word, last.status,
        '- excerpt:', last.text.slice(0, 200));
    }
    console.warn(TAG, 'giving up on', word, 'after',
      DEFINITION_RETRIES + 1, 'attempts');
    return last;
  }

  function fetchDefinition(word) {
    if (definitionCache.has(word)) return definitionCache.get(word);
    const p = fetchWithRetries(word).then((response) => {
      try {
        // The API returns 404 with `{title: "No Definitions Found"}`
        // for unknown words.
        if (response.status === 404) {
          return { entries: null, error: false, missing: true };
        }
        // A falsy status from a successful `onload` means the manager
        // didn't report one — try to parse the body anyway rather than
        // failing the lookup. This is why transport failures use the
        // truthy TRANSPORT_FAILURE sentinel and not 0: they land here
        // as an error, while a status-less success falls through.
        if (response.status && response.status !== 200) {
          return { entries: null, error: true };
        }
        const data = JSON.parse(response.text);
        if (!Array.isArray(data) || data.length === 0) {
          return { entries: null, error: false, missing: true };
        }
        return { entries: data, error: false };
      } catch (err) {
        console.warn(TAG, 'definition parse failed for', word, err);
        return { entries: null, error: true };
      }
    });
    // Cache only successful results — transient errors shouldn't poison
    // future hovers.
    p.then((result) => {
      if (result.error) definitionCache.delete(word);
    });
    definitionCache.set(word, p);
    return p;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderEntries(word, entries) {
    // Group meanings by part of speech across all entries for this word.
    // The Free Dictionary API often returns multiple entries per word
    // (different etymologies); we just flatten them.
    const phonetic = entries
      .map((e) => e.phonetic || (e.phonetics || []).map((p) => p.text).find(Boolean))
      .find(Boolean);
    const parts = [];
    parts.push('<h2 class="word">' + escapeHtml(word) + '</h2>');
    if (phonetic) {
      parts.push('<div class="phonetic">' + escapeHtml(phonetic) + '</div>');
    }
    entries.forEach((entry) => {
      (entry.meanings || []).forEach((meaning) => {
        parts.push('<section class="meaning">');
        parts.push('<h3 class="pos">' + escapeHtml(meaning.partOfSpeech || '') + '</h3>');
        parts.push('<ol class="defs">');
        (meaning.definitions || []).forEach((def) => {
          parts.push('<li>');
          parts.push('<div class="def">' + escapeHtml(def.definition || '') + '</div>');
          if (def.example) {
            parts.push('<div class="example">"' + escapeHtml(def.example) + '"</div>');
          }
          parts.push('</li>');
        });
        parts.push('</ol>');
        parts.push('</section>');
      });
    });
    return parts.join('');
  }

  function ensurePopup() {
    if (popupEl) return popupEl;
    popupEl = document.createElement('div');
    popupEl.className = 'sb-lookup-popup';
    popupEl.style.cssText = [
      'position: fixed',
      'z-index: 2147483647',
      'width: ' + POPUP_WIDTH + 'px',
      'height: ' + POPUP_HEIGHT + 'px',
      'background: white',
      'border: 1px solid #888',
      'border-radius: 8px',
      'box-shadow: 0 6px 20px rgba(0,0,0,0.18)',
      'overflow: hidden',
      'display: none',
      'font-family: system-ui, sans-serif',
    ].join(';');

    popupContentEl = document.createElement('div');
    popupContentEl.style.cssText = 'width: 100%; height: 100%;';
    popupEl.appendChild(popupContentEl);

    popupEl.addEventListener('mouseenter', () => {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    });
    popupEl.addEventListener('mouseleave', schedulePopupHide);

    document.body.appendChild(popupEl);
    return popupEl;
  }

  function positionPopup(anchor) {
    const p = ensurePopup();
    const rect = anchor.getBoundingClientRect();
    const margin = 8;
    let left = rect.right + margin;
    if (left + POPUP_WIDTH > window.innerWidth - margin) {
      left = Math.max(margin, rect.left - POPUP_WIDTH - margin);
    }
    let top = rect.top;
    if (top + POPUP_HEIGHT > window.innerHeight - margin) {
      top = Math.max(margin, window.innerHeight - POPUP_HEIGHT - margin);
    }
    p.style.left = left + 'px';
    p.style.top = top + 'px';
  }

  function setPopupContent(word, result) {
    if (popupWord !== word) return;
    const fullUrl = DICTIONARY_URL + encodeURIComponent(word);
    const safeUrl = escapeHtml(fullUrl);
    const safeWord = escapeHtml(word);
    let body;
    if (result.error) {
      body = '<p class="msg">Could not load definition for <b>' + safeWord + '</b>. ' +
        '<a href="' + safeUrl + '">Open on Cambridge Dictionary</a>.</p>';
    } else if (result.missing || !result.entries) {
      body = '<p class="msg">No definition found for <b>' + safeWord + '</b>. ' +
        '<a href="' + safeUrl + '">Open on Cambridge Dictionary</a>.</p>';
    } else {
      body = renderEntries(word, result.entries) +
        '<p class="more"><a href="' + safeUrl + '">Open on Cambridge Dictionary →</a></p>';
    }
    const srcdoc = [
      '<!DOCTYPE html>',
      '<html><head>',
      '<base target="_blank">',
      '<meta charset="utf-8">',
      '<style>',
      'html, body { margin: 0; padding: 0; font-family: system-ui, sans-serif; font-size: 14px; line-height: 1.45; color: #222; }',
      'body { padding: 12px 14px; }',
      'h2.word { margin: 0 0 2px 0; font-size: 20px; }',
      '.phonetic { color: #777; font-style: italic; margin-bottom: 8px; }',
      'section.meaning { border-top: 1px solid #eee; padding-top: 8px; margin-top: 8px; }',
      'section.meaning:first-of-type { border-top: 0; padding-top: 0; margin-top: 0; }',
      'h3.pos { margin: 0 0 4px 0; font-size: 13px; color: #555; font-style: italic; font-weight: normal; }',
      'ol.defs { margin: 0; padding-left: 20px; }',
      'ol.defs li { margin-bottom: 6px; }',
      '.example { color: #777; font-style: italic; margin-top: 2px; }',
      'a { color: #0073bb; }',
      'p.msg { margin: 0; }',
      'p.more { margin: 12px 0 0 0; padding-top: 8px; border-top: 1px solid #eee; font-size: 13px; }',
      '</style>',
      '</head><body>', body, '</body></html>',
    ].join('');

    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-popups allow-popups-to-escape-sandbox');
    iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;';
    iframe.srcdoc = srcdoc;
    popupContentEl.replaceChildren(iframe);
  }

  function setPopupLoading(word) {
    popupContentEl.innerHTML = '<p style="padding:12px;color:#666;">Looking up <b>' + escapeHtml(word) + '</b>…</p>';
  }

  function showDefinitionPopup(word, anchor) {
    const p = ensurePopup();
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    popupWord = word;
    positionPopup(anchor);
    p.style.display = 'block';
    setPopupLoading(word);
    fetchDefinition(word).then((result) => setPopupContent(word, result));
  }

  function schedulePopupHide() {
    if (popupPinned) return;
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (popupEl) popupEl.style.display = 'none';
      popupWord = null;
      hideTimer = null;
    }, HIDE_DELAY_MS);
  }

  function hidePopup() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (popupEl) popupEl.style.display = 'none';
    popupWord = null;
    popupPinned = false;
  }

  // Read the word at hover/click time rather than capturing it in the
  // closure. The Buddy page reuses the same row elements across tabs
  // (A/C/D/E/…), only updating the `.word` text; if we cached the word
  // at wire-up we'd look up the original tab's word forever.
  function attachWordInteractions(wordEl, getWord) {
    wordEl.addEventListener('mouseenter', () => {
      if (hoverTimer) clearTimeout(hoverTimer);
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      hoverTimer = setTimeout(() => {
        hoverTimer = null;
        const word = getWord();
        if (!word) return;
        showDefinitionPopup(word, wordEl);
      }, HOVER_DELAY_MS);
    });
    wordEl.addEventListener('mouseleave', () => {
      if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
      if (popupPinned) return;
      schedulePopupHide();
    });
    wordEl.addEventListener('click', (e) => {
      // Don't let the row's own click handler fire (e.g. Buddy's
      // "Reveal clue" toggle on the tile list).
      e.stopPropagation();
      if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
      const word = getWord();
      if (!word) return;
      // Click on the currently-pinned word: toggle off.
      if (popupPinned && popupWord === word && popupEl &&
        popupEl.style.display !== 'none') {
        hidePopup();
        return;
      }
      popupPinned = true;
      showDefinitionPopup(word, wordEl);
    });
  }

  // Click anywhere outside the popup (or a word we've wired up) closes a
  // pinned popup. Capture phase so we see it before the page does, and we
  // still let the click reach the page since we're not inside an
  // interactive word.
  document.addEventListener('click', (e) => {
    if (!popupPinned) return;
    if (popupEl && popupEl.contains(e.target)) return;
    const onWord = e.target.closest && e.target.closest('[' + LOOKUP_MARKER_ATTR + ']');
    if (onWord) return;
    hidePopup();
  }, true);

  function attachLookupHandlers() {
    let added = 0;

    // Spelling Bee puzzle page: found-words list and Yesterday's Answers modal.
    document.querySelectorAll(WORDLIST_ITEM_SELECTOR).forEach((span) => {
      if (span.hasAttribute(LOOKUP_MARKER_ATTR)) return;
      attachWordInteractions(span, () => (span.textContent || '').trim().toLowerCase());
      span.setAttribute(LOOKUP_MARKER_ATTR, '1');
      added++;
    });

    // Spelling Bee Buddy page: found word rows. Both the bar-graph list
    // and the "You've already found:" tile list share this markup.
    document.querySelectorAll(BUDDY_FOUND_ROW_SELECTOR).forEach((row) => {
      const wordEl = row.querySelector(BUDDY_WORD_SELECTOR);
      if (!wordEl || wordEl.hasAttribute(LOOKUP_MARKER_ATTR)) return;
      attachWordInteractions(wordEl, () => (wordEl.textContent || '').replace(/\s+/g, '').toLowerCase());
      wordEl.setAttribute(LOOKUP_MARKER_ATTR, '1');
      added++;
    });

    if (added > 0) {
      console.log(TAG, 'wired lookup handlers on', added, 'word(s)');
    }
  }

  tryDismissWelcome();
  tryDismissCongrats();
  tryAddBuddyLink();
  attachLookupHandlers();

  const observer = new MutationObserver(() => {
    tryDismissWelcome();
    tryDismissCongrats();
    tryAddBuddyLink();
    attachLookupHandlers();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class'],
  });
})();
