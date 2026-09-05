// ==UserScript==
// @name         Trailforks Map: Show star rating in trail popups
// @namespace    https://github.com/jshute96/userscripts
// @version      0.1.0
// @description  The trail summary popup on maps lists several things, but leaves out the star rating. This adds it.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://www.trailforks.com/*
// @grant        none
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[tf-rating]';
  // Marks a popup we have already added a rating to, so the observer doesn't
  // insert a second row on every later mutation.
  const MARK = 'data-jshute-tf-rating';
  const STYLE_MARK = 'data-jshute-tf-rating-style';
  const ROW_CLASS = 'jshute-tf-rating-row';
  const STARS_CLASS = 'jshute-tf-stars';
  // pb.rmsSend is defined by the site's own scripts, which are still loading
  // at document-idle. Give them a while, then stand down quietly — most pages
  // on the site have no map at all.
  const WAIT_FOR_SITE_MS = 15000;
  const WAIT_POLL_MS = 250;

  // nid -> {alias, name, rating}, for trails we have successfully looked up.
  // A lookup that came back unreadable is deliberately not cached, so the next
  // click on that trail tries again.
  const cache = new Map();

  function log(...args) {
    console.log(TAG, ...args);
  }

  function injectStyle() {
    if (document.querySelector('style[' + STYLE_MARK + ']')) return;
    const style = document.createElement('style');
    style.setAttribute(STYLE_MARK, '');
    // Two stacked rows of stars: grey underneath, gold on top clipped to the
    // rating's width. That renders fractional ratings exactly and doesn't
    // depend on Trailforks' own star CSS being loaded on map pages.
    style.textContent = `
      .${STARS_CLASS} {
        position: relative;
        display: inline-block;
        color: #ccc;
        letter-spacing: 1px;
        vertical-align: -1px;
      }
      .${STARS_CLASS}::before { content: '\\2605\\2605\\2605\\2605\\2605'; }
      .${STARS_CLASS} > span {
        position: absolute;
        left: 0;
        top: 0;
        overflow: hidden;
        white-space: nowrap;
        color: #ffb400;
      }
      .${STARS_CLASS} > span::before { content: '\\2605\\2605\\2605\\2605\\2605'; }
    `;
    document.head.appendChild(style);
  }

  function aliasFromHref(href) {
    return (/\/trails\/([^/?#]+)/.exec(href || '') || [])[1] || null;
  }

  // The trail this response is about, as the alias in the links back to its
  // own page. `/trails/all/...` is the site-wide trail listing, not a trail.
  function aliasFromDoc(doc) {
    for (const a of doc.querySelectorAll('a[href*="/trails/"]')) {
      const alias = aliasFromHref(a.getAttribute('href'));
      if (alias && alias !== 'all') return alias;
    }
    return null;
  }

  function ratingFromHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // The rating widget the detail panel renders: the <ul> carries the score
    // as a percentage, and both numbers readably in its tooltip.
    const ul = doc.querySelector('.star-rating ul[data-type="trail"]');
    if (!ul) return null;
    const title = ul.getAttribute('title') || '';
    // Unrated trails come back as "0 / 5", with no vote clause at all. Vote
    // counts are grouped once they reach four figures ("with 1,234 votes").
    const m = /([\d.]+)\s*\/\s*5(?:\s+with\s+([\d,]+)\s+votes?)?/i.exec(title);
    const alias = aliasFromDoc(doc);
    if (m) {
      return {
        avg: parseFloat(m[1]),
        votes: m[2] ? parseInt(m[2].replace(/,/g, ''), 10) : 0,
        alias: alias,
      };
    }
    // Fallback: the average on a 0-100 scale, with no vote count available.
    const score = parseFloat(ul.getAttribute('data-score'));
    if (!isFinite(score)) return null;
    return { avg: score / 20, votes: score > 0 ? null : 0, alias: alias };
  }

  function ratingRow(rating) {
    const li = document.createElement('li');
    li.className = ROW_CLASS;

    const label = document.createElement('span');
    label.className = 'label grey';
    label.textContent = 'Rating:';
    li.appendChild(label);
    li.appendChild(document.createTextNode(' '));

    if (rating.votes === 0) {
      const none = document.createElement('span');
      none.className = 'grey';
      none.textContent = 'not rated';
      li.appendChild(none);
      return li;
    }

    const stars = document.createElement('span');
    stars.className = STARS_CLASS;
    stars.title = rating.avg.toFixed(2) + ' / 5';
    const fill = document.createElement('span');
    fill.style.width = (rating.avg / 5 * 100) + '%';
    stars.appendChild(fill);
    li.appendChild(stars);

    li.appendChild(document.createTextNode(' ' + rating.avg.toFixed(2)));

    // The vote count is unknown when we had to fall back to the raw score.
    if (rating.votes !== null) {
      const votes = document.createElement('span');
      votes.className = 'grey';
      votes.textContent = ' (' + rating.votes + (rating.votes === 1 ? ' vote)' : ' votes)');
      li.appendChild(votes);
    }
    return li;
  }

  // The popup for a trail. Route and point-of-interest popups reuse the same
  // container, so check that this one links to a trail page.
  function currentTrailPopup() {
    const popup = document.querySelector('#mapWindowContent .marker_info');
    if (!popup) return null;
    const link = popup.querySelector('a.viewtrail');
    if (!link || !/\/trails\//.test(link.getAttribute('href') || '')) return null;
    return popup;
  }

  // Which cached lookup, if any, describes the popup that is on screen. The
  // popup and its rating arrive independently, so this has to be decided from
  // the popup itself rather than from whichever trail was clicked last.
  function entryForPopup(popup) {
    const alias = aliasFromHref(popup.querySelector('a.viewtrail').getAttribute('href'));
    const heading = popup.querySelector('h1');
    const name = heading ? heading.textContent.trim() : null;
    for (const entry of cache.values()) {
      if (entry.alias ? entry.alias === alias : name && name.indexOf(entry.name) === 0) {
        return entry;
      }
    }
    return null;
  }

  function tryInject() {
    const popup = currentTrailPopup();
    if (!popup || popup.hasAttribute(MARK)) return;
    const entry = entryForPopup(popup);
    if (!entry) return;
    const list = popup.querySelector('ul.infolist');
    if (!list) {
      console.warn(TAG, 'popup has no .infolist to add a rating to');
      return;
    }
    injectStyle();
    popup.setAttribute(MARK, '');
    list.insertBefore(ratingRow(entry.rating), list.firstChild);
    const rating = entry.rating;
    log('rating added for trail', entry.nid + ':',
        rating.votes === 0 ? 'not rated'
          : rating.votes === null ? rating.avg.toFixed(2) + ', vote count unknown'
          : rating.avg.toFixed(2) + ' from ' + rating.votes +
            (rating.votes === 1 ? ' vote' : ' votes'));
  }

  // Ask for the same marker the map just asked for, but with the site's newer
  // "detail panel" template, which does include the rating.
  function requestRating(send, data) {
    const nid = data.nid;
    if (cache.has(nid)) {
      log('cache hit for trail', nid);
      tryInject();
      return;
    }
    log('trail popup opening, fetching rating for trail', nid);
    send({ ...data, panel: 'detailpanel' }, function (res) {
      if (!res || !res.rmsS) {
        console.warn(TAG, 'rating request failed for trail', nid, res);
        return;
      }
      const html = typeof res.rmsD === 'string' ? res.rmsD : (res.rmsD && res.rmsD.content) || '';
      const rating = ratingFromHtml(html);
      if (!rating) {
        // Say nothing rather than claim the trail is unrated: an unreadable
        // response means the widget moved, not that nobody has voted. Not
        // caching it also lets the next click on this trail try again.
        console.warn(TAG, 'no rating widget in response for trail', nid);
        return;
      }
      // The alias ties the answer to a specific trail page, which is what the
      // popup links to; the name is the weaker fallback if that link moves.
      cache.set(nid, { nid: nid, alias: rating.alias, name: data.name, rating: rating });
      tryInject();
    }, function (err) {
      console.warn(TAG, 'rating request errored for trail', nid, err);
    });
  }

  function start() {
    log('init, watching map popups');
    const orig = window.pb.rmsSend;
    window.pb.rmsSend = function (data, onSuccess, onError, light) {
      try {
        // The legacy popup asks for a marker without a `panel`; the newer
        // detail panel passes panel:"detailpanel" and already shows a rating,
        // so leave that one alone.
        if (data && data.op === 'marker_info' && data.type === 'trail' && !data.panel) {
          requestRating(orig.bind(window.pb), data);
        }
      } catch (err) {
        console.warn(TAG, 'error handling marker request', err);
      }
      return orig.apply(this, arguments);
    };

    // The popup's contents are rebuilt on every map click, and our rating may
    // arrive either before or after them.
    const mapWindow = document.getElementById('mapWindow');
    if (mapWindow) {
      new MutationObserver(tryInject).observe(mapWindow, { childList: true, subtree: true });
    }
  }

  const deadline = Date.now() + WAIT_FOR_SITE_MS;
  (function waitForSite() {
    if (window.pb && typeof window.pb.rmsSend === 'function' && document.getElementById('mapWindow')) {
      start();
    } else if (Date.now() < deadline) {
      setTimeout(waitForSite, WAIT_POLL_MS);
    } else {
      log('no map popup on this page, standing down');
    }
  })();
})();
