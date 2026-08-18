#!/usr/bin/env python3
"""Rewrite the script tables in README.md from script_manifest.json.

Each table in README.md sits under a placeholder comment naming its
category:

  <!-- update_readme.py category=default -->
  | Script | Doc | GF | Description |
  | --- | --- | --- | --- |
  | ... |

Everything from the line after the placeholder up to the next blank line
is the generated table, and is replaced wholesale. Rows come from
`script_manifest.json` (in manifest order), with each script's `@name`
and `@description` read out of the `.user.js` header.

A manifest entry's `category` field selects the table; entries with no
`category` go in `default`. The set of categories used in the manifest
must match the set of placeholders in README.md exactly.

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

PLACEHOLDER_RE = re.compile(r'<!--\s*update_readme\.py\s+category=([\w-]+)\s*-->')

HEADER = ['| Script | Doc | GF | Description |',
          '| --- | --- | --- | --- |']


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


def escape_cell(text):
  """Escape what a Markdown table cell would otherwise eat."""
  return text.replace('|', '\\|').replace('<', '&lt;').replace('>', '&gt;')


def build_rows(manifest):
  """Return {category: [table row, ...]}, in manifest order."""
  rows = {}
  for entry in manifest:
    rel = entry['path']
    script = REPO_ROOT / rel
    if not script.exists():
      sys.exit(f'{rel}: listed in the manifest but not found')
    doc = rel[: -len('.user.js')] + '.md'
    if not (REPO_ROOT / doc).exists():
      sys.exit(f'{doc}: doc file missing for {rel}')
    name, description = read_metadata(script)
    gf = entry.get('greasyfork')
    gf_cell = f'[GF]({gf["url"]})' if gf else ''
    row = (f'| [{escape_cell(name)}]({rel}) | [doc]({doc}) '
           f'| {gf_cell} | {escape_cell(description)} |')
    rows.setdefault(entry.get('category', 'default'), []).append(row)
  return rows


def render(readme_text, rows):
  """Return README text with each placeholder's table replaced."""
  lines = readme_text.splitlines()
  out = []
  seen = []
  i = 0
  while i < len(lines):
    line = lines[i]
    out.append(line)
    i += 1
    m = PLACEHOLDER_RE.search(line)
    if not m:
      continue
    category = m.group(1)
    seen.append(category)
    while i < len(lines) and lines[i].strip():  # drop the old table
      i += 1
    out.extend(HEADER)
    out.extend(rows.get(category, []))

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

  return '\n'.join(out) + '\n'


def main():
  parser = argparse.ArgumentParser(description=__doc__,
                                   formatter_class=argparse.RawDescriptionHelpFormatter)
  parser.add_argument('--check', action='store_true',
                      help="don't write; exit 1 if README.md is out of date")
  args = parser.parse_args()

  manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
  old = README.read_text(encoding='utf-8')
  new = render(old, build_rows(manifest))

  if new == old:
    print('README.md is up to date.')
    return
  if args.check:
    sys.exit('README.md is out of date; run scripts/update_readme.py.')
  README.write_text(new, encoding='utf-8')
  print('README.md updated.')


if __name__ == '__main__':
  main()
