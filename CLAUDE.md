## Organization

* Save userscripts for domain `example.com` in a subdirectory called `sites/example.com`.
* The filename should briefly state the main purpose.

## Tips

* When writing userscripts, add `console.log` logging to give more debugging visibility.
  - Use a short `[name]` prefix, two words at most.
  - Log when the script initializes.
  - Log when it detects the activity or finds the element it's trying to fix.
  - Log when it successfully makes a change.
  - Log any failures.

* To make a script updatable, include update URLs in the header pointing at the corresponding path in github, like:
```
// @updateURL    https://github.com/jshute96/userscripts/raw/refs/heads/main/sites/example.com/script.user.js
// @downloadURL  https://github.com/jshute96/userscripts/raw/refs/heads/main/sites/example.com/script.user.js
```

* To get scripts to update, increment the `@version` before final commit and push.
