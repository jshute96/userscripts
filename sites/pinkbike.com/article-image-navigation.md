# Pinkbike: article image navigation

## Summary

Add `i` / `Shift-I` keyboard shortcuts to step through the large
photos (and videos) in a Pinkbike news article — for "photo gallery"
style posts where you want to scan visuals without scrolling by hand.

## Visible changes

* `i` — scroll the next big photo/video in the article to the top of
  the viewport (with a small buffer above so the photo's top border
  is visible). From the top of the page, this lands on the article's
  first hero photo.
* `Shift-I` — same, but in reverse: scroll the previous big photo to
  the top.
* If a photo is already at the top of the viewport, pressing `i`
  advances past it to the next one (rather than re-anchoring the
  same image). `Shift-I` is symmetric.
* Stops at the bottom of the article body. Photos in the comments
  section, related-articles tiles, and ad slots are excluded.
* All jumps use smooth scrolling. The script does not modify any
  visible markup — only attaches a `keydown` listener.

## Implementation

### What Pinkbike's article body looks like

The article body is wrapped in one or more `<div class="blog-section">`
containers (one for the main body, sometimes a couple of auxiliary
ones for tags, author bio, etc.). Photos inside the body follow this
structure:

```
div.blog-section
  div.blog-section-inside
    div.media-media-width  (or div.media-text-width for inline shots)
      a
        div.news-photo-element-width
          div.news-photo-element-height
            img
```

Side-by-side photos sit inside `div.columns-inside > div.column.
span-1 > div.media-text-width > a > … > img` (same image wrapper,
just an extra column wrapper).

Videos and YouTube/Vimeo embeds, when present, also live inside
`.blog-section` as `<video>` or `<iframe src="…youtube…">` /
`iframe src="…vimeo…"` elements. (The probed article had no videos,
but the wrapper structure is the same.)

Photo `<img>` elements are lazy-loaded: the final URL lives in
`data-src` from initial render, and `src` is empty until the image
scrolls near the viewport. The wrapper is pre-sized so
`getBoundingClientRect().height` reports the real rendered height
even before the image has actually loaded — which means our height
filter works without any scrolling-to-prime step. We identify an
image by its `data-src` filename for the same reason: it's the
stable identifier from page-load time onward.

### Picking which images count

A photo "counts" if:

1. It sits inside any `.blog-section` (i.e. inside the article body
   container), and
2. Its `absoluteTop` is strictly less than the top of the comments
   section (`.news-comments-container`), and
3. Its rendered height is at least `MIN_HEIGHT_PX` (200 px).

The comments-top bound matters on photo-gallery articles. Pinkbike
reuses `.blog-section` for "more from this author," "related stories,"
sponsored gallery widgets, and similar blocks that sit *after* the
comments — and those frequently contain big photos. Without the
upper bound, `i` would happily scroll past the comments into that
clutter. We use the top of `.news-comments-container` as the
boundary, falling back to `#commenttop` and then to the document
bottom.

The height threshold is what cleanly separates gallery photos from
clutter:

- Comment avatars: ~30 px tall — excluded.
- Related-articles thumbnails: ~120 px tall — excluded.
- Ad banners and inline icons: also well under the threshold.
- Side-by-side article photos: ~250 px tall — included.
- Hero photos and standalone inline shots: 500–800 px tall — included.

Earlier iterations used a fraction of viewport height (`vh / 4`),
which had the unintuitive effect of changing the reachable set as the
window was resized — a taller window could lock the user out of the
side-by-side photos. The fixed pixel cutoff sidesteps that and is
plenty selective in practice because the categories above are well
separated.

Recomputing the list on every keypress (rather than caching at init
time) lets lazy-loaded images that resolve later be included
automatically.

### Scroll math

`SCROLL_BUFFER = 30` px. When pressing `i`, the target scroll
position is `imageAbsoluteTop - SCROLL_BUFFER`, so the image's top
edge lands 30px below the viewport top — enough to see the border
and recognise "new photo starts here."

The "current anchor line" is defined as `scrollY + SCROLL_BUFFER` —
the y-coordinate where the *next* `i` press would place an image's
top.

- `i` picks the first qualifying image whose `absTop` is strictly
  greater than `anchor + EPSILON` (where EPSILON is 5px). This
  skips past an image that was just anchored, because *its* `absTop`
  equals the anchor exactly.
- `Shift-I` picks the last qualifying image whose `absTop` is
  strictly less than `anchor - EPSILON`.

`window.scrollTo({ top, behavior: 'smooth' })` does the scroll.

### What we assume stays stable

The script breaks if any of these change:

1. The article body is wrapped in `.blog-section` (used to scope the
   image search). If Pinkbike renames it, no images will be found
   and the script logs "no qualifying images in `.blog-section`".
2. `.news-comments-container` (or `#commenttop`) is present and sits
   between the article body and any post-article `.blog-section`
   blocks. If either changes, the bottom-of-article bound disappears
   and `i` may again start matching photos in related-stories
   widgets.
3. Article photos are rendered as `<img>` elements with computed
   bounding-box height. (Background-image hero photos would be
   missed.)
4. Videos use `<video>` tags or `<iframe>` whose `src` contains
   `youtube` or `vimeo`. Other embed providers would need their host
   added to the selector.
5. The article is server-rendered (or hydrated before
   `document-idle`) such that the image elements exist in the DOM by
   the time the script's keydown handler is called. Lazy-loaded
   image *content* is fine — we recompute the list on every press —
   but if the `<img>` elements themselves are injected later, they
   won't be picked up until the user presses a key after they
   appear.

### Logging

`[pb img]` log lines on every action: which key, which target image
(by filename — taken from `data-src` if present, otherwise the live
`src`) and at what absolute y, plus the no-op cases (no qualifying
images at all; no next/previous from current position). A future
regression should produce one of those no-op lines, which is enough
to start triage.

### If this breaks in the future

1. Open DevTools. Look for `[pb img] initializing`. Missing → @match
   or install issue.
2. Press `i`. If it logs "no qualifying images in `.blog-section`",
   the wrapper class has changed — re-run the probe to find the new
   article body container.
3. If `i` logs `i -> img(...) @ y=…` but the viewport doesn't move,
   the smooth-scroll target is being preempted by another script —
   try a non-smooth scroll to confirm.
4. If a video plays inline but `i` skips it, check what tag/host the
   embed uses and extend the selector accordingly.
