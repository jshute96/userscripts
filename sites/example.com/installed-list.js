// installed-list.js — shared via @require for example.com userscripts.
//
// Each script that @require's this calls
// jshuteAddInstalledScript(filename, ...descriptionParts) to advertise
// itself in a single "Installed userscripts" section appended to
// <body>. The first script to call it creates the heading + list;
// later scripts find them by ID and add bullets.
//
// `filename` is the full userscript basename (e.g.
// 'bold-on-hover.user.js') and is rendered as inline <code>.
// `descriptionParts` are appended after `: `; each part may be a
// string (text node) or a DOM Node (e.g. a <code> built by
// jshuteCode). Use jshuteCode(text) to get a styled inline filename
// or keyword.
//
// Use jshuteAppendAboveInstalledList(node) to insert other UI elements
// (e.g. a button) above the installed-list section, so the bullet list
// stays the visual bottom of the page.

/* exported jshuteAddInstalledScript, jshuteAppendAboveInstalledList, jshuteCode */

const JSHUTE_INSTALLED_HEADING_ID = 'jshute-installed-userscripts-heading';
const JSHUTE_INSTALLED_LIST_ID = 'jshute-installed-userscripts-list';

function jshuteCode(text) {
  const el = document.createElement('code');
  el.textContent = text;
  return el;
}

function jshuteAddInstalledScript(filename, ...descriptionParts) {
  let list = document.getElementById(JSHUTE_INSTALLED_LIST_ID);
  if (!list) {
    const heading = document.createElement('h2');
    heading.id = JSHUTE_INSTALLED_HEADING_ID;
    heading.textContent = 'Installed userscripts';
    document.body.appendChild(heading);

    list = document.createElement('ul');
    list.id = JSHUTE_INSTALLED_LIST_ID;
    document.body.appendChild(list);
  }

  const item = document.createElement('li');
  item.appendChild(jshuteCode(filename));
  item.appendChild(document.createTextNode(': '));
  for (const part of descriptionParts) {
    item.appendChild(part instanceof Node ? part : document.createTextNode(String(part)));
  }
  list.appendChild(item);
}

function jshuteAppendAboveInstalledList(node) {
  const heading = document.getElementById(JSHUTE_INSTALLED_HEADING_ID);
  if (heading) {
    document.body.insertBefore(node, heading);
  } else {
    document.body.appendChild(node);
  }
}
