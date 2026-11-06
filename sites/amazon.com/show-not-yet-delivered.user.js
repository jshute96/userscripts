// ==UserScript==
// @name         Amazon: Show orders not yet delivered
// @namespace    https://github.com/jshute96/userscripts
// @version      0.1.4
// @description  Adds a "Not Yet Delivered" tab on the "Your Orders" page, next to "Not Yet Shipped".
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://www.amazon.com/your-orders/*
// @match        https://www.amazon.com/gp/*/order-history*
// @noframes
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const log = (...args) => console.log('[not delivered]', ...args);

  const VIEW_PARAM = 'notYetDelivered';
  const ORDERS_URL = '/your-orders/orders';
  const RECENT_URL = `${ORDERS_URL}?timeFilter=months-3`;
  const OPEN_URL = `${ORDERS_URL}?orderFilter=open`;
  const VIEW_URL = `${RECENT_URL}&${VIEW_PARAM}=1`;

  const TAB_ID = 'not-yet-delivered-tab';
  const LIST_ID = 'not-yet-delivered-list';
  const STATUS_ID = 'not-yet-delivered-status';

  const LOAD_TIMEOUT_MS = 30000;
  const POLL_MS = 200;

  // Shipment statuses that mean no delivery is pending. Any other status
  // counts as not delivered, so a wording Amazon adds later shows up in the
  // list rather than hiding an order. These stay specific for the same reason:
  // "Replacement arriving Tuesday" or "Returning to sender" must not match.
  const FINISHED_STATUS =
    /^(delivered|picked up|cancel|refund|returned|return (started|complete)|replacement (ordered|complete))/i;

  const STATUS_SELECTOR = '.yohtmlc-shipment-status-primaryText';

  const inView = new URLSearchParams(location.search).has(VIEW_PARAM);

  let hidingStyle;

  // Hide what the server rendered before it paints, so the plain order list
  // doesn't flash up before the filtered one.
  function hideServerContent() {
    const style = document.createElement('style');
    style.dataset.showNotYetDelivered = '';
    style.textContent = `
      .order-card:not(#${LIST_ID} .order-card),
      .js-time-filter-form,
      .a-pagination {
        display: none !important;
      }
    `;
    document.documentElement.append(style);
    hidingStyle = style;
  }

  // Returns whether the tab is on the page. While the page is still being
  // parsed, the "Not Yet Shipped" tab may not be there yet.
  function addTab() {
    if (document.getElementById(TAB_ID)) return true;
    const tabs = [...document.querySelectorAll('.page-tabs__tab')];
    const shipped = tabs.find((tab) => /^not yet shipped$/i.test(tab.textContent.trim()));
    if (!shipped) return false;

    const tab = document.createElement('li');
    tab.id = TAB_ID;
    tab.className = 'page-tabs__tab';
    if (inView) {
      // The page itself is the Orders tab, as far as the server knows.
      for (const selected of tabs.filter((t) => t.matches('.page-tabs__tab--selected'))) {
        selected.classList.remove('page-tabs__tab--selected');
        selected.replaceChildren(makeLink(selected.textContent.trim(), ORDERS_URL));
      }
      tab.classList.add('page-tabs__tab--selected');
      tab.textContent = 'Not Yet Delivered';
    } else {
      tab.append(makeLink('Not Yet Delivered', VIEW_URL));
    }
    shipped.after(tab);
    log(`tab added after ${Math.round(performance.now())} ms, page ${document.readyState}`);
    return true;
  }

  function makeLink(text, href) {
    const link = document.createElement('a');
    link.className = 'a-link-normal';
    link.href = href;
    link.textContent = text;
    return link;
  }

  // Order cards are encrypted in the page's HTML, and the page's own code
  // decrypts them on load, so a plain fetch can't read them. Loading a page in
  // a hidden frame lets that code run. Setting src before adding the frame
  // keeps it out of the tab's history.
  function openHiddenFrame(url) {
    const frame = document.createElement('iframe');
    frame.src = url;
    frame.tabIndex = -1;
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText =
      'position: fixed; left: -10000px; top: 0; width: 1280px; height: 900px; visibility: hidden;';
    document.body.append(frame);
    return frame;
  }

  function isDecrypted(doc) {
    return doc.readyState !== 'loading' &&
      !!doc.querySelector('.js-yo-main-content') &&
      !doc.querySelector('.order-card .csd-encrypted-sensitive');
  }

  async function waitForOrders(getDoc, url) {
    const deadline = Date.now() + LOAD_TIMEOUT_MS;
    while (Date.now() < deadline) {
      // A sign-in or robot-check page never gets here, and times out.
      const doc = getDoc();
      if (doc && isDecrypted(doc)) return doc;
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    throw new Error(`timed out loading ${url}`);
  }

  // Passes the page's order cards to onCards, and returns the next page's URL.
  function readPage(doc, onCards) {
    onCards([...doc.querySelectorAll('.order-card')]);
    return doc.querySelector('.a-pagination li.a-last a')?.getAttribute('href');
  }

  // Reads each page of a paged list, starting from the given URL.
  async function readPagesFrom(startUrl, onCards) {
    let url = startUrl;
    while (url) {
      const frame = openHiddenFrame(url);
      try {
        const doc = await waitForOrders(() => frame.contentDocument, url);
        url = readPage(doc, onCards);
      } finally {
        frame.remove();
      }
    }
  }

  function orderId(card) {
    return card.dataset.csaCSlotId?.match(/\d{3}-\d{7}-\d{7}/)?.[0];
  }

  function isFinished(status) {
    return FINISHED_STATUS.test(status.textContent.trim());
  }

  // A card has one status per shipment, and any shipment may still be coming.
  function hasUndeliveredShipment(card) {
    return [...card.querySelectorAll(STATUS_SELECTOR)].some((status) => !isFinished(status));
  }

  // Keeps only the pending shipments in a card with some finished ones. Each
  // shipment's box follows its own divider.
  function removeFinishedShipments(card) {
    for (const box of card.querySelectorAll('.delivery-box')) {
      const status = box.querySelector(STATUS_SELECTOR);
      if (!status || !isFinished(status)) continue;
      if (box.previousElementSibling?.matches('hr')) box.previousElementSibling.remove();
      box.remove();
    }
  }

  async function showView() {
    const status = document.createElement('p');
    status.id = STATUS_ID;
    status.className = 'a-spacing-base';
    status.textContent = 'Loading orders...';
    const list = document.createElement('div');
    list.id = LIST_ID;
    const tabs = document.querySelector('.page-tabs');
    if (tabs) {
      // The status goes below the list, so removing it doesn't move the cards.
      tabs.after(list, status);
    } else {
      const main = document.querySelector('.js-yo-main-content');
      if (!main) {
        log('no order list on the page');
        hidingStyle.remove();
        return;
      }
      main.prepend(list, status);
    }

    const seen = new Set();
    const addCards = (cards) => {
      for (const card of cards) {
        const id = orderId(card);
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        removeFinishedShipments(card);
        list.append(card);
      }
      if (list.childElementCount > 0) status.textContent = 'Still loading...';
    };

    try {
      const addRecentCards = (cards) => addCards(cards.filter(hasUndeliveredShipment));

      // The view's own URL is the first page of recent orders, so that page is
      // already here, once it finishes parsing and decrypting.
      const firstPage = await waitForOrders(() => document, location.href);
      await readPagesFrom(readPage(firstPage, addRecentCards), addRecentCards);

      // Recent orders came first, newest first. Any not-yet-shipped order
      // missing from them is older than the window, so it belongs at the end.
      await readPagesFrom(OPEN_URL, addCards);

      if (list.childElementCount === 0) {
        status.textContent = 'No pending orders found.';
      } else {
        status.remove();
      }
      log('found', list.childElementCount, 'orders');
    } catch (error) {
      status.textContent = `Couldn't load all order pages: ${error.message}`;
      log('failed:', error);
    }
  }

  if (inView) hideServerContent();

  log('init');

  // The page is large and paints as it parses, so waiting for DOMContentLoaded
  // would make the tab pop in visibly late. Add it as soon as its neighbor is
  // parsed instead.
  let started = false;
  function start() {
    if (started) return;
    started = true;
    observer.disconnect();
    if (inView) showView();
  }

  function finishStartup() {
    if (!addTab()) log('no "Not Yet Shipped" tab found');
    start();
  }

  const observer = new MutationObserver(() => {
    if (addTab()) start();
  });

  if (document.readyState === 'loading') {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', finishStartup, { once: true });
  } else {
    finishStartup();
  }
})();
