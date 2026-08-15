#!/usr/bin/env python3
"""Report which of our userscripts are published on Greasy Fork, and where.

Greasy Fork (https://greasyfork.org) is the userscript repository site we
publish to. What's published there is read from our user page's JSON twin
(https://api.greasyfork.org/en/users/<id>-<slug>.json), which needs no
login and gives each script's id, name, version and URL.

Subcommands:
  list      Print the published scripts (`--json` for the raw entries).
  match     Print how they pair with the local `.user.js` files, and
            what's on only one side. Pairs by the id in
            `script_manifest.json`, falling back to the `@name` header.
  link      Match, then record each pair's id and URL in the manifest —
            the only thing here that writes anything (`--dry-run` to
            preview).
  raw-url   Print the raw.githubusercontent.com URL for a local script,
            which is what Greasy Fork's import form fetches. Assembled,
            not looked up: an unpushed file gets a URL that 404s.

Examples:
  greasyfork-scripts.py list
  greasyfork-scripts.py match
  greasyfork-scripts.py link
  greasyfork-scripts.py raw-url sites/strava.com/fix-climb-slider.user.js
"""

import argparse
import json
import re
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST = REPO_ROOT / "script_manifest.json"
# Our Greasy Fork account. The slug is part of the URL the site serves.
DEFAULT_USER = "1604620-jeff-shute"
# The site 308-redirects .json requests to its API host, and Python 3.10's
# urllib doesn't follow 308 — so ask the API host in the first place.
DEFAULT_API_BASE = "https://api.greasyfork.org"
# Greasy Fork 403s an unadorned urllib request.
USER_AGENT = "Mozilla/5.0 (userscripts repo tooling)"

NAME_HEADER = re.compile(r"^//\s*@name\s+(.+?)\s*$", re.MULTILINE)
VERSION_HEADER = re.compile(r"^//\s*@version\s+(.+?)\s*$", re.MULTILINE)


# ---------- the manifest ----------

class Manifest:
  """The list of our userscripts, to read and to record ids in.

  The manifest belongs to SourceMonkey (the userscript manager), which
  loads the scripts it lists; we borrow it to remember which Greasy Fork
  script each one was published as. So `link` writes to a file that
  isn't ours, and the job here is to change that one field and leave
  everything else exactly as we found it — anything we don't recognize
  is something SourceMonkey or a future us put there on purpose.

  `entries` is the scripts as a uniform list of objects, whatever the
  file spelled them as, and editing one edits what `save()` writes.
  What survives a save: the `{"scripts": [...]}` wrapper if the file
  used one, along with any keys beside it; fields on an entry that we
  don't know about; and an entry written as a bare path string, which
  stays a string unless we added a field to it.
  """

  def __init__(self, path: Path):
    self.path = path
    self.data = json.loads(path.read_text(encoding="utf-8"))
    raw = self.data.get("scripts") if isinstance(self.data, dict) else self.data
    if not isinstance(raw, list):
      raise SystemExit(f"error: {path} is not a script list or a {{'scripts': [...]}} object")
    self.entries = []
    self._were_strings = set()
    for index, entry in enumerate(raw):
      if isinstance(entry, str):
        self.entries.append({"path": entry})
        self._were_strings.add(index)
      elif isinstance(entry, dict) and isinstance(entry.get("path"), str):
        self.entries.append(entry)
      else:
        raise SystemExit(f"error: {path} has an entry that is neither a path "
                         f"nor an object with a 'path': {entry!r}")

  def save(self) -> None:
    written = [entry["path"]
               if index in self._were_strings and list(entry) == ["path"] else entry
               for index, entry in enumerate(self.entries)]
    if isinstance(self.data, dict):
      self.data["scripts"] = written
      output = self.data
    else:
      output = written
    self.path.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")


# ---------- local scripts ----------

def header_field(path: Path, pattern: re.Pattern) -> str:
  try:
    text = path.read_text(encoding="utf-8")
  except OSError as error:
    raise SystemExit(f"error: {error}")
  match = pattern.search(text)
  return match.group(1) if match else ""


def local_scripts(entries: list, only: list) -> list:
  """(manifest entry, @name, @version) for the scripts we care about.

  Paths named on the command line that aren't in the manifest still get
  an entry, so `raw-url` and `match` work on a script before it's
  listed.
  """
  if only:
    by_path = {entry["path"]: entry for entry in entries}
    entries = [by_path.get(relative_path(p), {"path": relative_path(p)}) for p in only]
  found = []
  for entry in entries:
    full = REPO_ROOT / entry["path"]
    found.append((entry,
                  header_field(full, NAME_HEADER),
                  header_field(full, VERSION_HEADER)))
  return found


def relative_path(given: str) -> str:
  """A command-line path as the manifest spells it: relative to the repo."""
  path = Path(given)
  return str(path.resolve().relative_to(REPO_ROOT)) if path.is_absolute() else str(path)


def raw_url(source: str, branch: str) -> str:
  """Build the raw.githubusercontent.com URL that serves a local script.

  `source` is a path, repo-relative or absolute inside the repo; a URL
  passes through unchanged, so callers can take either from a user.
  Assembled from the `origin` remote, the branch, and the path — nothing
  is fetched, so an unpushed file gets a URL that 404s.
  """
  if "://" in source:
    return source
  full = (Path(source) if Path(source).is_absolute() else REPO_ROOT / source).resolve()
  if not full.is_file():
    raise SystemExit(f"error: no such file: {full}")
  try:
    relative = full.relative_to(REPO_ROOT)
  except ValueError:
    raise SystemExit(f"error: {full} is not in the repo, so GitHub doesn't serve it")
  try:
    remote = subprocess.run(["git", "-C", str(REPO_ROOT), "remote", "get-url", "origin"],
                            capture_output=True, text=True, check=True).stdout.strip()
  except (OSError, subprocess.CalledProcessError):
    raise SystemExit("error: no 'origin' remote to build a raw URL from")
  slug = re.sub(r"^(https://github\.com/|git@github\.com:)", "", remote).removesuffix(".git")
  return f"https://raw.githubusercontent.com/{slug}/{branch}/{relative}"


# ---------- Greasy Fork ----------

def published(api_base: str, user: str) -> list:
  """Every script on the user's Greasy Fork page, newest id last."""
  url = f"{api_base.rstrip('/')}/en/users/{user}.json"
  request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
  try:
    with urllib.request.urlopen(request, timeout=30) as response:
      data = json.load(response)
  except (urllib.error.URLError, ValueError) as error:
    raise SystemExit(f"error: could not read {url}: {error}")
  return [s for s in data.get("scripts", []) if not s.get("deleted")]


def match_up(locals_: list, remotes: list) -> tuple:
  """Pair local scripts with published ones, by recorded id then `@name`.

  The id in the manifest entry's `greasyfork` field is the durable link:
  it survives renaming a script, which name matching can't — after a
  rename the local file and its published twin look like two unrelated
  scripts. Anything with no id recorded yet (i.e. everything, until
  `link` has run once) falls back to the name, the only other field both
  sides carry verbatim — Greasy Fork derives its slug from it and never
  sees our file paths.
  """
  by_id = {str(s["id"]): s for s in remotes}
  by_name = {s["name"]: s for s in remotes}
  matched = {}   # index into locals_ -> published script
  taken = set()  # ids already spoken for
  for index, (entry, _, _) in enumerate(locals_):
    recorded = entry.get("greasyfork", {}).get("id")
    remote = by_id.get(str(recorded)) if recorded is not None else None
    if remote and remote["id"] not in taken:
      matched[index] = remote
      taken.add(remote["id"])
  # Only then by name, so a stale name can't claim a script some other
  # entry already owns by id.
  for index, (_, name, _) in enumerate(locals_):
    if index in matched or not name:
      continue
    remote = by_name.get(name)
    if remote and remote["id"] not in taken:
      matched[index] = remote
      taken.add(remote["id"])
  pairs = [(*locals_[i], matched[i]) for i in range(len(locals_)) if i in matched]
  unpublished = [locals_[i] for i in range(len(locals_)) if i not in matched]
  return pairs, unpublished, [s for s in remotes if s["id"] not in taken]


# ---------- commands ----------

def cmd_list(args) -> None:
  remotes = published(args.api_base, args.user)
  if args.json:
    print(json.dumps(remotes, indent=2))
    return
  for script in remotes:
    print(f"{script['id']}  v{script['version']:<10} {script['name']}")
    print(f"          {script['url']}")


def cmd_match(args) -> None:
  manifest = Manifest(args.manifest)
  pairs, unpublished, orphans = match_up(
      local_scripts(manifest.entries, args.paths), published(args.api_base, args.user))

  print(f"published and matched ({len(pairs)}):")
  for entry, name, version, remote in pairs:
    # A local version ahead of the published one means we have changes
    # that were never posted.
    same = "  " if version == remote["version"] else "* "
    notes = ""
    if str(entry.get("greasyfork", {}).get("id")) != str(remote["id"]):
      notes += "   [id not in manifest]"
    if name != remote["name"]:
      # Matched by the recorded id, so a local rename shows up here
      # rather than as two unmatched scripts.
      notes += f"   [renamed; posted as {remote['name']!r}]"
    print(f"  {same}{remote['id']}  local v{version} / posted v{remote['version']}  {entry['path']}{notes}")
  print(f"\nlocal only, never published ({len(unpublished)}):")
  for entry, name, _ in unpublished:
    print(f"    {entry['path']}" + ("" if name else "   [no @name header!]"))
  if orphans:
    print(f"\npublished but no local match ({len(orphans)}):")
    for remote in orphans:
      print(f"    {remote['id']}  {remote['name']}")
  if any(v != r["version"] for _, _, v, r in pairs):
    print("\n('*' marks a local @version that differs from the posted one.)")


def cmd_link(args) -> None:
  manifest = Manifest(args.manifest)
  pairs, _, _ = match_up(local_scripts(manifest.entries, args.paths),
                         published(args.api_base, args.user))
  changed = []
  for entry, _, _, remote in pairs:
    if entry not in manifest.entries:
      # Named on the command line but not listed — record it there
      # first, since the manifest is what SourceMonkey loads.
      raise SystemExit(f"error: {entry['path']} is not in {args.manifest}; add it first")
    recorded = {"id": remote["id"], "url": remote["url"]}
    if entry.get("greasyfork") != recorded:
      entry["greasyfork"] = recorded
      changed.append(f"{remote['id']}  {entry['path']}")
  if not changed:
    print("manifest already up to date")
    return
  for line in changed:
    print(("would record  " if args.dry_run else "recorded  ") + line)
  if not args.dry_run:
    manifest.save()


def cmd_raw_url(args) -> None:
  for path in args.paths:
    print(raw_url(path, args.branch))


def main() -> int:
  parser = argparse.ArgumentParser(
      description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
  parser.add_argument("--user", default=DEFAULT_USER,
                      help=f"Greasy Fork user, id-slug form (default {DEFAULT_USER})")
  parser.add_argument("--api-base", default=DEFAULT_API_BASE,
                      help=f"host serving the JSON API (default {DEFAULT_API_BASE})")
  parser.add_argument("--manifest", type=Path, default=MANIFEST,
                      help="script manifest to read and record ids in")
  # Not required: with no subcommand, show the full help — the bare
  # usage line argparse prints instead says nothing about what the
  # subcommands do.
  subparsers = parser.add_subparsers(dest="command")

  list_parser = subparsers.add_parser("list", help="show the published scripts")
  list_parser.add_argument("--json", action="store_true", help="print the raw API entries")
  list_parser.set_defaults(func=cmd_list)

  match_parser = subparsers.add_parser(
      "match", help="pair local files with published scripts, by recorded id or @name")
  match_parser.add_argument("paths", nargs="*", help="scripts to check (default: all in the manifest)")
  match_parser.set_defaults(func=cmd_match)

  link_parser = subparsers.add_parser(
      "link", help="record the matched ids on the manifest entries",
      description="Match local files to published scripts, then write each one's "
                  "Greasy Fork id and URL onto its manifest entry, under a "
                  "'greasyfork' field. SourceMonkey ignores that field; it's "
                  "how the publishing tools remember which script is which.")
  link_parser.add_argument("paths", nargs="*", help="scripts to record (default: all in the manifest)")
  link_parser.add_argument("--dry-run", action="store_true", help="show what would change")
  link_parser.set_defaults(func=cmd_link)

  raw_parser = subparsers.add_parser(
      "raw-url",
      help="print where GitHub serves a local script, for Greasy Fork's import form",
      description="Print the raw.githubusercontent.com URL a local script file "
                  "lands at, built from the `origin` remote, the branch, and the "
                  "path. This is what Greasy Fork's import form fetches to make "
                  "an auto-updating copy. Nothing is fetched here, so a file that "
                  "hasn't been pushed still gets a URL — one that 404s.")
  raw_parser.add_argument("paths", nargs="+", help="local script paths, repo-relative")
  raw_parser.add_argument("--branch", default="main",
                          help="branch the URL points into (default main)")
  raw_parser.set_defaults(func=cmd_raw_url)

  args = parser.parse_args()
  if not args.command:
    parser.print_help()
    return 0
  args.func(args)
  return 0


if __name__ == "__main__":
  sys.exit(main())
