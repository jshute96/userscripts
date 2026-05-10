// ==UserScript==
// @name         Feedly: Sort/Filter presets
// @namespace    https://github.com/jshute96/userscripts
// @version      1.0.4
// @description  Add Oldest/Newest preset buttons to a Feedly feed's header toolbar that combine sort order and unread-only filter.
// @author       Jeff Shute <jshute@gmail.com>
// @match        https://feedly.com/i/subscription/content/feed*
// @grant        none
// @run-at       document-idle
// @updateURL    https://github.com/jshute96/userscripts/raw/refs/heads/main/sites/feedly.com/sort-filter-presets.user.js
// @downloadURL  https://github.com/jshute96/userscripts/raw/refs/heads/main/sites/feedly.com/sort-filter-presets.user.js
// ==/UserScript==

(function () {
    'use strict';

    const TAG = '[feedly presets]';

    if (window.__feedlyPresetsLoaded) {
        console.log(TAG, 'already loaded; skipping duplicate run');
        return;
    }
    window.__feedlyPresetsLoaded = true;

    console.log(TAG, 'init');

    // Attribute that flags buttons we've added so we can detect re-renders.
    const MARK = 'data-jshute-preset';

    // Main menu items live in role="menuitem" elements with a child
    // <span> holding the visible label ("Sort by", "Filter by", etc).
    // Submenu options are matched separately by findOption() below
    // since Feedly uses a mix of role values for them.
    function findMainMenuItem(label) {
        return [...document.querySelectorAll('[role="menuitem"]')].find(el => {
            // Match strictly on the first-level label span. The same menuitem
            // also contains a <p> with the current value (e.g. "Oldest"), and
            // we don't want to confuse those.
            const span = el.querySelector('span');
            return span && span.textContent.trim() === label;
        });
    }

    function findOption(label) {
        // Sort/Filter submenu options use role="radio" or role="checkbox"
        // (Feedly does not use the ARIA menuitemradio/menuitemcheckbox
        // variants here). We accept a broader set as a safety net and match
        // case-insensitively because Feedly capitalizes inconsistently
        // (e.g. submenu shows "Unread Only" while the main-menu summary
        // text says "1 enabled").
        const candidates = document.querySelectorAll(
            '[role="radio"], [role="checkbox"], [role="menuitemradio"],' +
            ' [role="menuitemcheckbox"], [role="option"]'
        );
        const wanted = label.trim().toLowerCase();
        return [...candidates].find(el => {
            // Some <li> options have an SVG icon child whose textContent is
            // empty — trim() suffices to ignore whitespace. We exclude the
            // back-to-main-menu button by requiring the role be option-like
            // (selected above) and matching on the visible label text.
            return el.textContent.trim().toLowerCase() === wanted;
        });
    }

    function waitFor(predicate, timeoutMs = 2000) {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            const tick = () => {
                let result;
                try { result = predicate(); } catch (e) { result = null; }
                if (result) return resolve(result);
                if (Date.now() - start > timeoutMs) {
                    return reject(new Error('waitFor timeout'));
                }
                requestAnimationFrame(tick);
            };
            tick();
        });
    }

    function sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }

    function getMoreButton() {
        // The three-dots button in the header is a <button> with
        // aria-haspopup="listbox". Mark-as-read also has that attribute
        // but on its wrapping <div> (not the inner button), so this
        // selector uniquely targets the three-dots trigger. We must NOT
        // require aria-controls here because Feedly only sets it while
        // the menu is open — when closed the attribute is absent.
        const header = document.querySelector('.StreamPage header');
        if (!header) return null;
        return header.querySelector('button[aria-haspopup="listbox"]');
    }

    async function openMoreMenu() {
        const btn = getMoreButton();
        if (!btn) throw new Error('no more-menu button');
        // Three possible states to handle:
        //   1. Main menu already showing → done.
        //   2. A submenu is showing (Feedly does not auto-return to the
        //      main menu after a selection, and toggling the trigger
        //      from the submenu state doesn't reliably land us back on
        //      the main menu either) → click the breadcrumb's
        //      "Back to Main Menu" button.
        //   3. Menu closed → click the trigger to open.
        if (findMainMenuItem('Sort by')) return;
        const back = document.querySelector('button[aria-label="Back to Main Menu"]');
        if (back) {
            console.log(TAG, 'returning from submenu to main');
            back.click();
            await waitFor(() => findMainMenuItem('Sort by'));
            return;
        }
        btn.click();
        await waitFor(() => findMainMenuItem('Sort by'));
    }

    async function closeMoreMenu() {
        const btn = getMoreButton();
        if (!btn) return;
        // Clicking the trigger from a submenu state often does NOT
        // dismiss the popup (it may navigate back one level instead).
        // Escape closes reliably from any state. Loop a few times in
        // case the first Escape only closes the submenu.
        for (let i = 0; i < 5 && btn.getAttribute('aria-expanded') === 'true'; i++) {
            document.body.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Escape', code: 'Escape', bubbles: true, cancelable: true,
            }));
            await sleep(80);
        }
    }

    async function chooseSort(value /* 'Oldest' | 'Newest' */) {
        await openMoreMenu();
        const sortBy = findMainMenuItem('Sort by');
        if (!sortBy) throw new Error('no Sort by item');
        // Already in the chosen state? The current value is shown in the <p>
        // sibling of the label span; skip the click if it already matches.
        const currentValue = sortBy.querySelector('p')?.textContent.trim();
        if (currentValue === value) {
            console.log(TAG, 'sort already', value);
            return;
        }
        sortBy.click();
        // Submenu may take a frame to render. Hover sometimes also works,
        // but click() is the most reliable trigger across React versions.
        const option = await waitFor(() => findOption(value));
        console.log(TAG, 'clicking sort option', value);
        option.click();
        // Feedly typically closes the menu after a sort selection. Give the
        // DOM a moment to settle before the next step re-opens it.
        await sleep(150);
    }

    async function setUnreadOnly(wantChecked) {
        await openMoreMenu();
        const filterBy = findMainMenuItem('Filter by');
        if (!filterBy) throw new Error('no Filter by item');
        filterBy.click();
        const option = await waitFor(() => findOption('Unread only'));
        const checked = option.getAttribute('aria-checked') === 'true';
        if (checked === wantChecked) {
            console.log(TAG, 'unread-only already', wantChecked);
        } else {
            console.log(TAG, 'toggling unread-only ->', wantChecked);
            option.click();
        }
        await sleep(150);
        await closeMoreMenu();
    }

    async function applyPreset(preset) {
        try {
            console.log(TAG, 'applying preset', preset);
            if (preset === 'oldest') {
                await chooseSort('Oldest');
                await setUnreadOnly(true);
            } else {
                await chooseSort('Newest');
                await setUnreadOnly(false);
            }
            console.log(TAG, 'preset applied:', preset);
        } catch (err) {
            console.log(TAG, 'failed to apply preset', preset, err);
            // Try to leave the menu closed even on error.
            try { await closeMoreMenu(); } catch (_) { /* ignore */ }
        }
    }

    function makeButton(label, preset) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        btn.setAttribute(MARK, preset);
        btn.title = preset === 'oldest'
            ? 'Sort by Oldest, show Unread only'
            : 'Sort by Newest, show all articles';
        // Match Feedly's neutral button look without depending on its
        // (obfuscated) class names. Inline styles keep this self-contained.
        Object.assign(btn.style, {
            margin: '0 4px',
            padding: '4px 10px',
            fontSize: '13px',
            fontWeight: '500',
            background: 'transparent',
            border: '1px solid var(--color-border, #d0d0d0)',
            borderRadius: '6px',
            cursor: 'pointer',
            color: 'inherit',
        });
        btn.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            applyPreset(preset);
        });
        return btn;
    }

    function findToolbarContainer() {
        // The smallest header descendant that contains both the rightmost
        // toolbar button (three-dots) and the Mark-as-read button is the
        // toolbar's flex row. We inject our buttons as its first children
        // so they appear to the left of the existing icons.
        const header = document.querySelector('.StreamPage header');
        if (!header) return null;
        const more = getMoreButton();
        const markAsRead = header.querySelector('button[aria-label="Mark as read"]');
        if (!more || !markAsRead) return null;
        let container = more.parentElement;
        while (container && container !== header) {
            if (container.contains(markAsRead) && container.contains(more)) {
                return container;
            }
            container = container.parentElement;
        }
        return null;
    }

    function injectButtons() {
        const container = findToolbarContainer();
        if (!container) return false;
        // Already injected for this header instance?
        if (container.querySelector(`[${MARK}]`)) return true;

        console.log(TAG, 'injecting preset buttons');
        const wrap = document.createElement('span');
        wrap.setAttribute(MARK, 'wrap');
        wrap.style.display = 'inline-flex';
        wrap.style.alignItems = 'center';
        wrap.style.marginRight = '6px';
        wrap.appendChild(makeButton('Oldest', 'oldest'));
        wrap.appendChild(makeButton('Newest', 'newest'));
        container.insertBefore(wrap, container.firstChild);
        return true;
    }

    // Feedly is an SPA: navigating between feeds re-renders the header.
    // Re-inject whenever the DOM changes and our buttons aren't present.
    let pending = false;
    function scheduleInject() {
        if (pending) return;
        pending = true;
        requestAnimationFrame(() => {
            pending = false;
            injectButtons();
        });
    }

    const observer = new MutationObserver(scheduleInject);
    observer.observe(document.body, { childList: true, subtree: true });
    // Initial attempt — header may not yet exist at document-idle.
    scheduleInject();
})();
