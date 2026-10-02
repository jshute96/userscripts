// ==UserScript==
// @name         Xfinity Stream: Allow watching on Linux
// @namespace    https://github.com/jshute96/userscripts
// @version      0.1.0
// @description  Bypass the OS check and let Linux users in.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://www.xfinity.com/stream*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const log = (...args) => console.log('[xfinity linux]', ...args);
  log('init');

  if (!/Linux/.test(navigator.userAgent) || /Android/.test(navigator.userAgent)) {
    log('not desktop Linux, leaving the user agent alone');
    return;
  }

  // The page's inline compatibility check parses navigator.userAgent and
  // redirects to /stream/upgrade when the OS is Linux. Rewrite the OS part
  // to Windows before it runs. Overrides go on Navigator.prototype, where
  // the real getters live, so later lookups all see them.
  const ua = navigator.userAgent.replace(/\([^)]*Linux[^)]*\)/, '(Windows NT 10.0; Win64; x64)');
  const appVersion = ua.replace(/^Mozilla\//, '');
  const override = (obj, name, value) => {
    Object.defineProperty(obj, name, { get: () => value, configurable: true });
  };
  override(Navigator.prototype, 'userAgent', ua);
  override(Navigator.prototype, 'appVersion', appVersion);
  override(Navigator.prototype, 'platform', 'Win32');

  // User-Agent Client Hints (navigator.userAgentData), Chrome's newer
  // structured UA API, also reports the platform.
  const uaData = navigator.userAgentData;
  if (uaData) {
    const proto = Object.getPrototypeOf(uaData);
    override(proto, 'platform', 'Windows');
    const getHighEntropyValues = proto.getHighEntropyValues;
    proto.getHighEntropyValues = async function (hints) {
      const values = await getHighEntropyValues.call(this, hints);
      if ('platform' in values) values.platform = 'Windows';
      if ('platformVersion' in values) values.platformVersion = '15.0.0';
      return values;
    };
  }

  log('reporting OS as Windows:', ua);
})();
