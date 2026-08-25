// ==UserScript==
// @name         Pinkbike: Auto-close the floating footer ads
// @namespace    https://github.com/jshute96/userscripts
// @version      1.3.2
// @description  Stops the sticky ad banners that cover article text at the bottom of the page from ever sliding in, and closes any that still appear.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://www.pinkbike.com/*
// @grant        none
// @noframes
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[pinkbike ad]';

  // Each entry is one ad unit we know how to dismiss. `container` locates
  // the overlay; `close` locates the click target inside it. Optional
  // `preempt` names a global function the page itself uses to dismiss the
  // unit for good — see tryPreempt().
  const TARGETS = [
    {
      // Pinkbike's own sticky footer (Google Ad Manager slot sticky-footer-pb).
      // Shown and hidden with jQuery fadeIn/fadeOut on scroll.
      name: 'sticky footer',
      container: '#nfs_footer',
      close: '#sticky-footer-pb-close',
      preempt: 'nfs_footerClose',
    },
    {
      // Underdog Media ("udm") adhesion unit, injected by a third-party tag.
      // The close handler sits on the div, not the <svg> inside it.
      name: 'udm adhesion',
      container: '.udm-inpage-footer-container',
      close: '.udm-close-button',
    },
  ];

  const STATUS_DELAY_MS = 15000;

  // How long to keep looking for a `preempt` function before concluding it
  // isn't coming and falling back to clicking, and how often to re-check.
  const PREEMPT_DEADLINE_MS = 5000;
  const PREEMPT_POLL_MS = 200;

  // A click landing mid-fade is undone by the rest of the animation, so we
  // wait for the fade to finish — but by watching for it rather than by
  // sitting out a fixed worst-case delay.
  //
  // Measured on a live article: jQuery's fadeIn("slow") holds an inline
  // `opacity` for the whole 600ms ramp and *removes the property* in its
  // completion step. So full computed opacity with no inline opacity left
  // is a precise "the animation is over" signal, with no margin needed.
  // SETTLE_MS is the fallback for a unit that simply parks at inline
  // opacity 1 and never animates.
  const POLL_MS = 50;
  const SETTLE_MS = 120;

  // If a unit never reaches opacity 1 (a vendor could park one at 0.95),
  // stop waiting and click anyway rather than watching it forever.
  const MAX_SETTLE_WAIT_MS = 1500;

  // With the click aimed at a settled unit, these only cover a click that
  // genuinely failed, so they no longer have to outlast a fade.
  const VERIFY_DELAY_MS = 300;
  const CLICK_COOLDOWN_MS = 250;

  // Stop clicking a container that keeps ignoring us, rather than retrying
  // for the life of the page. Consecutive failures back the cooldown off
  // linearly (250ms, 500ms, 750ms, …): with the click now aimed at a settled
  // unit a retry is rare, so repeated failures mean something is actually
  // wrong, and hammering a broken close button a dozen times over the ~16s
  // those backed-off retries span is both useless and rude — each click
  // fires the site's analytics event.
  const MAX_ATTEMPTS = 12;

  console.log(TAG, 'initializing');

  // These overlays are position:fixed, so offsetParent is always null and
  // can't be used. They also hide themselves via visibility/opacity rather
  // than display, so check all three plus the measured box.
  function isVisible(el) {
    if (!el) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  const state = TARGETS.map((t) => ({
    target: t,
    seen: false,
    attempts: 0,
    closes: 0,
    lastClickAt: 0,
    preemptCalled: false,
    preemptThrew: false,
    preempted: false,
    preemptGaveUp: false,
    visibleSince: 0,
    opaqueSince: 0,
    gaveUp: false,
  }));

  function verify(entry) {
    const t = entry.target;
    if (isVisible(document.querySelector(t.container))) {
      console.warn(TAG, 'click did not stick on ' + t.name +
        ' (attempt ' + entry.attempts + ' of ' + MAX_ATTEMPTS + ')');
      if (entry.attempts >= MAX_ATTEMPTS) {
        entry.gaveUp = true;
        console.warn(TAG, 'giving up on ' + t.name + ' — its close button may have changed');
      } else {
        // Retry under our own timer. The fade that undid the click was the
        // page's last activity, so waiting for another mutation to drive the
        // next sweep can mean waiting for the rest of the page's life.
        scheduleSweep(0);
      }
      return;
    }
    entry.closes += 1;
    // MAX_ATTEMPTS is about consecutive failures. A close that sticks means
    // the button still works, so a long read that re-shows the ad many times
    // must not exhaust the budget and report a break that isn't one.
    entry.attempts = 0;
    console.log(TAG, t.name + ' ad closed' + (entry.closes > 1 ? ' (again, x' + entry.closes + ')' : ''));
  }

  // Best case: don't close the ad, stop it from ever showing.
  //
  // Pinkbike's own close button runs nfs_footerClose(), which hides the unit
  // *and* sets a page-level flag its scroll handler checks before every
  // fade-in. Calling that function ourselves at startup therefore suppresses
  // the unit for the life of the page — no fade to wait out, nothing visible
  // even briefly, and the ad slot stays display:none.
  //
  // It's reachable because the page declares it as a top-level function in a
  // classic script, so it lands on `window`, and `@grant none` puts us in
  // that same world. A manager that ran us in an isolated world would not see
  // it — hence the typeof check and the fall back to clicking, which is why
  // the click machinery below stays in place regardless.
  function tryPreempt(entry) {
    const t = entry.target;
    if (!t.preempt || entry.preemptCalled || entry.preemptGaveUp) return;
    const fn = window[t.preempt];
    if (typeof fn !== 'function') {
      if (performance.now() - startedAt > PREEMPT_DEADLINE_MS) {
        entry.preemptGaveUp = true;
        console.log(TAG, t.name + ': ' + t.preempt + '() not reachable — ' +
          'relying on the click path');
      }
      return;
    }
    // Two flags, because they answer different questions. `preemptCalled`
    // stops a throw part-way turning into a same-sweep retry loop;
    // `preempted` is set only on a clean return, because that is what the
    // status line means by "suppressed up front" — a call that threw has
    // not dealt with the unit and must not claim to have.
    entry.preemptCalled = true;
    try {
      fn();
      entry.preempted = true;
      console.log(TAG, t.name + ' suppressed up front via ' + t.preempt + '()');
    } catch (e) {
      // A throw is usually "defined but not ready yet" — the function is
      // there before the slot it dismisses is — so it gets the same grace
      // period as "not defined yet" rather than being fatal on the first
      // one. Making it fatal meant one early throw dropped the unit to the
      // click path for the life of the page, and the ad visibly slides in
      // before it's closed, which is the whole thing preempting avoids.
      if (performance.now() - startedAt > PREEMPT_DEADLINE_MS) {
        entry.preemptGaveUp = true;
        console.warn(TAG, t.name + ': ' + t.preempt + '() kept throwing — ' +
          'relying on the click path', e);
        return;
      }
      entry.preemptCalled = false; // a later sweep tries again
      if (!entry.preemptThrew) {
        entry.preemptThrew = true; // once per unit; sweeps are frequent
        console.warn(TAG, t.name + ': ' + t.preempt + '() threw; retrying until ' +
          PREEMPT_DEADLINE_MS / 1000 + 's', e);
      }
    }
  }

  function tryClose(entry) {
    if (entry.gaveUp || entry.attempts >= MAX_ATTEMPTS) return;
    const t = entry.target;
    const container = document.querySelector(t.container);
    if (!container || !isVisible(container)) {
      entry.visibleSince = 0;
      entry.opaqueSince = 0;
      return;
    }
    if (!entry.seen) {
      entry.seen = true;
      console.log(TAG, t.name + ' ad detected (' + t.container + ')');
    }
    const now = performance.now();
    if (!entry.visibleSince) entry.visibleSince = now;

    // Wait for the fade-in to finish rather than clicking into it. A unit
    // that arrives already opaque settles on the first sweep, so nothing
    // that appears without an animation pays for this.
    if (getComputedStyle(container).opacity === '1') {
      if (!entry.opaqueSince) entry.opaqueSince = now;
    } else {
      // Dropping back below 1 is a *new* fade, not more of the one we
      // already waited out, so the deadline restarts with it. Without this
      // `visibleSince` only ever resets when the container goes away, so
      // 1.5s into an appearance the gate below is open for good and every
      // later sweep clicks straight into a fade — the exact race the gate
      // exists to prevent. (Only on the transition: a unit parked below 1
      // forever never sets `opaqueSince`, so its deadline still fires.)
      if (entry.opaqueSince) entry.visibleSince = now;
      entry.opaqueSince = 0;
    }
    const settled = entry.opaqueSince &&
      (!container.style.opacity || now - entry.opaqueSince >= SETTLE_MS);
    if (!settled && now - entry.visibleSince < MAX_SETTLE_WAIT_MS) {
      scheduleSweep(POLL_MS);
      return;
    }

    const cooling = CLICK_COOLDOWN_MS * Math.max(1, entry.attempts) -
      (now - entry.lastClickAt);
    if (cooling > 0) {
      scheduleSweep(cooling);
      return;
    }
    const btn = container.querySelector(t.close);
    if (!btn) {
      console.warn(TAG, t.name + ' is visible but close button not found (' + t.close + ')');
      return;
    }
    entry.attempts += 1;
    entry.lastClickAt = now;
    console.log(TAG, 'clicking close on ' + t.name);
    btn.click();
    setTimeout(() => verify(entry), VERIFY_DELAY_MS);
  }

  const SWEEP_DEBOUNCE_MS = 100;
  const startedAt = performance.now();

  let observer = null;
  let pending = null;
  let pendingDueAt = 0;

  function sweep() {
    pending = null;
    pendingDueAt = 0;
    state.forEach(tryPreempt);
    state.forEach(tryClose);
    // Keep looking for a preempt function that hasn't been defined yet, under
    // our own timer — the page may go quiet before its scripts have run.
    if (state.some((e) => e.target.preempt && !e.preemptCalled && !e.preemptGaveUp)) {
      scheduleSweep(PREEMPT_POLL_MS);
    }
    // Keep watching even after a successful close: the site re-shows these
    // units on scroll, and a fade can undo a click we thought had landed.
    if (state.every((e) => e.gaveUp || e.attempts >= MAX_ATTEMPTS) && observer) {
      console.log(TAG, 'nothing left to try — disconnecting observer');
      observer.disconnect();
      observer = null;
    }
  }

  // The page mutates constantly while ads load and fade, so coalesce bursts.
  // Callers that are waiting on a cooldown pass their own delay; whichever
  // sweep is due soonest wins, so a mutation can still pull one forward.
  function scheduleSweep(delayMs) {
    const delay = delayMs === undefined ? SWEEP_DEBOUNCE_MS : delayMs;
    const dueAt = performance.now() + delay;
    if (pending !== null) {
      if (dueAt >= pendingDueAt) return;
      clearTimeout(pending);
    }
    pendingDueAt = dueAt;
    pending = setTimeout(sweep, delay);
  }

  // Wrapped, not passed directly: the observer would hand its mutation list
  // to scheduleSweep as the delay.
  observer = new MutationObserver(() => scheduleSweep());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['style', 'class'],
  });

  sweep();

  // Distinguish "the ad never appeared" (normal) from "we found it and
  // couldn't close it" (a break) without needing DevTools open from load.
  setTimeout(function () {
    const summary = state
      .map((e) => {
        const open = isVisible(document.querySelector(e.target.container));
        // Every fact this line knows, rather than the first one that
        // applies. A preempt that returned cleanly but didn't actually
        // hold would otherwise report `suppressed up front` while the
        // click path was underneath it burning its whole budget — the
        // exact break this line exists to make visible.
        const parts = [];
        if (e.preempted) parts.push('suppressed up front');
        if (!e.seen) parts.push('not seen');
        else if (e.gaveUp) parts.push('SEEN, GAVE UP');
        else parts.push('closed x' + e.closes);
        if (open) parts.push('OPEN NOW');
        return e.target.name + ': ' + parts.join(', ');
      })
      .join(', ');
    console.log(TAG, 'status after ' + STATUS_DELAY_MS / 1000 + 's — ' + summary);
  }, STATUS_DELAY_MS);
})();
