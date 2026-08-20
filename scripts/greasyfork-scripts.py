#!/usr/bin/env python3
"""Report which of our userscripts are published on Greasy Fork, and where.

Greasy Fork (https://greasyfork.org) is the userscript repository site we
publish to. What's published there is read from our user page's JSON twin
(https://api.greasyfork.org/en/users/<id>-<slug>.json), which needs no
login and gives each script's id, name, version and URL.

The user page lists only userscripts. The shared `@require` libraries
in `lib/` are published as scripts too, but Greasy Fork keeps them off
that list, so each one is looked up by id at
https://api.greasyfork.org/en/scripts/<id>.json instead — which means a
library's id has to be written into the manifest by hand.

Subcommands:
  list      Print the published scripts (`--json` for the raw entries).
  match     Print how they pair with the local `.user.js` files, and
            what's on only one side. Pairs by the id in
            `script_manifest.json`, falling back to the `@name` header.
            Also checks each library's recorded URLs against Greasy Fork.
  link      Match, then record each pair's id and URL in the manifest,
            and refresh each library's URLs — the only thing here that
            writes anything (`--dry-run` to preview).
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

  `entries` is the scripts and `libraries` the `lib/` helpers, each a
  uniform list of objects whatever the file spelled them as, and editing
  one edits what `save()` writes. What survives a save: the
  `{"scripts": [...]}` wrapper if the file used one, along with any keys
  beside it; fields on an entry that we don't know about; and an entry
  written as a bare path string, which stays a string unless we added a
  field to it.
  """

  def __init__(self, path: Path):
    self.path = path
    self.data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(self.data, dict):
      raw_scripts, raw_libraries = self.data.get("scripts"), self.data.get("libraries", [])
    else:
      raw_scripts, raw_libraries = self.data, []
    if not isinstance(raw_scripts, list) or not isinstance(raw_libraries, list):
      raise SystemExit(f"error: {path} is not a script list or a "
                       f"{{'scripts': [...], 'libraries': [...]}} object")
    self._were_strings = set()
    self.entries = self._parse(raw_scripts, "scripts")
    self.libraries = self._parse(raw_libraries, "libraries")

  def _parse(self, raw: list, which: str) -> list:
    parsed = []
    for index, entry in enumerate(raw):
      if isinstance(entry, str):
        parsed.append({"path": entry})
        self._were_strings.add((which, index))
      elif isinstance(entry, dict) and isinstance(entry.get("path"), str):
        parsed.append(entry)
      else:
        raise SystemExit(f"error: {self.path} has a {which} entry that is neither "
                         f"a path nor an object with a 'path': {entry!r}")
    return parsed

  def _written(self, parsed: list, which: str) -> list:
    return [entry["path"]
            if (which, index) in self._were_strings and list(entry) == ["path"] else entry
            for index, entry in enumerate(parsed)]

  def save(self) -> None:
    if isinstance(self.data, dict):
      self.data["scripts"] = self._written(self.entries, "scripts")
      if self.libraries or "libraries" in self.data:
        self.data["libraries"] = self._written(self.libraries, "libraries")
      output = self.data
    else:
      output = self._written(self.entries, "scripts")
    self.path.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")


# ---------- @require rewriting ----------

# A metadata-block @require line: the directive, then the one URL it names.
REQUIRE_LINE = re.compile(r"^(//\s*@require\s+)(\S+)[^\S\n]*$", re.MULTILINE)

# Where our shared libraries live when a script is installed from GitHub.
GITHUB_LIB_PREFIX = "https://raw.githubusercontent.com/"


def library_require_map(manifest: "Manifest") -> dict:
  """github_url -> latest_version_url, for every library that has both.

  Both fields are recorded per library in the manifest: `github_url` is
  the raw URL our scripts @require, and `latest_version_url` is the one
  exact Greasy Fork version that stands for it there.
  """
  mapping = {}
  for entry in manifest.libraries:
    github = entry.get("github_url")
    greasyfork = entry.get("greasyfork", {}).get("latest_version_url")
    if github and greasyfork:
      mapping[github] = greasyfork
  return mapping


def rewrite_requires(source: str, manifest: "Manifest") -> tuple:
  """Point a script's @require lines at Greasy Fork instead of GitHub.

  Greasy Fork rejects a `raw.githubusercontent.com` @require, so the
  copy posted there has to name each library's `latest_version_url`
  instead. Everything else — bare relative paths to same-site helpers,
  URLs on other hosts — is left alone.

  Returns the rewritten source and the (old, new) pairs it changed. A
  GitHub @require with no library entry to map it to is an error: it
  would be rejected on submit, and silently leaving it in place would
  make that look like a Greasy Fork problem rather than a missing
  `github_url` in the manifest.
  """
  mapping = library_require_map(manifest)
  changed = []
  unmapped = []

  def replace(match):
    directive, url = match.group(1), match.group(2)
    if not url.startswith(GITHUB_LIB_PREFIX):
      return match.group(0)
    if url not in mapping:
      unmapped.append(url)
      return match.group(0)
    changed.append((url, mapping[url]))
    return directive + mapping[url]

  rewritten = REQUIRE_LINE.sub(replace, source)
  if unmapped:
    raise SystemExit(
      "error: no Greasy Fork library recorded for @require "
      + ", ".join(unmapped)
      + f"\n  add the library to {manifest.path.name} with a github_url and a "
        "published greasyfork.latest_version_url")
  return rewritten, changed


# Any @require Greasy Fork can't serve to an installed script: a raw file
# on GitHub (which it rejects outright) or a bare relative path (which
# only resolves against a local install's own directory).
GITHUB_HOST = re.compile(r"^https?://(raw\.githubusercontent\.com|(gist\.)?github\.com)/", re.I)


def unpublishable_requires(source: str) -> list:
  """(url, what's wrong) for each @require that can't be published.

  Both cases are ones our scripts legitimately have on disk — a GitHub
  raw URL for a `lib/` helper, a bare relative path for a same-site
  helper — and both are broken for everyone who installs from Greasy
  Fork. `rewrite_requires` fixes the first; nothing fixes the second,
  so a script with one has to be published with its helper inlined.
  """
  problems = []
  for match in REQUIRE_LINE.finditer(source):
    url = match.group(2)
    if GITHUB_HOST.match(url):
      problems.append((url, "a GitHub URL, which Greasy Fork rejects"))
    elif "://" not in url:
      problems.append((url, "a relative path, which only resolves for a local install"))
    elif not url.lower().startswith(("http://", "https://")):
      # `file://`, most likely — convert-to-file-pointer.py writes those,
      # and a pointer copy is easy to hand to the wrong command.
      problems.append((url, "not an http(s) URL, so no one but this machine can fetch it"))
  return problems


def check_publishable(source: str, what: str) -> None:
  """Stop unless every @require in `source` would work on Greasy Fork."""
  problems = unpublishable_requires(source)
  if problems:
    raise SystemExit(
      f"error: {what} has @require lines Greasy Fork can't publish:\n"
      + "\n".join(f"  {url}\n    {why}" for url, why in problems))


# ---------- local scripts ----------

def header_field(path: Path, pattern: re.Pattern) -> str:
  try:
    text = path.read_text(encoding="utf-8")
  except OSError as error:
    raise SystemExit(f"error: {error}")
  match = pattern.search(text)
  return match.group(1) if match else ""


def local_scripts(entries: list) -> list:
  """(manifest entry, @name, @version) for each script entry."""
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


def selected(manifest: "Manifest", only: list) -> tuple:
  """The (scripts, libraries) to act on: everything, or just what's named.

  A named path that isn't in the manifest is still taken as a script, so
  `match` works on one before it's listed — but a path listed under
  `libraries` is only ever a library, never both.
  """
  if not only:
    return manifest.entries, manifest.libraries
  wanted = [relative_path(path) for path in only]
  by_path = {entry["path"]: entry for entry in manifest.entries}
  libraries = {entry["path"]: entry for entry in manifest.libraries}
  return ([by_path.get(path, {"path": path}) for path in wanted if path not in libraries],
          [libraries[path] for path in wanted if path in libraries])


def repo_path(source: str) -> Path:
  """A path naming a file in the repo, as the commands spell one.

  Relative paths are read against the repo root rather than the working
  directory, so `sites/foo/bar.user.js` means the same thing from
  anywhere — which is how the manifest spells a path too.
  """
  full = (Path(source) if Path(source).is_absolute() else REPO_ROOT / source).resolve()
  if not full.is_file():
    raise SystemExit(f"error: no such file: {full}")
  return full


def raw_url(source: str, branch: str) -> str:
  """Build the raw.githubusercontent.com URL that serves a local script.

  `source` is a path, repo-relative or absolute inside the repo; a URL
  passes through unchanged, so callers can take either from a user.
  Assembled from the `origin` remote, the branch, and the path — nothing
  is fetched, so an unpushed file gets a URL that 404s.
  """
  if "://" in source:
    return source
  full = repo_path(source)
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

def fetch_json(url: str, missing_ok: bool = False):
  """The JSON at a Greasy Fork API URL, or None for a 404 if allowed."""
  request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
  try:
    with urllib.request.urlopen(request, timeout=30) as response:
      return json.load(response)
  except urllib.error.HTTPError as error:
    if missing_ok and error.code == 404:
      return None
    raise SystemExit(f"error: could not read {url}: {error}")
  except (urllib.error.URLError, ValueError) as error:
    raise SystemExit(f"error: could not read {url}: {error}")


def published(api_base: str, user: str) -> list:
  """Every script on the user's Greasy Fork page, newest id last."""
  data = fetch_json(f"{api_base.rstrip('/')}/en/users/{user}.json")
  return [s for s in data.get("scripts", []) if not s.get("deleted")]


def published_one(api_base: str, script_id) -> dict:
  """One published script, by id, from its own JSON page — or None.

  This is how libraries are looked up: they're published as scripts, but
  Greasy Fork leaves them off the user page's `scripts` list, so nothing
  can discover them and their ids are recorded by hand. `code_url` in
  what comes back is the URL of the newest *version*, which is what a
  script's `@require` line has to name — Greasy Fork mints a new one per
  version, and a `@require` pointing at an old one stays on that old
  code until the script is edited.
  """
  return fetch_json(f"{api_base.rstrip('/')}/en/scripts/{script_id}.json", missing_ok=True)


def library_record(remote: dict) -> dict:
  """What we keep in a library's manifest entry, from its API entry."""
  return {"id": remote["id"], "url": remote["url"],
          "latest_version_url": remote["code_url"]}


def match_libraries(api_base: str, libraries: list) -> list:
  """(entry, published entry or None) for each library, by recorded id."""
  paired = []
  for entry in libraries:
    recorded = entry.get("greasyfork", {}).get("id")
    paired.append((entry, published_one(api_base, recorded) if recorded is not None else None))
  return paired


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
  scripts, library_entries = selected(manifest, args.paths)
  pairs, unpublished, orphans = match_up(
      local_scripts(scripts), published(args.api_base, args.user))
  libraries = match_libraries(args.api_base, library_entries)

  print(f"published and matched ({len(pairs)}):")
  out_of_sync = False
  for entry, name, version, remote in pairs:
    notes = ""
    if str(entry.get("greasyfork", {}).get("id")) != str(remote["id"]):
      notes += "   [id not in manifest]"
    if name != remote["name"]:
      # Matched by the recorded id, so a local rename shows up here
      # rather than as two unmatched scripts.
      notes += f"   [renamed; posted as {remote['name']!r}]"
    # A local version ahead of the published one means we have changes
    # that were never posted; a note means the manifest and Greasy Fork
    # disagree about something else. Either way the line needs reading,
    # so both get the same mark in the left column.
    mark = "  "
    if version != remote["version"] or notes:
      mark = "* "
      out_of_sync = True
    print(f"  {mark}{remote['id']}  local v{version} / posted v{remote['version']}  {entry['path']}{notes}")
  print(f"\nlocal only, never published ({len(unpublished)}):")
  for entry, name, _ in unpublished:
    print(f"    {entry['path']}" + ("" if name else "   [no @name header!]"))
  if orphans:
    print(f"\npublished but no local match ({len(orphans)}):")
    for remote in orphans:
      print(f"    {remote['id']}  {remote['name']}")
  stale = [(entry, remote) for entry, remote in libraries
           if remote and entry.get("greasyfork") != library_record(remote)]
  if libraries:
    posted = [(entry, remote) for entry, remote in libraries if remote]
    print(f"\nlibraries published and matched ({len(posted)}):")
    for entry, remote in posted:
      mark = "* " if (entry, remote) in stale else "  "
      note = "   [manifest URLs out of date; run link]" if (entry, remote) in stale else ""
      print(f"  {mark}{remote['id']}  posted v{remote['version']}  {entry['path']}{note}")
    missing = [(entry, recorded) for entry, remote in libraries if not remote
               for recorded in [entry.get("greasyfork", {}).get("id")]]
    if missing:
      print(f"\nlibraries with no published copy ({len(missing)}):")
      for entry, recorded in missing:
        # A recorded id that fetches nothing means the library was
        # deleted on Greasy Fork, or the hand-typed id is wrong.
        note = f"   [id {recorded} not found on Greasy Fork!]" if recorded is not None else ""
        print(f"    {entry['path']}{note}")
  if out_of_sync or stale:
    print("\n('*' marks anything published that's out of step with what Greasy "
          "Fork reports: a local @version that differs from the posted one, a "
          "note in brackets on the same line, or a library whose recorded URLs "
          "are out of date.)")


def cmd_link(args) -> None:
  manifest = Manifest(args.manifest)
  scripts, library_entries = selected(manifest, args.paths)
  pairs, _, _ = match_up(local_scripts(scripts), published(args.api_base, args.user))
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
  # Libraries are matched only by the id already in the manifest, so
  # this refreshes their URLs — above all `latest_version_url`, which
  # changes every time a new version is posted — and never adds one.
  for entry, remote in match_libraries(args.api_base, library_entries):
    if remote and entry.get("greasyfork") != library_record(remote):
      entry["greasyfork"] = library_record(remote)
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
