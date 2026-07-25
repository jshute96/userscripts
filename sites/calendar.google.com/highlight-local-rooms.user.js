// ==UserScript==
// @name         calendar.google.com: highlight local rooms
// @namespace    https://github.com/jshute96/userscripts
// @version      1.7.0
// @description  Highlight meeting locations matching a configurable regex, to make it easy to find the local room in a long room list. Where room lists are shown as comma-separated text blobs, reformat them one per line.
// @author       Jeff Shute <jshute@gmail.com>
// @match        https://calendar.google.com/calendar/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @noframes
// ==/UserScript==

(function () {
    'use strict';

    // --- Customisation & Config setup ---
    const STORAGE_KEY = 'highlight-local-rooms:room-regex';
    const DEFAULT_REGEX_STRING = 'BUILDING[12]';
    const SENTINEL = Symbol('unset');
    const TAG = '[room highlight]';
    const HIGHLIGHT_CLASS = 'jshute-local-room-highlight';

    console.log(TAG, 'init');

    function readRegexString() {
        const val = GM_getValue(STORAGE_KEY, undefined);
        return val === undefined ? SENTINEL : val;
    }

    function getRoomRegex() {
        const val = readRegexString();
        const pattern = val === SENTINEL ? DEFAULT_REGEX_STRING : val;
        try {
            return new RegExp(pattern, 'i');
        } catch (e) {
            console.error(TAG, 'Invalid regex in storage:', val, e);
            return new RegExp(DEFAULT_REGEX_STRING, 'i');
        }
    }

    // Cached regex for active matching
    let targetRoomRegex = getRoomRegex();

    function promptForRegex() {
        const currentVal = readRegexString();
        let initial = currentVal === SENTINEL ? DEFAULT_REGEX_STRING : currentVal;

        while (true) {
            const entered = window.prompt(
                'Google Calendar room highlight — set local rooms regex pattern\n' +
                'Enter a regular expression pattern to match your local rooms (case-insensitive).',
                initial
            );

            if (entered === null) {
                console.log(TAG, 'set regex cancelled');
                return;
            }

            const trimmed = entered.trim();
            if (!trimmed) {
                console.log(TAG, 'rejected empty value');
                window.alert('Regex pattern cannot be empty. Please enter a valid pattern.');
                initial = entered;
                continue;
            }

            // Validate regular expression compilation
            try {
                new RegExp(trimmed, 'i');
            } catch (e) {
                console.log(TAG, 'invalid regex entered:', trimmed, e);
                window.alert(`Invalid regular expression pattern:\n${e.message}\n\nPlease check your syntax and try again.`);
                initial = entered;
                continue;
            }

            GM_setValue(STORAGE_KEY, trimmed);
            console.log(TAG, 'local room regex set to', JSON.stringify(trimmed));

            // Apply immediately to the active environment
            targetRoomRegex = getRoomRegex();

            // Re-evaluate highlighting immediately on open dialog if present
            const dialog = document.getElementById('xDetDlg');
            if (dialog) {
                console.log(TAG, 're-evaluating open dialog highlights with new regex');
                processDialog(dialog);
            }

            return;
        }
    }

    // Register static context menu command
    GM_registerMenuCommand('Set local room regex', promptForRegex);

    // State tracking variables to survive Virtual DOM / Wiz dynamic card transitions
    let lastEventTitle = '';

    // Inject our highlight styles.
    // Target the inline text blocks specifically: using display: inline-block ensures
    // the soft yellow highlights form a neat box hugging only the room name.
    const style = document.createElement('style');
    style.textContent = `
        .${HIGHLIGHT_CLASS} {
            background-color: #fff9c4 !important; /* soft yellow background */
            display: inline-block !important;
            padding: 1px 5px !important;
            border-radius: 3px !important;
        }
        .${HIGHLIGHT_CLASS}:hover {
            background-color: #fff59d !important; /* slightly darker yellow on hover */
        }
    `;
    document.head.appendChild(style);

    // Parse helper: split a string on commas but ignore commas inside square brackets [...]
    function splitOuterCommas(str) {
        const result = [];
        let current = '';
        let inBrackets = 0;

        for (let i = 0; i < str.length; i++) {
            const char = str[i];
            if (char === '[') {
                inBrackets++;
            } else if (char === ']') {
                inBrackets = Math.max(0, inBrackets - 1);
            }

            if (char === ',' && inBrackets === 0) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        if (current.trim()) {
            result.push(current.trim());
        }
        return result;
    }

    // Sig check: detect if a text location string represents a multi-room resource list
    function looksLikeRoomList(str) {
        const hasCapacity = /\(\d+\)/.test(str);
        const hasCommas = str.includes(',');
        return hasCapacity && hasCommas;
    }

    // Feature 1: Highlight room resource list items (under the 'meeting_room' icon)
    function highlightRoomResources(dialog) {
        // Find all room resource text blocks inside the dialog, excluding any custom text
        // location elements inside the location pin block (#xDetDlgLoc).
        const textBlocks = dialog.querySelectorAll('span.iGpjxc:not(#xDetDlgLoc span)');
        let highlightedCount = 0;

        console.log(TAG, `[TELEMETRY] highlightRoomResources found ${textBlocks.length} room text block(s)`);

        for (const textBlock of textBlocks) {
            const textContent = textBlock.textContent || '';
            const match = targetRoomRegex.test(textContent);

            console.log(TAG, `[TELEMETRY EVAL] Text content: "${textContent.trim().replace(/\s+/g, ' ')}"`);
            console.log(TAG, `   Regex matched outcome: ${match}`);

            if (match) {
                if (textBlock.classList.contains(HIGHLIGHT_CLASS)) continue;

                textBlock.classList.add(HIGHLIGHT_CLASS);
                highlightedCount++;
                console.log(TAG, `   [HIGHLIGHT ACTION] Added class to textBlock:`, textBlock.outerHTML.substring(0, 400));
            } else {
                // Stateless Cleanup: Under Wiz / Virtual DOM cell re-rendering (observable via jsaction/jscontroller attributes),
                // the DOM node wrapping a previously highlighted room might be
                // recycled to display a remote room.
                // Since Wiz does not track our custom class, the stale highlight
                // remains visible. We aggressively clean it up if it no longer matches.
                if (textBlock.classList.contains(HIGHLIGHT_CLASS)) {
                    textBlock.classList.remove(HIGHLIGHT_CLASS);
                    console.log(TAG, `   [CLEANUP ACTION] Removed class from textBlock:`, textBlock.outerHTML.substring(0, 400));
                }
            }
        }

        if (highlightedCount > 0) {
            console.log(TAG, `[TELEMETRY SUMMARY] applied precise highlight to ${highlightedCount} room resource text block(s)`);
        }
    }

    // Feature 2: Format and highlight text locations (under the maps pin icon in #xDetDlgLoc)
    function formatTextLocations(dialog) {
        const locEl = dialog.querySelector('#xDetDlgLoc');
        if (!locEl) return;

        // Target the anchor link inside #xDetDlgLoc, or fallback to locEl if plain text
        const targetEl = locEl.querySelector('a') || locEl;

        // Re-reformatting detection check is now strictly DOM-stateful:
        // If the anchor already contains child DOM structure (div block lines), it means
        // it has already been reformatted in this render cycle.
        // This is bulletproof to dynamic double-load updates since Wiz's dynamic content
        // overwrite resets the anchor to a single text node, naturally triggering a re-format!
        const hasChildLines = targetEl.querySelector('div, span') !== null;
        if (hasChildLines) {
            // Already split. We can just update the highlights of the existing room spans!
            console.log(TAG, `[TELEMETRY] Custom location list is already in formatted state. Updating highlights.`);
            const roomLines = targetEl.querySelectorAll('span');
            for (const roomLine of roomLines) {
                const roomText = roomLine.textContent;
                const match = targetRoomRegex.test(roomText);
                if (match) {
                    if (!roomLine.classList.contains(HIGHLIGHT_CLASS)) {
                        roomLine.classList.add(HIGHLIGHT_CLASS);
                        console.log(TAG, `   [DYNAMIC UPDATE] Highlighted list room line: "${roomText}"`);
                    }
                } else {
                    if (roomLine.classList.contains(HIGHLIGHT_CLASS)) {
                        roomLine.classList.remove(HIGHLIGHT_CLASS);
                        console.log(TAG, `   [DYNAMIC UPDATE] Removed highlight from list room line: "${roomText}"`);
                    }
                }
            }
            return;
        }

        const rawText = targetEl.textContent.trim();
        if (!rawText) return;

        const isList = looksLikeRoomList(rawText);

        if (isList) {
            const rooms = splitOuterCommas(rawText);
            console.log(TAG, `formatting custom location list containing ${rooms.length} items`);

            // Re-render container contents as block-level lines holding precise inline highlights.
            // Safe under Trusted Types since we operate strictly on DOM Node operations.
            targetEl.replaceChildren();
            targetEl.style.display = 'block';
            targetEl.style.whiteSpace = 'normal';

            for (const room of rooms) {
                // Outer container ensures each entry sits on a separate block line
                const containerLine = document.createElement('div');
                containerLine.style.marginBottom = '3px';
                containerLine.style.display = 'block';

                // Inner text block holds the text and inline highlighting box
                const roomLine = document.createElement('span');
                roomLine.textContent = room;
                roomLine.style.display = 'inline-block';
                roomLine.style.cursor = 'pointer';

                const match = targetRoomRegex.test(room);
                if (match) {
                    roomLine.classList.add(HIGHLIGHT_CLASS);
                    console.log(TAG, `highlighted list room line: "${room}"`);
                }

                containerLine.appendChild(roomLine);
                targetEl.appendChild(containerLine);
            }
        } else {
            // Single text location (or normal address): check and highlight the precise text block
            const match = targetRoomRegex.test(rawText);
            console.log(TAG, `[TELEMETRY SINGLE EVAL] text: "${rawText}", matched: ${match}`);
            if (match) {
                if (!targetEl.classList.contains(HIGHLIGHT_CLASS)) {
                    targetEl.classList.add(HIGHLIGHT_CLASS);
                    console.log(TAG, `highlighted single location text block: "${rawText}"`);
                }
            } else {
                // Stateless Cleanup: wipe stale highlight class under node-reuse
                if (targetEl.classList.contains(HIGHLIGHT_CLASS)) {
                    targetEl.classList.remove(HIGHLIGHT_CLASS);
                    console.log(TAG, `[CLEANUP SINGLE] Removed highlight from targetEl: "${rawText}"`);
                }
            }
        }
    }

    // Main highlight runner
    function processDialog(dialog) {
        // Event title tracking for state reset during direct card-to-card navigation.
        // Google Calendar reuses the same #xDetDlg DOM tree in-place when navigating
        // directly from one card to another.
        const titleEl = dialog.querySelector('#rAECCd') || dialog.querySelector('[role="heading"]');
        const eventTitle = titleEl ? titleEl.textContent.trim() : '';

        if (eventTitle !== lastEventTitle) {
            console.log(TAG, `[STATE RESET] Event title changed from "${lastEventTitle}" to "${eventTitle}"`);
            lastEventTitle = eventTitle;
        }

        highlightRoomResources(dialog);
        formatTextLocations(dialog);
    }

    // Diagnostic alert: if the dialog is not found within 8 seconds on startup,
    // print a warning log so the user knows the script is active but waiting.
    let waitingLogged = false;
    const waitTimer = setTimeout(() => {
        const dialog = document.getElementById('xDetDlg');
        if (!dialog && !waitingLogged) {
            console.log(TAG, 'still waiting for event details card (#xDetDlg) to be opened...');
            waitingLogged = true;
        }
    }, 8000);

    // Run once on initialization if the dialog is already present in the DOM
    const existingDialog = document.getElementById('xDetDlg');
    if (existingDialog) {
        console.log(TAG, 'found existing dialog on startup, processing immediately');
        clearTimeout(waitTimer);
        processDialog(existingDialog);
    }

    // Set up MutationObserver to watch for body subtree mutations.
    const observer = new MutationObserver(() => {
        const dialog = document.getElementById('xDetDlg');
        if (dialog) {
            clearTimeout(waitTimer);
            processDialog(dialog);
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });

    // First-run prompt: If the local rooms regex pattern is not yet configured,
    // intercept startup and trigger the user prompt immediately!
    // We defer slightly (500ms) to allow initial DOM rendering to run smoothly first.
    if (readRegexString() === SENTINEL) {
        console.log(TAG, 'First-run configuration prompt scheduled');
        setTimeout(() => {
            if (readRegexString() === SENTINEL) {
                promptForRegex();
            }
        }, 500);
    }

    console.log(TAG, 'ready');
})();
