// ==UserScript==
// @name         Garmin Connect: Download activities button
// @namespace    https://github.com/jshute96/userscripts
// @version      0.1.2
// @description  Adds a "Download activities" button to the top toolbar that jumps to the Activities list and opens Strava's upload page in a background tab.
// @author       Jeff Shute <jshute@gmail.com>
// @match        https://connect.garmin.com/app/*
// @grant        GM_openInTab
// @noframes
// @run-at       document-idle
// @updateURL    https://github.com/jshute96/userscripts/raw/refs/heads/main/sites/connect.garmin.com/download-activities-button.user.js
// @downloadURL  https://github.com/jshute96/userscripts/raw/refs/heads/main/sites/connect.garmin.com/download-activities-button.user.js
// ==/UserScript==

(function () {
    'use strict';

    const TAG = '[garmin-dl]';
    const BUTTON_ID = 'jshute-garmin-download-activities-btn';
    const ACTIVITIES_URL = 'https://connect.garmin.com/app/activities';
    const STRAVA_UPLOAD_URL = 'https://www.strava.com/upload/select';

    // The CSS-module class names have build-hash suffixes
    // (e.g. TopHeaderBarView_navToggle__WzQWw); match by stable prefix.
    const TOGGLE_SELECTOR = 'button[class*="TopHeaderBarView_navToggle"]';

    console.log(TAG, 'init on', location.pathname);

    function openStravaInBackgroundTab() {
        // Tampermonkey gives us a real "background tab" via GM_openInTab.
        if (typeof GM_openInTab === 'function') {
            try {
                GM_openInTab(STRAVA_UPLOAD_URL, { active: false, setParent: true });
                return;
            } catch (e) {
                console.log(TAG, 'GM_openInTab failed, falling back:', e);
            }
        }
        // Fallback: simulate a Ctrl/Cmd+click on a temporary anchor, which
        // most browsers treat as "open in background tab". Requires the
        // surrounding click handler's user-activation context.
        const a = document.createElement('a');
        a.href = STRAVA_UPLOAD_URL;
        a.target = '_blank';
        a.rel = 'noopener';
        a.style.display = 'none';
        document.body.appendChild(a);
        const isMac = /mac/i.test(navigator.platform);
        a.dispatchEvent(new MouseEvent('click', {
            bubbles: true, cancelable: true,
            ctrlKey: !isMac, metaKey: isMac,
        }));
        a.remove();
    }

    function onClick(ev) {
        ev.preventDefault();
        console.log(TAG, 'clicked: opening Strava upload + navigating to /app/activities');
        // Open Strava first, while we still have user-activation, so the
        // browser will allow the popup/new tab. Then navigate this page.
        openStravaInBackgroundTab();
        window.location.assign(ACTIVITIES_URL);
    }

    // Inherit the className from an existing "secondary medium" Garmin
    // button (e.g. "Edit Home") so we automatically match its look,
    // without hardcoding the build-hashed CSS-module suffixes (which
    // change every deploy). We exclude `iconButton` variants — those
    // strip the background/padding and would make us look flat.
    const SECONDARY_SELECTOR =
        'button[class*="Button_btn"][class*="Button_secondary"][class*="Button_medium"]:not([class*="iconButton"])';
    const FALLBACK_SELECTORS = [
        'button[class*="Button_btn"][class*="Button_secondary"]:not([class*="iconButton"])',
        'button[class*="Button_btn"][class*="Button_medium"]:not([class*="iconButton"])',
    ];

    function findGarminButtonClass() {
        const sels = [SECONDARY_SELECTOR, ...FALLBACK_SELECTORS];
        for (const s of sels) {
            const ref = document.querySelector(s);
            if (ref) return ref.className;
        }
        return null;
    }

    function inheritGarminButtonClass(btn) {
        const cls = findGarminButtonClass();
        if (cls) { btn.className = cls; return true; }
        return false;
    }

    function makeButton() {
        const btn = document.createElement('button');
        btn.id = BUTTON_ID;
        btn.type = 'button';
        btn.textContent = 'Download activities';
        btn.title = 'Open Activities and Strava upload page';
        if (!inheritGarminButtonClass(btn)) {
            // Fallback: inline styling close to the Garmin "secondary"
            // button look, in case no reference button exists on this page.
            Object.assign(btn.style, {
                padding: '8px 16px',
                border: '0',
                borderRadius: '4px',
                background: '#d8d8d8',
                color: '#101010',
                font: '600 14px/20px "Open Sans", "Helvetica Neue", Helvetica, Arial, sans-serif',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
            });
        }
        // Spacing from the nav toggle, applied separately so it doesn't
        // get clobbered by the inherited className.
        btn.style.marginLeft = '8px';
        btn.addEventListener('click', onClick);
        return btn;
    }

    function ensureButton() {
        if (document.getElementById(BUTTON_ID)) return false;
        const toggle = document.querySelector(TOGGLE_SELECTOR);
        if (!toggle || !toggle.parentElement) return false;
        const btn = makeButton();
        toggle.parentElement.insertBefore(btn, toggle.nextSibling);
        console.log(TAG, 'button inserted next to nav toggle');
        return true;
    }

    // First attempt immediately; the toolbar may already be in the DOM.
    if (!ensureButton()) {
        console.log(TAG, 'toggle not found yet; watching for it');
    }

    // The Garmin SPA tears down and rebuilds the toolbar on some
    // navigations. Re-insert whenever it's missing. Also upgrade our
    // className if a "secondary" reference button (e.g. "Edit Home")
    // has rendered since we first inserted — at script start time
    // only the toolbar exists, and the toolbar's buttons are all
    // iconButton/primary variants.
    const observer = new MutationObserver(() => {
        const existing = document.getElementById(BUTTON_ID);
        if (!existing) { ensureButton(); return; }
        if (!/Button_secondary/.test(existing.className)) {
            const ref = document.querySelector(SECONDARY_SELECTOR);
            if (ref && ref.className !== existing.className) {
                existing.className = ref.className;
                console.log(TAG, 'upgraded button styling to secondary');
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();
