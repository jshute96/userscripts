#!/usr/bin/env python3
"""Rewrite the script and library tables in README.md from script_manifest.json.

Each table in README.md sits under a placeholder comment. Script tables
name the category they hold:

  <!-- update_readme.py category=default -->
  | Script | Doc | GF | Description |
  | --- | --- | --- | --- |
  | ... |

and the one table of shared `@require` libraries is marked:

  <!-- update_readme.py libraries -->

Everything from the line after the placeholder up to the next blank line
is the generated table, and is replaced wholesale. Rows come from
`script_manifest.json` (in manifest order).

For a script, the row's name and description are its `@name` and
`@description` headers. A manifest entry's `category` field selects the
table; entries with no `category` go in `default`. The set of categories
used in the manifest must match the set of placeholders in README.md
exactly.

For a library — an entry in the manifest's `libraries` list — there is
no metadata block to read, so the row's name is the filename and its
description is the file's first line (see `read_library_metadata`).

Usage:
  update_readme.py                  # rewrite README.md in place
  update_readme.py --check          # exit 1 if README.md is out of date
"""

import argparse
import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST = REPO_ROOT / 'script_manifest.json'
README = REPO_ROOT / 'README.md'

PLACEHOLDER_RE = re.compile(
    r'<!--\s*update_readme\.py\s+(?:category=([\w-]+)|(libraries))\s*-->')

SCRIPT_HEADER = ['| Script | Doc | GF | Description |',
                 '| --- | --- | --- | --- |']
LIBRARY_HEADER = ['| Library | Doc | GF | Description |',
                  '| --- | --- | --- | --- |']


def load_manifest():
  """Return (scripts, libraries) as lists of entry objects.

  The manifest is either a bare list of scripts or an object with
  `scripts` and (optionally) `libraries` lists. An entry may be written
  as a bare path string.
  """
  data = json.loads(MANIFEST.read_text(encoding='utf-8'))
  if isinstance(data, list):
    scripts, libraries = data, []
  else:
    scripts, libraries = data.get('scripts', []), data.get('libraries', [])
  normalize = lambda entries: [{'path': e} if isinstance(e, str) else e for e in entries]
  return normalize(scripts), normalize(libraries)


def read_metadata(script_path):
  """Return (name, description) from a userscript's metadata block."""
  fields = {}
  for line in script_path.read_text(encoding='utf-8').splitlines():
    if line.strip() == '// ==/UserScript==':
      break
    m = re.match(r'//\s*@(\w+)\s+(.*)', line)
    if m:
      fields.setdefault(m.group(1), m.group(2).strip())
  missing = [f for f in ('name', 'description') if f not in fields]
  if missing:
    sys.exit(f'{script_path}: missing @{" and @".join(missing)}')
  return fields['name'], fields['description']


def read_library_metadata(library_path):
  """Return (name, description) for a shared `@require` library.

  Libraries are plain `.js` files with no metadata block, so there's no
  `@name` or `@description` to read. The name is the filename — that's
  what a script's `@require` line names it by — and the description is
  the file's first line, which by convention is a one-sentence `//`
  comment saying what the file is.
  """
  lines = library_path.read_text(encoding='utf-8').splitlines()
  m = re.match(r'\s*//\s*(\S.*)', lines[0]) if lines else None
  if not m:
    sys.exit(f'{library_path}: first line should be a "//" comment describing '
             'the library; that is what the README table shows')
  return library_path.name, m.group(1).strip()


def escape_cell(text):
  """Escape what a Markdown table cell would otherwise eat."""
  return text.replace('|', '\\|').replace('<', '&lt;').replace('>', '&gt;')


def sibling_doc(rel, suffix):
  """The doc file beside a script or library, checked to exist."""
  doc = rel[: -len(suffix)] + '.md'
  if not (REPO_ROOT / doc).exists():
    sys.exit(f'{doc}: doc file missing for {rel}')
  return doc


def gf_cell(entry):
  """The `GF` column: a link to the published copy, or empty."""
  gf = entry.get('greasyfork')
  return f'[GF]({gf["url"]})' if gf else ''


def build_rows(scripts):
  """Return {category: [table row, ...]}, in manifest order."""
  rows = {}
  for entry in scripts:
    rel = entry['path']
    script = REPO_ROOT / rel
    if not script.exists():
      sys.exit(f'{rel}: listed in the manifest but not found')
    doc = sibling_doc(rel, '.user.js')
    name, description = read_metadata(script)
    row = (f'| [{escape_cell(name)}]({rel}) | [doc]({doc}) '
           f'| {gf_cell(entry)} | {escape_cell(description)} |')
    rows.setdefault(entry.get('category', 'default'), []).append(row)
  return rows


def build_library_rows(libraries):
  """Return [table row, ...] for the libraries table, in manifest order."""
  rows = []
  for entry in libraries:
    rel = entry['path']
    library = REPO_ROOT / rel
    if not library.exists():
      sys.exit(f'{rel}: listed in the manifest but not found')
    doc = sibling_doc(rel, '.js')
    name, description = read_library_metadata(library)
    rows.append(f'| [{escape_cell(name)}]({rel}) | [doc]({doc}) '
                f'| {gf_cell(entry)} | {escape_cell(description)} |')
  return rows


def render(readme_text, rows, library_rows):
  """Return README text with each placeholder's table replaced."""
  lines = readme_text.splitlines()
  out = []
  seen = []
  libraries_seen = 0
  i = 0
  while i < len(lines):
    line = lines[i]
    out.append(line)
    i += 1
    m = PLACEHOLDER_RE.search(line)
    if not m:
      continue
    category = m.group(1)
    if category:
      seen.append(category)
    else:
      libraries_seen += 1
    while i < len(lines) and lines[i].strip():  # drop the old table
      i += 1
    out.extend(SCRIPT_HEADER if category else LIBRARY_HEADER)
    out.extend(rows.get(category, []) if category else library_rows)

  manifest_categories = set(rows)
  readme_categories = set(seen)
  if len(seen) != len(readme_categories):
    dupes = sorted({c for c in seen if seen.count(c) > 1})
    sys.exit(f'README.md: duplicate category placeholders: {", ".join(dupes)}')
  if manifest_categories != readme_categories:
    only_manifest = sorted(manifest_categories - readme_categories)
    only_readme = sorted(readme_categories - manifest_categories)
    problems = []
    if only_manifest:
      problems.append('in the manifest but with no README placeholder: '
                      + ', '.join(only_manifest))
    if only_readme:
      problems.append('with a README placeholder but no scripts: '
                      + ', '.join(only_readme))
    sys.exit('Category mismatch — ' + '; '.join(problems))
  if libraries_seen > 1:
    sys.exit('README.md: more than one "libraries" placeholder')
  if bool(library_rows) != bool(libraries_seen):
    sys.exit('README.md: the manifest lists libraries but README.md has no '
             '"libraries" placeholder' if library_rows else
             'README.md: has a "libraries" placeholder but the manifest lists '
             'no libraries')

  return '\n'.join(out) + '\n'


def main():
  parser = argparse.ArgumentParser(description=__doc__,
                                   formatter_class=argparse.RawDescriptionHelpFormatter)
  parser.add_argument('--check', action='store_true',
                      help="don't write; exit 1 if README.md is out of date")
  args = parser.parse_args()

  scripts, libraries = load_manifest()
  old = README.read_text(encoding='utf-8')
  new = render(old, build_rows(scripts), build_library_rows(libraries))

  if new == old:
    print('README.md is up to date.')
    return
  if args.check:
    sys.exit('README.md is out of date; run scripts/update_readme.py.')
  README.write_text(new, encoding='utf-8')
  print('README.md updated.')


if __name__ == '__main__':
  main()
