// ==UserScript==
// @name         NYTimes Spelling Bee: Word definitions and other tweaks
// @namespace    https://github.com/jshute96/userscripts
// @version      1.1.0
// @description  Shows definitions when you hover or click a word, adds a toolbar link to Spelling Bee Buddy, and closes the splash screens for you.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://www.nytimes.com/puzzles/spelling-bee*
// @match        https://www.nytimes.com/interactive/2023/upshot/spelling-bee-buddy.html*
// @grant        GM_xmlhttpRequest
// @connect      freedictionaryapi.com
// @connect      api.datamuse.com
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[spelling-bee]';
  const WELCOME_SELECTOR = '.pz-moment__welcome';
  const WELCOME_CONTINUE_SELECTOR = '.pz-moment__welcome .pz-moment__button.primary';
  const CONGRATS_SELECTOR = '.pz-moment__congrats';
  const CONGRATS_KEEP_PLAYING_SELECTOR = '.pz-moment__congrats .pz-moment__close_text';
  // Three different screens render under `.pz-moment__congrats`:
  //   * the intermediate rank-up moment, which has a "Keep playing"
  //     `.pz-moment__close_text` — this is the one we dismiss;
  //   * the end-of-puzzle screen (Queen Bee / final stats), which has no
  //     "Keep playing" at all, just an X plus "Share your achievement"
  //     and "View all games";
  //   * the "welcome back" version of the rank screen, shown on returning
  //     to a puzzle already at Genius, which has "Keep playing" *and* the
  //     share / view-all buttons. We dismiss it too.
  // So "Keep playing" wins whenever it's present. Only without it do we
  // check for the final screen, which is a legitimate end state rather
  // than a broken selector, and leave it alone silently.
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
  // Hover-popup data sources, tried in order. Both are keyless JSON APIs
  // built on Wiktionary data, so the definitions are short clean prose
  // rather than a scraped dictionary page. Each source parses its own
  // response into one common shape — a list of
  //   { phonetic, meanings: [{ partOfSpeech, definitions: [{ definition, example }] }] }
  // — which is what the renderer consumes. Each source also carries an
  // `attribution` line, shown in the popup footer: both draw on
  // Wiktionary, whose text is CC BY-SA 4.0 and asks to be credited
  // (Datamuse mixes in WordNet, which likewise wants its notice kept).
  const DEFINITION_SOURCES = [
    {
      // Primary: has IPA pronunciations and example sentences.
      name: 'freedictionaryapi.com',
      attribution: 'Definitions from <a href="https://en.wiktionary.org/">Wiktionary</a> ' +
        '(<a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>) ' +
        'via <a href="https://freedictionaryapi.com/">Free Dictionary API</a>',
      url: (word) => 'https://freedictionaryapi.com/api/v1/entries/en/' + encodeURIComponent(word),
      // Unknown words are a 200 with an empty `entries` list, not a 404.
      parse: (data) => (data.entries || []).map((entry) => ({
        phonetic: ((entry.pronunciations || []).find((p) => p.type === 'ipa') || {}).text,
        meanings: [{
          partOfSpeech: entry.partOfSpeech,
          definitions: (entry.senses || []).map((sense) => ({
            definition: sense.definition,
            example: (sense.examples || [])[0],
          })),
        }],
      })),
    },
    {
      // Fallback: Datamuse's `md=d` metadata flag. Long-running and very
      // stable, but no pronunciation or examples, and `sp=` is a *spelling
      // pattern* (fuzzy) — asking for an unknown word returns the nearest
      // real one, so the result has to be checked against the query.
      name: 'datamuse',
      attribution: 'Definitions from <a href="https://en.wiktionary.org/">Wiktionary</a> ' +
        '(<a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>) ' +
        'and <a href="https://wordnet.princeton.edu/">WordNet</a> ' +
        'via <a href="https://www.datamuse.com/api/">Datamuse</a>',
      url: (word) => 'https://api.datamuse.com/words?max=1&md=d&sp=' + encodeURIComponent(word),
      parse: (data, word) => {
        const hit = Array.isArray(data) && data[0];
        // A known word with no definition has no `defs` at all.
        if (!hit || hit.word !== word || !hit.defs || hit.defs.length === 0) return [];
        // Each def is "<pos>\t<definition>", e.g. "n\tA covering of tiles."
        const byPos = new Map();
        hit.defs.forEach((def) => {
          const i = def.indexOf('\t');
          const pos = DATAMUSE_POS[def.slice(0, i)] || def.slice(0, i);
          if (!byPos.has(pos)) byPos.set(pos, []);
          byPos.get(pos).push({ definition: def.slice(i + 1).trim() });
        });
        return [{
          meanings: Array.from(byPos, ([partOfSpeech, definitions]) => ({ partOfSpeech, definitions })),
        }];
      },
    },
  ];
  const DATAMUSE_POS = { n: 'noun', v: 'verb', adj: 'adjective', adv: 'adverb', u: '' };
  // A CDN-fronted source can cache a 5xx against the exact URL, so the
  // *same* word then fails on every retry while other words are fine.
  // Later attempts append a unique query param to get a distinct cache
  // key and reach the origin again.
  const DEFINITION_RETRIES = 2;
  const RETRY_DELAY_MS = 400;
  // GM_xmlhttpRequest has no default timeout, so a stalled request never
  // settles and the popup sits on "Looking up…" forever. When a source's
  // origin is down, its CDN can take ~20s to give up and return a 522, so
  // we cut it off long before that.
  //
  // 1.5s is generous for a healthy response: both sources answered in
  // ~0.25s when measured, and a lookup is either fast or it's a
  // timeout — there's no observed "slow but succeeds" regime. So a longer
  // timeout buys no extra successes, only a longer wait before giving up.
  const REQUEST_TIMEOUT_MS = 1500;
  // Budget across all attempts at one source. Without it, retrying a slow
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
    const btn = document.querySelector(CONGRATS_KEEP_PLAYING_SELECTOR);
    if (!btn) {
      if (isFinalMoment(moment)) {
        if (!finalMomentLogged) {
          finalMomentLogged = true;
          console.log(TAG, 'end-of-puzzle screen — nothing to dismiss');
        }
        return;
      }
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
  async function fetchWithRetries(word, base) {
    const sep = base.includes('?') ? '&' : '?';
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
      const url = attempt === 0 ? base : base + sep + '_cb=' + (++cacheBustCounter) + '-' + Date.now();
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

  // One source's answer: { entries, error, missing }.
  async function lookupFromSource(source, word) {
    const response = await fetchWithRetries(word, source.url(word));
    try {
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
      const entries = source.parse(JSON.parse(response.text), word);
      if (entries.length === 0) {
        return { entries: null, error: false, missing: true };
      }
      return { entries, attribution: source.attribution, error: false };
    } catch (err) {
      console.warn(TAG, 'definition parse failed for', word, 'from', source.name, err);
      return { entries: null, error: true };
    }
  }

  // Sources that have errored out this session (timed out, 5xx, garbage
  // — not merely "word not found"). A dead source costs up to
  // LOOKUP_DEADLINE_MS per word before the next one gets a turn, so
  // once a source fails we stop trying it *first*: it moves behind the
  // healthy sources for the rest of the session and is only consulted
  // when they've all come up empty. A later success there restores it.
  const demotedSources = new Set();

  // Debugging aid: `?sbDictSource=<name or index>` on the page URL pins
  // lookups to that one source, so each can be checked on its own
  // (e.g. `?sbDictSource=datamuse`, or `?sbDictSource=1`).
  const PINNED_SOURCE_PARAM = 'sbDictSource';
  const pinnedSource = (() => {
    const value = new URLSearchParams(location.search).get(PINNED_SOURCE_PARAM);
    if (value === null) return null;
    const source = DEFINITION_SOURCES[Number(value)] ||
      DEFINITION_SOURCES.find((s) => s.name === value);
    if (source) {
      console.log(TAG, 'definition lookups pinned to', source.name, 'by', PINNED_SOURCE_PARAM);
    } else {
      console.warn(TAG, 'unknown', PINNED_SOURCE_PARAM, JSON.stringify(value),
        '- choices:', DEFINITION_SOURCES.map((s, i) => i + '=' + s.name).join(', '));
    }
    return source || null;
  })();

  function sourcesInOrder() {
    if (pinnedSource) return [pinnedSource];
    const healthy = DEFINITION_SOURCES.filter((s) => !demotedSources.has(s.name));
    const demoted = DEFINITION_SOURCES.filter((s) => demotedSources.has(s.name));
    return healthy.concat(demoted);
  }

  // Try each source in turn until one has the word. A source that fails
  // or just doesn't know the word hands off to the next; the answer is
  // "missing" only if every source reports that.
  async function lookupDefinition(word) {
    let anyError = false;
    for (const source of sourcesInOrder()) {
      const result = await lookupFromSource(source, word);
      if (result.entries) {
        console.log(TAG, 'definition for', word, 'from', source.name);
        if (demotedSources.delete(source.name)) {
          console.log(TAG, source.name, 'is answering again — restoring its priority');
        }
        return result;
      }
      anyError = anyError || result.error;
      console.log(TAG, 'no definition for', word, 'from', source.name,
        result.error ? '(error)' : '(not found)');
      if (result.error && !demotedSources.has(source.name)) {
        demotedSources.add(source.name);
        console.warn(TAG, source.name, 'failed — trying other sources first for the rest of this session');
      }
    }
    return { entries: null, error: anyError, missing: !anyError };
  }

  function fetchDefinition(word) {
    if (definitionCache.has(word)) return definitionCache.get(word);
    const p = lookupDefinition(word);
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
    // Sources often return multiple entries per word (one per etymology
    // or part of speech); we just flatten them, taking the first
    // pronunciation found.
    const phonetic = entries.map((e) => e.phonetic).find(Boolean);
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
        '<p class="more"><a href="' + safeUrl + '">Open on Cambridge Dictionary →</a></p>' +
        '<p class="credit">' + (result.attribution || '') + '</p>';
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
      'p.credit { margin: 6px 0 0 0; font-size: 11px; color: #888; }',
      'p.credit a { color: #888; }',
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
