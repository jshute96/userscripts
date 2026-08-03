// error-thrower.js — used via @require by error-button.user.js, and
// by nothing else.
//
// Exists so a thrown error can originate in @require'd library code
// rather than in the userscript body. The point is the stack trace:
// whether the top frame names THIS file at the line of the `throw`
// below, with the userscript's own click handler beneath it.
//
// That's what makes it a real test of the injection arrangement. If a
// manager concatenates requires into the script's entry, it has to map
// the frame back to this file's own name and line number, or the frame
// shows up as an offset into the combined source instead. We haven't
// recorded which managers do which — clicking the button is how you
// find out.
//
// Two frames deep on purpose — a single throw at the top of the
// handler wouldn't show whether intra-library frames survive.

/* exported jshuteThrowFromRequire */

function jshuteThrowFromRequireInner(detail) {
  throw new Error(`error-thrower.js: intentional failure from @require'd code (${detail})`);
}

function jshuteThrowFromRequire(detail) {
  jshuteThrowFromRequireInner(detail);
}
