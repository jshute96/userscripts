// ==UserScript==
// @name         example.com: bold word on hover
// @namespace    https://github.com/jshute96/userscripts
// @version      1.0.1
// @description  Bold the single word under the mouse cursor while hovering text on example.com.
// @author       Jeff Shute <jshute@gmail.com>
// @match        https://example.com/*
// @match        http://example.com/*
// @run-at       document-idle
// @grant        none
// @noframes
// @updateURL    https://github.com/jshute96/userscripts/raw/refs/heads/main/sites/example.com/bold-on-hover.user.js
// @downloadURL  https://github.com/jshute96/userscripts/raw/refs/heads/main/sites/example.com/bold-on-hover.user.js
// ==/UserScript==

(function () {
    'use strict';

    const TAG = '[bold hover]';
    const HIGHLIGHT_CLASS = 'jshute-bold-hover';
    const WORD_CHAR = /[\p{L}\p{N}'’\-]/u;

    console.log(TAG, 'init');

    const style = document.createElement('style');
    style.textContent = `.${HIGHLIGHT_CLASS} { font-weight: bold; color: #d00; }`;
    document.head.appendChild(style);

    let currentSpan = null;

    function clearHighlight() {
        if (!currentSpan) return;
        const parent = currentSpan.parentNode;
        if (parent) {
            while (currentSpan.firstChild) {
                parent.insertBefore(currentSpan.firstChild, currentSpan);
            }
            parent.removeChild(currentSpan);
            parent.normalize();
        }
        currentSpan = null;
    }

    function findWordBounds(text, offset) {
        if (offset < 0 || offset > text.length) return null;
        // Prefer the character to the left if cursor sits between chars.
        let i = offset;
        if (i === text.length || !WORD_CHAR.test(text[i])) {
            if (i > 0 && WORD_CHAR.test(text[i - 1])) i = i - 1;
            else return null;
        }
        let start = i;
        let end = i + 1;
        while (start > 0 && WORD_CHAR.test(text[start - 1])) start--;
        while (end < text.length && WORD_CHAR.test(text[end])) end++;
        return [start, end];
    }

    function caretAt(x, y) {
        if (document.caretPositionFromPoint) {
            const pos = document.caretPositionFromPoint(x, y);
            if (pos && pos.offsetNode && pos.offsetNode.nodeType === Node.TEXT_NODE) {
                return { node: pos.offsetNode, offset: pos.offset };
            }
        } else if (document.caretRangeFromPoint) {
            const range = document.caretRangeFromPoint(x, y);
            if (range && range.startContainer.nodeType === Node.TEXT_NODE) {
                return { node: range.startContainer, offset: range.startOffset };
            }
        }
        return null;
    }

    function highlight(textNode, start, end) {
        const range = document.createRange();
        try {
            range.setStart(textNode, start);
            range.setEnd(textNode, end);
        } catch (e) {
            return;
        }

        const span = document.createElement('span');
        span.className = HIGHLIGHT_CLASS;
        try {
            range.surroundContents(span);
        } catch (e) {
            // Range crossed an element boundary — shouldn't happen for a word in
            // a single text node, but bail safely if it does.
            return;
        }
        currentSpan = span;
    }

    let pending = null;
    let rafId = 0;

    function pointInsideRange(x, y, textNode, start, end) {
        // caretPositionFromPoint returns the *closest* caret even when the
        // cursor isn't actually over text — so always verify the point lies
        // inside the word's own bounding rect before highlighting.
        const range = document.createRange();
        try {
            range.setStart(textNode, start);
            range.setEnd(textNode, end);
        } catch (e) {
            return false;
        }
        for (const rect of range.getClientRects()) {
            if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
                return true;
            }
        }
        return false;
    }

    function process() {
        rafId = 0;
        if (!pending) return;
        const { x, y } = pending;
        pending = null;

        // Still hovering the same highlighted word? Keep it as-is.
        if (currentSpan) {
            const inner = currentSpan.firstChild;
            if (inner && pointInsideRange(x, y, inner, 0, inner.length)) return;
            // Moved off the current word — unwrap before resolving the new
            // caret, otherwise the captured text node and offsets get
            // invalidated by parent.normalize().
            clearHighlight();
        }

        const caret = caretAt(x, y);
        if (!caret) return;

        const bounds = findWordBounds(caret.node.data, caret.offset);
        if (!bounds) return;

        if (!pointInsideRange(x, y, caret.node, bounds[0], bounds[1])) return;

        highlight(caret.node, bounds[0], bounds[1]);
    }

    document.addEventListener('mousemove', (e) => {
        pending = { x: e.clientX, y: e.clientY };
        if (!rafId) rafId = requestAnimationFrame(process);
    }, { passive: true });

    document.addEventListener('mouseleave', clearHighlight);

    console.log(TAG, 'ready');
})();
