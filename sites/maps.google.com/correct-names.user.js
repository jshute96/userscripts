// ==UserScript==
// @name         Google Maps: Correct names: Lake Ontario & Gulf of Mexico
// @namespace    https://github.com/jshute96/userscripts
// @version      1.0.0
// @description  Google shows wrong place names for US users. Use the correct labels the rest of the world sees.
// @author       Jeff Shute <jshute@gmail.com>
// @license      MIT
// @match        https://maps.google.com/*
// @match        https://www.google.com/maps*
// @run-at       document-start
// @grant        none
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[place names]';

  // Which country Google should render place names for. Google shows each
  // country its own preferred names, so no single choice is "neutral":
  //
  //   ca  Lake Ontario                     Gulf of Mexico (Gulf of America)
  //   mx  Lake America (Lake Ontario)      Gulf of Mexico
  //   gb  combined form for both
  //   us  Lake America                     Gulf of America   <- the default
  //
  // 'ca' is the best single answer for the Great Lakes while still naming the
  // Gulf correctly (just with the US name in parentheses). Note 'mx' also
  // switches the interface to Spanish unless REGION_LANG is set.
  const REGION = 'ca';

  // Language to force alongside the region. Leave null to let Google pick,
  // which follows REGION ('mx' would give you Spanish). Set to 'en' to keep
  // the interface in English regardless of REGION.
  const REGION_LANG = null;

  console.log(`${TAG} init on ${location.pathname}`);

  const params = new URLSearchParams(location.search);

  // State check: if a region is already pinned, this load is either one we
  // redirected a moment ago or one the user aimed somewhere deliberately.
  // Either way it is already in its target state, so leave it alone. This is
  // also what makes a redirect loop impossible — we only ever redirect to a
  // URL that carries `gl`, and that URL fails this test on arrival.
  if (params.has('gl')) {
    console.log(`${TAG} region already set to "${params.get('gl')}", nothing to do`);
    return;
  }

  params.set('gl', REGION);
  if (REGION_LANG) params.set('hl', REGION_LANG);

  const target = `${location.origin}${location.pathname}?${params}${location.hash}`;
  console.log(`${TAG} no region on this load, redirecting to gl=${REGION}`);

  // replace() rather than assign() so the un-regionalized URL does not become
  // a back-button stop.
  location.replace(target);
})();
