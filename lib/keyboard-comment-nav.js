// Shared comment-thread keyboard navigation for userscripts.
//
// NOT a userscript — no metadata block. Requires keyboard-shortcuts.js
// to be @require'd first:
//
//   // @require https://raw.githubusercontent.com/jshute96/userscripts/main/lib/keyboard-shortcuts.js
//   // @require https://raw.githubusercontent.com/jshute96/userscripts/main/lib/keyboard-comment-nav.js
//
// A site supplies selectors and one tree accessor; this file supplies
// all nine key bindings and the behavior behind them.
//
// The whole tree model is a flat display-ordered list of comments plus
// `parentOf(el)`. Everything else — siblings, thread root, next thread,
// skip-past-subtree — derives from those two. That's what makes the
// keys work on every site regardless of how deep the threading goes:
//
//   * Nested threads (HN, Reddit): all nine keys are distinct.
//   * One level of replies: `r` collapses onto `p`, `n` onto `m`, and
//     `h`/`l` step root-to-root or reply-to-reply within a thread.
//   * Flat comments (no `parentOf` at all): every comment is at depth
//     zero, so `h`/`n`/`m` all become `j`, `l` becomes `k`, and
//     `p`/`r` have nowhere to go.
//
// The duplication in the shallow cases is deliberate. Every key is
// bound on every site and does the most sensible available thing, so
// there's one set of keys to learn rather than one per site.

const CommentNav = (function () {
  'use strict';

  // Minimum pixels of a comment's body that must be visible below any
  // sticky header for it to count as "current". A bare
  // `rect.bottom > 0` test is fooled by the sliver of the previous
  // comment still bleeding behind the header, which makes `j` re-pick
  // it and stall.
  const MIN_VISIBLE_PX = 30;

  // ---------------------------------------------------------------
  // Scroll strategies
  // ---------------------------------------------------------------
  // Sites differ here for real reasons, not by accident, so this stays
  // pluggable:
  //   intoView  — plain scrollIntoView on the window (most sites)
  //   settle    — intoView plus drift correction, for pages that grow
  //               above the target while the animation runs
  //   container — a panel with its own scroll container
  //   raf       — hand-rolled easing, for containers where the native
  //               smooth scroll silently no-ops

  function scrollWindow(el, offset) {
    if (!offset) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    // scrollIntoView has no offset option and scroll-margin-top would
    // have to be set per element, so compute it directly.
    const y = el.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
  }

  function scrollContainer(el, offset, container) {
    const top = container.scrollTop
      + (el.getBoundingClientRect().top - container.getBoundingClientRect().top)
      - offset;
    container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }

  // For containers where scrollIntoView and scrollTo both silently
  // no-op (observed on WaPo's fixed drawer with scrollbar-gutter:
  // stable). Direct scrollTop assignment is the only thing that moves
  // them, so the easing is hand-rolled on top of it.
  function scrollRaf(el, offset, container) {
    const target = container.scrollTop
      + (el.getBoundingClientRect().top - container.getBoundingClientRect().top)
      - offset;
    const start = container.scrollTop;
    const delta = Math.max(0, target) - start;
    if (Math.abs(delta) < 1) return;
    const dur = Math.min(350, 120 + Math.abs(delta) * 0.4);
    const t0 = performance.now();
    function step(t) {
      const p = Math.min(1, (t - t0) / dur);
      container.scrollTop = start + delta * (0.5 - 0.5 * Math.cos(Math.PI * p));
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  // Drift-correcting window scroll.
  //
  // `scrollIntoView` computes its destination offset once, when it's
  // called, and animates to that fixed offset. A page that lazy-loads
  // images and injects ad slots while you read keeps growing *above*
  // the target during the ~1s animation, pushing it further down the
  // document — so we stop short. Jumping to the comments from the top
  // of a long article is the worst case: it crosses the whole page.
  //
  // So after the scroll settles, re-measure and re-issue if the target
  // moved. A couple of corrections is plenty; the page stops growing
  // quickly once it's near the target.
  const DRIFT_TOLERANCE_PX = 4;
  const MAX_CORRECTIONS = 3;
  const SETTLE_TICKS = 3;            // consecutive equal scrollY samples
  const CORRECTION_TIMEOUT_MS = 4000;
  // Chrome takes a frame or two to start a smooth scroll. Without a
  // grace period the "scrollY hasn't moved" test passes before the
  // animation has begun, and we'd spend corrections re-issuing a
  // scroll that was already on its way.
  const SETTLE_GRACE_MS = 250;

  // The browser can't always put the target at the top: the last
  // comments sit within one viewport height of the document end, so
  // the scroll clamps and the target stays part-way down. That's the
  // browser doing all it can, not drift — correcting would re-issue
  // the same clamped scroll and then log a failure for a jump that
  // worked fine.
  function scrollIsClamped() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    return window.scrollY <= 0 || window.scrollY >= max - 1;
  }

  function makeSettleScroller(tag) {
    let token = 0;
    function abort() { token++; }

    function scroll(el, offset) {
      const mine = ++token;
      scrollWindow(el, offset);

      const started = performance.now();
      const deadline = started + CORRECTION_TIMEOUT_MS;
      let lastY = null;
      let stable = 0;
      let corrections = 0;

      function tick() {
        if (mine !== token) return;    // superseded or aborted
        const y = Math.round(window.scrollY);
        stable = (y === lastY) ? stable + 1 : 0;
        lastY = y;
        if (stable >= SETTLE_TICKS
            && performance.now() - started > SETTLE_GRACE_MS) {
          const top = Math.round(el.getBoundingClientRect().top - offset);
          if (Math.abs(top) <= DRIFT_TOLERANCE_PX) return;   // landed
          if (scrollIsClamped()) return;                     // as close as it gets
          if (corrections >= MAX_CORRECTIONS) {
            console.log(tag, `scroll still ${top}px off after`,
              corrections, 'corrections; giving up');
            return;
          }
          corrections++;
          console.log(tag, `scroll drifted ${top}px, correcting (${corrections})`);
          scrollWindow(el, offset);
          stable = 0;
        }
        if (performance.now() < deadline) {
          requestAnimationFrame(tick);
        } else {
          console.log(tag, 'scroll settle timed out at',
            Math.round(el.getBoundingClientRect().top - offset) + 'px');
        }
      }
      requestAnimationFrame(tick);
    }

    return { scroll, abort };
  }

  // ---------------------------------------------------------------
  // Key table
  // ---------------------------------------------------------------
  // The one place bindings are defined, shared by every site.

  // key, help-screen description, action, log name. Registration
  // order is the order they appear on the `?` help screen, so it runs
  // outward: within a comment, then up, then past.
  const BINDINGS = [
    ['j', 'Go to next comment',                   'next',        'next'],
    ['k', 'Go to previous comment',               'prev',        'prev'],
    ['h', 'Go to next comment at this level',     'siblingNext', 'sibling-next'],
    ['l', 'Go to previous comment at this level', 'siblingPrev', 'sibling-prev'],
    ['p', 'Go to parent comment',                 'parent',      'parent'],
    ['r', 'Go to root comment of this thread',    'root',        'root'],
    ['n', 'Go to next comment at parent level',   'parentNext',  'parent-next'],
    ['m', 'Go to next comment at root level',     'rootNext',    'root-next'],
  ];

  // ---------------------------------------------------------------
  // parentMapper — for sites where per-element parent lookup is O(n)
  // ---------------------------------------------------------------
  // `depthOf` and `rootsOf` call parentOf once per comment, so a
  // parentOf that scans the list on each call makes them quadratic.
  // Sites in that shape (anything resolving the parent by scanning
  // backwards through the comment list) should derive the whole map in
  // one pass instead and wrap it here.
  //
  //   parentOf: CommentNav.parentMapper(all => {
  //     const map = new Map();
  //     … one left-to-right pass …
  //     return map;
  //   })
  //
  // The library builds the comment array fresh on every keypress and
  // then passes that same array everywhere, so keying the cache on it
  // gives exactly one build per keypress and O(1) lookups within it.
  // A WeakMap means the entry dies with the array.
  //
  // Sites whose parent is a DOM ancestor (`closest`) are already O(depth)
  // per call and don't need this.
  function parentMapper(build) {
    const cache = new WeakMap();
    return (el, all) => {
      let map = cache.get(all);
      if (!map) {
        map = build(all);
        cache.set(all, map);
      }
      return map.get(el) || null;
    };
  }

  function create(spec) {
    const tag = spec.tag;
    const enabled = spec.enabled || (() => true);
    const bodyOf = spec.body || (el => el);
    const parentOf = spec.parentOf || (() => null);
    const containerOf = spec.container || (() => null);
    const headerOffset = spec.headerOffset || (() => 0);
    const idOf = spec.id || null;

    const settler = makeSettleScroller(tag);
    const strategy = spec.strategy || 'intoView';

    function scrollToEl(el) {
      const offset = headerOffset();
      const container = containerOf();
      // Both container strategies dereference the container, and a
      // site's container() can legitimately come up empty — NYT walks
      // the drawer looking for a computed overflow-y and gives up
      // after 8 levels, WaPo walks composed ancestors for a scrollable
      // host. Falling back to a window scroll degrades to "probably
      // wrong place" instead of throwing out of the keydown handler,
      // where the failure would be invisible without DevTools open.
      if ((strategy === 'container' || strategy === 'raf') && !container) {
        console.log(tag, 'scroll container not found; using window scroll');
        return scrollWindow(el, offset);
      }
      switch (strategy) {
        case 'settle':    return settler.scroll(el, offset);
        case 'container': return scrollContainer(el, offset, container);
        case 'raf':       return scrollRaf(el, offset, container);
        default:          return scrollWindow(el, offset);
      }
    }

    // -------------------------------------------------------------
    // The comment list
    // -------------------------------------------------------------

    // Re-queried on every keypress, never cached. The visible set can
    // change at any moment — lazy "show replies" expansion, SPA
    // navigation, filter tabs, sort changes, new comments arriving —
    // and re-querying handles all of them without subscribing to any
    // of the site's own events.
    function comments() {
      // Drop comments inside a display:none ancestor (collapsed
      // threads, hidden tab panes). They have zero-area rects, so
      // they never qualify as "current", but `j` from the comment
      // before them would happily pick them as a target and the
      // scroll would resolve to a degenerate position — looking
      // exactly like `j` being stuck.
      return spec.comments().filter(el => el.offsetParent !== null);
    }

    // Best available identity for a non-comment element (the
    // comments-section anchor), for logs.
    function describeEl(el) {
      if (el.id) return `#${el.id}`;
      if (typeof el.className === 'string' && el.className) return `.${el.className.trim().split(/\s+/).join('.')}`;
      return el.tagName.toLowerCase();
    }

    function label(el, all) {
      const i = all.indexOf(el);
      // A site's id() can legitimately come up empty for a given
      // element; fall back to the position rather than logging
      // "undefined".
      const base = (idOf && idOf(el)) || `#${i + 1}`;
      return i >= 0 ? base : `${base}?`;
    }

    // -------------------------------------------------------------
    // Tree derivations — everything below comes from parentOf
    // -------------------------------------------------------------

    function depthOf(el, all) {
      let d = 0;
      let r = el;
      let p;
      while ((p = parentOf(r, all))) { r = p; d++; }
      return d;
    }

    function rootOf(el, all) {
      let r = el;
      let p;
      while ((p = parentOf(r, all))) r = p;
      return r;
    }

    function rootsOf(all) {
      return all.filter(c => !parentOf(c, all));
    }

    // -------------------------------------------------------------
    // Current comment
    // -------------------------------------------------------------

    // With smooth scrolling the viewport hasn't caught up by the time
    // the next keypress fires, so a pure viewport check would re-pick
    // the same source comment, recompute the same target, and look
    // like the script is doing nothing. Remember where we sent the
    // user and treat that as "current" until they move the viewport
    // themselves.
    let lastJumpTarget = null;

    function invalidate() {
      lastJumpTarget = null;
      settler.abort();
    }
    window.addEventListener('wheel', invalidate, { passive: true });
    window.addEventListener('touchmove', invalidate, { passive: true });

    function findCurrent(all) {
      if (lastJumpTarget && all.includes(lastJumpTarget)) return lastJumpTarget;
      const container = containerOf();
      // Compare against the panel's rect when comments live in their
      // own scroll container, and the window otherwise.
      const bounds = container
        ? container.getBoundingClientRect()
        : { top: 0, bottom: window.innerHeight };
      const gate = bounds.top + headerOffset() + MIN_VISIBLE_PX;
      for (const el of all) {
        const rect = bodyOf(el).getBoundingClientRect();
        if (rect.bottom > gate && rect.top < bounds.bottom) return el;
      }
      return null;
    }

    function jumpTo(el, all, how) {
      console.log(tag, `${how} -> ${label(el, all)}`);
      scrollToEl(el);
      lastJumpTarget = el;
    }

    // -------------------------------------------------------------
    // Actions
    // -------------------------------------------------------------
    // Each returns without scrolling (and logs why) when there's
    // nowhere to go. `p` and `r` on a root are the normal case of
    // that: they mean "go up", and there is no up from a root.

    // `list` is either the full comment list or a derived one (the
    // thread roots) that `current` is always a member of, so the
    // not-found branch is defensive only.
    function step(list, current, delta) {
      const i = list.indexOf(current);
      if (i < 0) return null;
      return list[i + delta] || null;
    }

    // The level moves (`h`, `l`, `n`, `m`) all scan display order for
    // the next comment no deeper than `maxDepth`, rather than indexing
    // into a sibling list.
    //
    // Sibling indexing dead-ends: on the last reply of a thread `h`
    // found no next sibling and reported "nowhere to go", even with
    // half the page still below — and `n` did the same whenever the
    // parent was itself a last child. Scanning by depth escalates on
    // its own. Where a sibling exists it *is* the first comment at or
    // above this depth (everything between is a descendant), so the
    // common case is unchanged; where one doesn't, we surface at the
    // nearest ancestor that has one instead of stopping.
    //
    // Nothing is skipped in either direction: forward, the comments
    // passed over are the current subtree; backward, they're the
    // previous sibling's subtree, and from a first child the previous
    // comment at or above its depth is the parent itself.
    function stepLevel(all, current, delta, maxDepth) {
      const start = all.indexOf(current);
      if (start < 0) return null;
      for (let i = start + delta; i >= 0 && i < all.length; i += delta) {
        if (depthOf(all[i], all) <= maxDepth) return all[i];
      }
      return null;
    }

    const ACTIONS = {
      next(all, current) {
        return current ? step(all, current, +1) : all[0];
      },
      prev(all, current) {
        return current ? step(all, current, -1) : null;
      },
      siblingNext(all, current) {
        if (!current) return all[0];
        return stepLevel(all, current, +1, depthOf(current, all));
      },
      siblingPrev(all, current) {
        if (!current) return null;
        return stepLevel(all, current, -1, depthOf(current, all));
      },
      parent(all, current) {
        return current ? parentOf(current, all) : null;
      },
      parentNext(all, current) {
        if (!current) return rootsOf(all)[0];
        // Walk past the parent's whole subtree. From a root there's no
        // parent to skip past, so it degrades to the next root.
        return stepLevel(all, current, +1, Math.max(0, depthOf(current, all) - 1));
      },
      root(all, current) {
        if (!current) return null;
        const r = rootOf(current, all);
        return r === current ? null : r;
      },
      rootNext(all, current) {
        if (!current) return rootsOf(all)[0];
        return stepLevel(all, current, +1, 0);
      },
    };

    // Log lines are `<key>: <action> -> <target>` so they stay
    // greppable and identical in shape across every site.
    // No `enabled()` check here: every binding below carries
    // `when: enabled`, and that placement is load-bearing — a binding
    // whose `when` is false isn't handled at all, so the keystroke
    // passes through to the site rather than being swallowed.
    function run(action, key, how) {
      const all = comments();
      if (!all.length) {
        console.log(tag, `${key}: ${how} — no comments found`);
        return;
      }
      const current = findCurrent(all);
      const target = ACTIONS[action](all, current);
      if (!target) {
        const from = current ? label(current, all) : 'no current comment';
        console.log(tag, `${key}: ${how} — nowhere to go from ${from}`);
        return;
      }
      jumpTo(target, all, `${key}: ${how}`);
    }

    // -------------------------------------------------------------
    // `c` — jump to the comments
    // -------------------------------------------------------------
    // On sites that don't render comments until a button is clicked,
    // `c` opens them; once they're up it scrolls to the top of the
    // section. It reports whether it did anything, so a page with
    // neither comments nor an open button lets the keystroke through
    // to the site.

    function commentsTopTarget() {
      return spec.commentsTop ? spec.commentsTop() : null;
    }

    function canJumpToComments() {
      return !!(commentsTopTarget() || (spec.open && spec.open.canOpen()));
    }

    function jumpToComments() {
      const target = commentsTopTarget();
      if (!target) {
        if (spec.open && spec.open.canOpen()) {
          console.log(tag, 'c: comments not shown yet, opening');
          spec.open.click();
          return;
        }
        console.log(tag, 'c: no comments anchor found');
        return;
      }
      console.log(tag, `c -> ${describeEl(target)}`);
      // Deliberately not stored as lastJumpTarget: `c` means "go to
      // the top of the section", and the next `j` should advance from
      // whatever comment the viewport actually lands on.
      invalidate();
      scrollToEl(target);
    }

    // -------------------------------------------------------------
    // Wire up
    // -------------------------------------------------------------

    const keys = KeyboardShortcuts.create({ tag, capture: !!spec.capture });

    // `c` is registered first so it heads the help screen: it's the
    // one key that's useful before you're in the comments at all.
    keys.register('c', 'Open the comments', jumpToComments,
      { when: canJumpToComments });

    for (const [key, description, action, how] of BINDINGS) {
      keys.register(key, description, () => run(action, key, how),
        { when: enabled });
    }

    // Any other key — PageUp/PageDown, arrows, space, Home/End —
    // means the user is moving the viewport themselves, so the
    // remembered jump target is no longer authoritative.
    keys.onUnhandledKey(invalidate);

    keys.logKeys();

    return { keys, findCurrent, comments, invalidate };
  }

  return { create, parentMapper };
})();
