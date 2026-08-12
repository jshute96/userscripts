#!/usr/bin/env python3
"""
Build (and optionally launch) a Greasy Fork form URL with a prefilled hash.

Companion to sites/greasyfork.org/prefill-forms-from-hash.user.js, which
reads the hash and fills the form. See that script's .md for the full
parameter list.

Each subcommand's own options are listed further down; the options above
are shared and can go on either side of the subcommand.

Examples:
  # Post a new version, filled but not submitted, with two screenshots.
  greasyfork-url.py update 590960 \\
      --code-file sites/strava.com/fix-climb-slider.user.js \\
      --info-file sites/strava.com/fix-climb-slider.md \\
      --image-files sites/strava.com/screenshots/fix-climb-slider-before.png \\
      --image-files sites/strava.com/screenshots/fix-climb-slider-after.png \\
      --changelog-text 'Line the icons up with the slider.'

  # Import from GitHub.
  greasyfork-url.py import \\
      https://raw.githubusercontent.com/me/userscripts/main/a.user.js \\
      --sync-type automatic

The page is only ever filled in, never submitted — read it over and click
Greasy Fork's own button.

Local files:
  --code-file and --info-file are read here and inlined into the URL, so
  they always work. --image-files and --code-upload can only be passed as a
  location for the browser to fetch, and file:// reads fail in userscript
  managers that run the request from a service worker. If that bites, serve
  the repo over HTTP and pass --http-base:

    python3 -m http.server 8765 --directory .
    greasyfork-url.py update 590960 --http-base http://localhost:8765 ...

  Local paths under --http-root (default: the repo root) are then rewritten
  to URLs under --http-base.
"""
import argparse
import shutil
import subprocess
import sys
import textwrap
from pathlib import Path
from urllib.parse import quote

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_BASE = "https://greasyfork.org"
DEFAULT_LOCALE = "en"

# Extension -> format, so passing a .md doc selects the Markdown radio
# without having to say so twice.
FORMAT_BY_SUFFIX = {".md": "markdown", ".markdown": "markdown", ".html": "html", ".htm": "html"}


def read_text(path_str: str) -> str:
  path = Path(path_str)
  if not path.is_file():
    raise SystemExit(f"error: no such file: {path}")
  return path.read_text(encoding="utf-8")


def format_for(path_str: str, override: str | None) -> str:
  if override:
    return override
  suffix = Path(path_str).suffix.lower()
  if suffix not in FORMAT_BY_SUFFIX:
    raise SystemExit(
      f"error: can't tell the format of {path_str} from its extension; pass it explicitly"
    )
  return FORMAT_BY_SUFFIX[suffix]


def as_location(path_str: str, args) -> str:
  """Turn a local path into something the *browser* can fetch."""
  if "://" in path_str:
    return path_str
  path = Path(path_str).resolve()
  if not path.is_file():
    raise SystemExit(f"error: no such file: {path}")
  if args.http_base:
    root = Path(args.http_root).resolve()
    try:
      relative = path.relative_to(root)
    except ValueError:
      raise SystemExit(f"error: {path} is not under --http-root {root}, so it can't be served")
    return f"{args.http_base.rstrip('/')}/{quote(str(relative))}"
  return f"file://{path}"


def build_hash(params: list[tuple[str, str]]) -> str:
  # quote() with an empty safe list matches the userscript's
  # decodeURIComponent parsing — notably it escapes "+", which would
  # otherwise be ambiguous.
  return "&".join(f"{key}={quote(value, safe='')}" for key, value in params)


def script_params(args) -> list[tuple[str, str]]:
  params: list[tuple[str, str]] = []

  code_sources = [bool(args.code_file), bool(args.code_url), bool(args.code_upload)]
  if sum(code_sources) > 1:
    raise SystemExit("error: pass only one of --code-file, --code-url, --code-upload")
  if args.code_file:
    params.append(("code", read_text(args.code_file)))
  elif args.code_url:
    params.append(("code_url", args.code_url))
  elif args.code_upload:
    params.append(("code_upload", as_location(args.code_upload, args)))

  if args.info_file and args.info_text:
    raise SystemExit("error: pass only one of --info-file, --info-text")
  if args.info_format and not (args.info_file or args.info_text):
    raise SystemExit("error: --info-format needs --info-file or --info-text")
  if args.info_file:
    info = read_text(args.info_file)
    params.append((f"additional_info_{format_for(args.info_file, args.info_format)}", info))
  elif args.info_text:
    params.append((f"additional_info_{args.info_format or 'html'}", args.info_text))

  if args.image_files:
    # Each --image-files may itself be a comma-separated list; flatten in
    # the order given, which is the order they'll appear on the script.
    paths = [path for group in args.image_files for path in group.split(",") if path.strip()]
    params.append(("image_files", ",".join(as_location(p.strip(), args) for p in paths)))

  if args.script_type:
    params.append(("script_type", args.script_type))
  if args.name:
    params.append(("name", args.name))
  if args.description:
    params.append(("description", args.description))
  if args.adult:
    params.append(("adult", "1"))
  if args.source_editor is not None:
    params.append(("source_editor", "1" if args.source_editor else "0"))
  return params


def update_params(args) -> list[tuple[str, str]]:
  params = script_params(args)
  if args.changelog_text and args.changelog_file:
    raise SystemExit("error: pass only one of --changelog-text, --changelog-file")
  if args.changelog_format and not (args.changelog_text or args.changelog_file):
    raise SystemExit("error: --changelog-format needs --changelog-text or --changelog-file")
  if args.changelog_text:
    params.append((f"changelog_{args.changelog_format or 'html'}", args.changelog_text))
  elif args.changelog_file:
    # Read first, so a missing file reports that rather than complaining
    # about the extension.
    changelog = read_text(args.changelog_file)
    params.append((f"changelog_{format_for(args.changelog_file, args.changelog_format)}", changelog))
  if args.remove_images:
    params.append(("remove_images", "all"))
  return params


def script_id_of(value: str) -> str:
  """Accept a bare id, a slug, or any URL containing /scripts/<id>."""
  if "://" not in value:
    return value
  # Take the segment after "scripts", not the first digit-leading one: a
  # host like "127.0.0.1:8765" would otherwise be read as the script id.
  parts = value.split("/")
  if "scripts" in parts:
    index = parts.index("scripts") + 1
    if index < len(parts) and parts[index]:
      return parts[index]
  raise SystemExit(f"error: could not find a script id in {value}")


class TopLevelParser(argparse.ArgumentParser):
  """Top-level parser that shows one usage line per subcommand.

  argparse's default usage is "{new,update,import} ...", which says
  nothing about what each command takes. This substitutes each
  subcommand's own usage instead, so the synopsis printed on an error
  (or by --help) shows the three commands and their flags. The shared
  options are hidden from the subparsers' help, so they're listed once
  on a trailing line.
  """

  def __init__(self, *args, **kwargs):
    super().__init__(*args, **kwargs)
    self.subcommand_parsers: list[argparse.ArgumentParser] = []

  def format_usage(self) -> str:
    if not self.subcommand_parsers:
      return super().format_usage()
    lines = []
    for index, sub in enumerate(self.subcommand_parsers):
      prefix = "usage: " if index == 0 else "       "
      lines.append(prefix + sub.format_usage().removeprefix("usage: ").rstrip())
    # The shared options carry help=SUPPRESS on the subparsers, so they
    # appear in none of the lines above.
    shared = " ".join(
      f"[{action.option_strings[0]}]" if action.nargs == 0
      else f"[{action.option_strings[0]} {action.dest.upper()}]"
      for action in self._actions
      if action.option_strings and action.dest != "help"
    )
    width = max(40, shutil.get_terminal_size().columns - 2)
    lines.append("\nshared options (either side of the subcommand):\n" + textwrap.fill(
      shared, width=width, initial_indent="  ", subsequent_indent="  ",
      # Without this, textwrap splits "[--keep-hash]" across two lines.
      break_on_hyphens=False,
    ))
    # Trailing blank line so the error argparse prints next doesn't butt up
    # against the shared-options list.
    return "\n".join(lines) + "\n\n"


def main() -> int:
  parser = TopLevelParser(
    description=__doc__,
    formatter_class=argparse.RawDescriptionHelpFormatter,
  )
  # The options below are accepted both before and after the subcommand,
  # which argparse only allows if they're declared on every parser. They
  # default to SUPPRESS so that a value given before the subcommand isn't
  # overwritten by the subparser's default; real defaults are applied after
  # parsing. On the subparsers they're also hidden from --help, so each
  # subcommand's help lists only what's specific to it and the shared
  # options are documented once, at the top.
  def add_hidden_help(sub):
    # The subparsers are built with add_help=False so that "[-h]" doesn't
    # repeat on every usage line; -h still works, just undocumented there.
    sub.add_argument("-h", "--help", action="help", help=argparse.SUPPRESS)

  def add_common_options(sub, documented: bool = True):
    def visible(text: str) -> str:
      return text if documented else argparse.SUPPRESS

    sub.add_argument("--base", default=argparse.SUPPRESS, help=visible(f"site root (default {DEFAULT_BASE})"))
    sub.add_argument("--locale", default=argparse.SUPPRESS, help=visible(f"URL locale segment (default {DEFAULT_LOCALE})"))
    sub.add_argument("--keep-hash", action="store_true", default=argparse.SUPPRESS, help=visible("leave the parameters in the address bar"))
    sub.add_argument("--print", dest="print_only", action="store_true", default=argparse.SUPPRESS, help=visible("print the URL, don't launch a browser"))
    sub.add_argument("--browser", default=argparse.SUPPRESS, help=visible("browser command (default google-chrome)"))
    sub.add_argument("--http-base", default=argparse.SUPPRESS, help=visible("serve local files from this URL prefix instead of file://"))
    sub.add_argument("--http-root", default=argparse.SUPPRESS, help=visible("directory --http-base serves (default: repo root)"))

  COMMON_DEFAULTS = {
    "base": DEFAULT_BASE,
    "locale": DEFAULT_LOCALE,
    "keep_hash": False,
    "print_only": False,
    "browser": "google-chrome",
    "http_base": None,
    "http_root": str(REPO_ROOT),
  }

  add_common_options(parser)
  # parser_class: subparsers default to their parent's class, which would
  # make each of them recurse into printing its own subcommands.
  subparsers = parser.add_subparsers(
    dest="command", metavar="{new,update,import}", required=True,
    parser_class=argparse.ArgumentParser)
  # Repeated at the foot of each subcommand's help, since the shared
  # options are hidden there.
  shared_note = "Also accepts the shared options listed by `greasyfork-url.py --help`."

  def add_script_options(sub):
    sub.add_argument("--code-file", metavar="FILE", help="read the code from FILE and inline it")
    sub.add_argument("--code-url", metavar="URL", help="have the browser load the code from URL")
    sub.add_argument("--code-upload", metavar="FILE", help="attach FILE to the 'Or upload' input")
    sub.add_argument("--info-file", metavar="FILE", help="read Additional info from FILE (format from its extension)")
    sub.add_argument("--info-text", metavar="TEXT", help="Additional info as literal text")
    sub.add_argument("--info-format", choices=["html", "markdown"], help="override the Additional info format")
    sub.add_argument("--image-files", metavar="FILE[,FILE...]", action="append",
                     help="images to attach, in order (comma-separated, and repeatable)")
    sub.add_argument("--script-type", choices=["public", "unlisted", "library"], help="script type")
    sub.add_argument("--name", help="library name")
    sub.add_argument("--description", help="library description")
    sub.add_argument("--adult", action="store_true", help="tick the adult-content self-report")
    sub.add_argument("--source-editor", action=argparse.BooleanOptionalAction, default=None,
                     help="turn Greasy Fork's syntax-highlighting code editor on or off")

  new_parser = subparsers.add_parser(
    "new", add_help=False, help="post a new script", description="Fill the 'Post a new script' form.", epilog=shared_note)
  add_hidden_help(new_parser)
  add_common_options(new_parser, documented=False)
  add_script_options(new_parser)
  new_parser.add_argument("--script-locale", metavar="LANG", help="script language, e.g. 'es' or 'Spanish'")

  update_parser = subparsers.add_parser(
    "update", add_help=False, help="post a new version of an existing script",
    description="Fill the 'Post a new version' form for an existing script.", epilog=shared_note)
  update_parser.add_argument("script", help="script id, slug, or a URL containing one")
  add_hidden_help(update_parser)
  add_common_options(update_parser, documented=False)
  add_script_options(update_parser)
  update_parser.add_argument("--changelog-text", metavar="TEXT", help="changelog as literal text")
  update_parser.add_argument("--changelog-file", metavar="FILE", help="read the changelog from FILE")
  update_parser.add_argument("--changelog-format", choices=["html", "markdown"], help="changelog format")
  update_parser.add_argument("--remove-images", action="store_true", help="tick every existing image's remove box")

  import_parser = subparsers.add_parser(
    "import", add_help=False, help="import scripts from source URLs",
    description="Fill the 'Import scripts' form.", epilog=shared_note)
  add_hidden_help(import_parser)
  add_common_options(import_parser, documented=False)
  import_parser.add_argument("urls", nargs="+", help="source URLs to import")
  import_parser.add_argument("--language", choices=["detect", "js", "css"], help="script language")
  import_parser.add_argument("--sync-type", choices=["automatic", "manual"], help="initial sync type")

  parser.subcommand_parsers = [new_parser, update_parser, import_parser]

  args = parser.parse_args()
  for key, value in COMMON_DEFAULTS.items():
    if not hasattr(args, key):
      setattr(args, key, value)
  prefix = f"{args.base.rstrip('/')}/{args.locale}" if args.locale else args.base.rstrip("/")

  if args.command == "new":
    path = f"{prefix}/script_versions/new"
    params = script_params(args)
    if args.script_locale:
      params.append(("script_locale", args.script_locale))
  elif args.command == "update":
    path = f"{prefix}/scripts/{script_id_of(args.script)}/versions/new"
    params = update_params(args)
  else:
    path = f"{prefix}/import"
    params = [("urls", "\n".join(args.urls))]
    if args.language:
      params.append(("language", args.language))
    if args.sync_type:
      params.append(("sync_type", args.sync_type))

  if args.keep_hash:
    params.append(("keep_hash", "1"))
  if not params:
    raise SystemExit("error: nothing to prefill")

  url = f"{path}#{build_hash(params)}"

  if args.print_only:
    print(url)
    return 0
  print(url, file=sys.stderr)
  try:
    subprocess.Popen(
      [args.browser, url],
      stdout=subprocess.DEVNULL,
      stderr=subprocess.DEVNULL,
      start_new_session=True,
    )
  except FileNotFoundError:
    raise SystemExit(f"error: browser command not found: {args.browser}")
  return 0


if __name__ == "__main__":
  sys.exit(main())
