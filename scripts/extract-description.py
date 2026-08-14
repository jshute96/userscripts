#!/usr/bin/env python3
"""Extract the published description (the Summary section) from a script's
doc file, and/or list the screenshots it references.

The `.md` file next to each userscript holds, in its `## Summary` section,
the user-facing description we post to script repository sites like Greasy
Fork. Those sites strip the images out of the description and show them in
a separate gallery, so this script can either drop the images from the text
or list them on their own.

When the images are stripped, the per-image labels in the doc go with them
and a gallery of several images ends up unlabeled. Such a doc names its
gallery with a comment line above its images:

  <!-- image-gallery-heading: **Search page before and after:** -->

That line is invisible in the doc itself, is dropped from the full text,
and is emitted at the end of the `--no-images` text, where it lands
directly above the gallery. A doc with a single image needs no comment —
its one label already reads as the gallery's heading, so it's kept.

Usage:
  extract-description.py sites/strava.com/fix-climb-slider.md
  extract-description.py --no-images sites/strava.com/fix-climb-slider.md
  extract-description.py --images sites/strava.com/fix-climb-slider.md
"""

import argparse
import re
import sys
from pathlib import Path

SECTION = "Summary"

# Markdown images: ![alt](path "title")  — and HTML ones: <img src="path">
MD_IMAGE = re.compile(r"!\[[^\]]*\]\(\s*(<[^>]*>|[^)\s]+)(?:\s+[^)]*)?\)")
HTML_IMAGE = re.compile(r"""<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>""",
                        re.IGNORECASE)
# A label line above an image: one short line, bold and/or ending in a
# colon — "**Search page before:**", "**Screenshot** (with the popup):".
LABEL_LINE = re.compile(r"^(?=.{,120}$)(?:\*\*.+|.*:)$")
# The heading to use above the image gallery when the images are stripped.
GALLERY_HEADING = re.compile(
    r"^[ \t]*<!--[ \t]*image-gallery-heading:[ \t]*(.*?)[ \t]*-->[ \t]*$\n?",
    re.MULTILINE | re.DOTALL)


def section_text(markdown: str, heading: str) -> str:
  """Return the body of the `## <heading>` section, without its heading."""
  pattern = re.compile(
      rf"^\#\#\s+{re.escape(heading)}\s*$(.*?)(?=^\#\#\s|\Z)",
      re.MULTILINE | re.DOTALL)
  match = pattern.search(markdown)
  if not match:
    raise SystemExit(f"error: no '## {heading}' section found")
  return match.group(1).strip("\n")


def gallery_heading(text: str) -> str:
  """The `image-gallery-heading` comment's text, or '' if there isn't one."""
  match = GALLERY_HEADING.search(text)
  return match.group(1).strip() if match else ""


def without_comments(text: str) -> str:
  """Drop HTML comments — they're notes to us, not part of the description."""
  return re.sub(r"[ \t]*<!--.*?-->[ \t]*\n?", "", text, flags=re.DOTALL)


def image_paths(text: str) -> list:
  """Every image reference in `text`, in the order it appears."""
  found = []
  for match in re.finditer(f"{MD_IMAGE.pattern}|{HTML_IMAGE.pattern}",
                           text, re.IGNORECASE):
    path = match.group(1) or match.group(2)
    found.append(path.strip("<>").strip())
  return found


def strip_images(text: str, keep_labels: bool = False) -> str:
  """Remove images, the blocks that hold them, and their labels.

  Blocks are blank-line-separated. A block that is nothing but images — or
  an HTML wrapper (a `<table>` layout) around them — is dropped whole,
  along with a bold label line immediately above it. A block that mixes
  prose and an image keeps the prose and loses just the image markup.
  Any heading left with nothing under it goes too.

  With `keep_labels`, the labels stay: for a doc with a single image the
  label already reads as a heading for the gallery, so there's no need to
  repeat it in an `image-gallery-heading` comment.
  """
  blocks = re.split(r"\n\s*\n", text)
  kept = []
  for block in blocks:
    if image_paths(block):
      if block.lstrip().startswith("<"):
        # An HTML wrapper exists only to lay the images out, so it goes
        # with them, cell captions ("Before" / "After") included.
        without = ""
      else:
        without = HTML_IMAGE.sub("", MD_IMAGE.sub("", block)).strip()
      if not without:
        # Drop a label line sitting directly above this block.
        if not keep_labels and kept and LABEL_LINE.match(kept[-1].strip()):
          kept.pop()
        continue
      block = without
    kept.append(block)
  return "\n\n".join(b.strip("\n") for b in drop_empty_sections(kept)).strip() + "\n"


def heading_level(block: str) -> int:
  """Heading depth of a block (`## ` is 2), or 0 if it isn't a heading."""
  match = re.match(r"(\#{1,6})\s", block.strip())
  return len(match.group(1)) if match else 0


def drop_empty_sections(blocks: list) -> list:
  """Drop headings whose whole section was removed with the images."""
  kept = []
  for block in blocks:
    level = heading_level(block)
    if level:
      # Any heading still open at this depth or deeper had no content.
      while kept and 0 < heading_level(kept[-1]) >= level:
        kept.pop()
    kept.append(block)
  while kept and heading_level(kept[-1]):
    kept.pop()
  return kept


def main() -> None:
  parser = argparse.ArgumentParser(
      description=f"Extract the '{SECTION}' section of a userscript doc file.")
  parser.add_argument("doc", type=Path, help="path to the script's .md file")
  group = parser.add_mutually_exclusive_group()
  group.add_argument("--no-images", action="store_true",
                     help="print the text with images (and their labels) removed")
  group.add_argument("--images", action="store_true",
                     help="print only the image paths, one per line")
  parser.add_argument("--as-written", action="store_true",
                      help="with --images, print paths as they appear in the "
                           "doc instead of resolving them against its directory")
  args = parser.parse_args()

  try:
    markdown = args.doc.read_text(encoding="utf-8")
  except OSError as error:
    raise SystemExit(f"error: {error}")

  text = section_text(markdown, SECTION)
  heading = gallery_heading(text)
  text = without_comments(text)
  images = image_paths(text)

  if args.images:
    for path in images:
      if args.as_written or "://" in path:
        print(path)
      else:
        print((args.doc.parent / path).resolve())
  elif args.no_images:
    # One image needs no gallery heading of its own — its label in the doc
    # already is one, so keep it rather than make every such doc repeat it
    # in a comment.
    keep_labels = len(images) == 1 and not heading
    if len(images) > 1 and not heading:
      print(f"warning: {args.doc} has images but no "
            f"'<!-- image-gallery-heading: … -->' comment", file=sys.stderr)
    body = strip_images(text, keep_labels).rstrip("\n")
    sys.stdout.write(f"{body}\n\n{heading}\n" if heading else f"{body}\n")
  else:
    sys.stdout.write(text.strip() + "\n")


if __name__ == "__main__":
  main()
