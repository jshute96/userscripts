# Instagram: Fullscreen images and video, video seek bar, keyboard shortcuts

## Summary

Improvements for Instagram's web viewer:

**Full-screen images and videos**: Press <kbd>f</kbd> or click the full-screen icon.

**Video seek bar**: Show a progress bar on videos, allowing seeking.

**Keyboard navigation**: Step through images and videos, including in full-screen mode.
* <kbd>j</kbd> / <kbd>k</kbd> step to the next / previous image in one post, and then into the next post.
* <kbd>h</kbd> / <kbd>l</kbd> skip direclty to the next / previous post.

These work on post pages, the post popup, individual Reels, the Reels
feed and the home feed.

Next post follows Instagram's order in the post popup
(opened by clicking a post on a profile). On a standalone post page, Instagram
doesn't have a "Next" post. The script steps into the next post following
the order in the "More posts" grid below.

### Keyboard shortcuts

| Key | Action |
| --- | --- |
| <kbd>f</kbd> | Fullscreen on / off |
| <kbd>s</kbd> | Sound on / off |
| <kbd>Space</kbd> | Play / pause |
| <kbd>j</kbd> / <kbd>k</kbd> | Next / previous photo or video in a multi-photo post, and on into the next / previous post past either end |
| <kbd>h</kbd> / <kbd>l</kbd> | Next / previous post |
| <kbd>?</kbd> | List all shortcuts |

Keys act on the video or photo that's fullscreen, or the one under the
mouse, or the one most visible on screen.

## Visible changes

* A thin white progress bar along the bottom edge of each video, which
  thickens on hover and shows a time label.
* A round fullscreen button just left of Instagram's mute button on
  videos, and in the bottom-right corner of photos.
* In fullscreen, round arrow buttons beside the photo or video and at the
  screen edges.
* The `f`, `s`, `h`, `j`, `k`, `l` and Space keys are taken over while a video or photo
  is on the page, and `?` shows a help overlay. Instagram doesn't use
  these keys itself (its own shortcuts are the plain arrows, `/`, `n`,
  `b`, F1, Esc and Ctrl+B).

## Implementation

### What we depend on

* Every Instagram video player (post page, `/reel/…`, the `/reels/`
  feed, the home feed) is a `<video>` with a `blob:` source (the video
  streams in through Media Source Extensions, a browser API for feeding
  video data from JavaScript), and an overlay layer covering it:
  `div[role="group"]` (with `aria-label="Video player"` in English). The
  overlay lives in a sibling branch of the video's, and holds
  Instagram's own mute button, tag button and click-to-pause target.
* We find the overlay by walking up from each `<video>` until an
  ancestor contains a `[role="group"]` that doesn't itself contain the
  video, stopping if an ancestor holds a second `<video>`. That ancestor
  (the "container") holds both branches and is the element we send
  fullscreen. We don't match on the `aria-label`, since it's translated.
* The container's descendants down to the `<video>` are all sized
  `100%`, so the video grows with the container in fullscreen.
* A multi-photo post ("carousel") is a `<ul>` of `<li>` slides, each
  placed with `transform: translateX(<n × slide width>px)` and only some
  of them in the DOM at once. The `<ul>` and its wrapper are 1px wide.
  Around them sit several same-size frames, the outermost of which also
  holds the previous / next arrow `<button>`s (labeled "Go back" /
  "Next" in English), vertically centered at the left and right edges.
  "Go back" is absent on the first slide and "Next" on the last.
* The post popup is a `[role="dialog"]` holding the post's `<article>`,
  with previous / next post arrows (`<button>`s labeled "Go back" /
  "Next" in English) outside the article, vertically centered at the
  screen edges. A post's own page has none.
* Until a video loads, its place holds a poster `<img>` laid out just
  like a photo's (in a post page's case, for about half a second). We
  tell it by Instagram's generated alt text, "Video by …" (English
  only), or by shape: Instagram crops photos to at most 3:4, so anything
  much taller (a Reel's 9:16) is a poster. A video in a multi-photo
  post, cropped to a photo's shape, is caught by the alt text only.
* Each photo is an `<img>` with `object-fit: cover` in a box sized by an
  inline `padding-bottom: <aspect>%`, with a `srcset` listing its sizes
  up to the original.
* Post thumbnails in grids ("More posts", profiles) are inside `<a>`
  links to the post.

### How we modify the page

* The seek bar and video button are appended inside the overlay, so
  they stack above Instagram's click target. They stop propagation of
  mouse, pointer and touch events, so Instagram doesn't treat a seek as
  a pause, mute or navigation click.
* Progress redraws on a `requestAnimationFrame` loop that runs only
  while some attached video is playing, started by `play` / `seeked` /
  `loadedmetadata` events caught in the capture phase on `document`
  (media events don't bubble), and on attaching.
* The `<video>` is looked up from the container each time rather than
  held, in case Instagram swaps it.
* The video button is lined up beside the mute button by measuring it,
  on each mouse-enter, player resize and fullscreen change, since the
  mute button's offset from the corner varies (12px on post pages, 16px
  in the Reels feed). The top edge is no good: the home feed overlays
  the poster's name and menu there.
* Photos: an `<img>` of at least 200px, inside an `article`, `main` or
  dialog, and not inside a link, a video's overlay, or a video's poster,
  is a post photo.
  Its "media box" is the outermost ancestor the same size as the photo.
  For a carousel, it's measured from the `<ul>` instead (skipping its
  1px wrappers), since in the post popup the frame holding the arrows is
  wider than the slides (775px vs 748px). The box gets `data-jshute-ig-video-image` and our
  button in its bottom-right corner. If an early scan picked a box inside
  the final one (while the page was still laying out), the outer one
  replaces it.
* The slide showing is the `<li>` across the box's horizontal middle.
  While it's a video, the box gets `data-jshute-ig-video-video-slide`,
  which hides the photo button in favor of the video's own.
* Fullscreen is `requestFullscreen()` on `<html>`, entered once, with
  the media drawn over the page. Making Instagram's own element
  fullscreen instead drops out of fullscreen whenever Instagram replaces
  it, which it does on every carousel step and post change.
  - A photo is shown in a viewer of our own: a black `div` hung off
    `<html>` with an `<img>` of the largest `srcset` entry. Instagram's
    carousel can't be used directly: at fullscreen width each slide
    keeps its aspect-ratio box and overflows the screen.
  - Every swap is made only once the new media can draw: a photo is
    decoded off-screen first, and a new video isn't pinned until it has
    a frame (`readyState` 2 or more). Until then, what was showing stays
    up. The previous / next photo arrows, placed by the media's size,
    stay hidden while a stand-in shows.
  - A video's player container is pinned (`data-jshute-ig-video-pinned`:
    `position: fixed; inset: 0`, with `object-fit: contain` on the
    video), so our seek bar and Instagram's mute button come along.
    Ancestors with a `transform` (each carousel slide has one), filter or
    containment would trap a fixed element in their own box, so they get
    `data-jshute-ig-video-untransform`, which turns those off until it's
    unpinned, along with transitions, or the carousel's own transition
    animates the change and the player slides into place. The viewer
    stays over it for two frames, until it's drawn in place. Images in
    the pinned player are hidden: Instagram's poster lingers a moment
    over a video that's already drawing, and pinned it fills the screen,
    cropped.
  - Stepping to a neighboring photo starts on it at once, from the copy
    the page has (Instagram preloads the slides on either side), rather
    than waiting out Instagram's slide animation. The full-size
    original replaces it when it arrives. Otherwise the current photo
    stays up until the next media is found.
  - Leaving a pinned video (to another slide or post), its current frame
    is drawn to a `<canvas>` in the viewer and held there until the next media
    shows, so there's no gap. (Its stream is fed in by the page's own
    code, so the canvas isn't cross-origin tainted.) It's unpinned right
    away, since its slide's switched-off transform would confuse the
    carousel. If the frame can't be had, the viewer is shown empty, as a
    black cover, with the arrows hidden.
  - Following to another post waits for the media itself to change, not
    just the URL: Instagram changes the URL first and swaps the post in
    later. As a backstop, each rescan checks that what's showing is still
    on the page, and if Instagram has taken it away, shows the post's
    current media, or black until there is some.
* `j` / `k` click the carousel's own arrows, found by
  position rather than label. With no arrow that way (either end, or a
  single photo or video), they go to the previous / next post instead.
* Previous / next post (`l` / `h`) click the popup's post arrow, found by position. With none, they
  go by a remembered post list: on any page that isn't a post (a profile,
  say), each scan records the `<main>` grid's links to `/p/…` and
  `/reel/…` posts in DOM order, appending as more load, in
  `sessionStorage` under `jshute-ig-video-posts`. A post page's own
  "More posts" grid isn't recorded, since it isn't a sequence the post
  belongs to. To move, we `history.pushState()` the neighbor's link and
  dispatch `popstate`, which Instagram's router follows as it would a
  back / forward, loading the post in place without a page reload. In fullscreen, we then wait for the middle
  slide or the URL to change and show the new media. If it never
  changes, we go back to what was showing, or leave fullscreen.
* In the popup, Instagram's own ←/→ change posts. In fullscreen that
  happens behind our view, so a capture-phase `keydown` listener (when
  there's a post arrow that way) does the same follow, leaving the key
  to Instagram.
* The fullscreen arrow buttons, on their own layer above the media,
  mirror whichever of Instagram's are
  present, rechecked on each rescan. The photo arrows sit just outside
  the photo or video as drawn (`object-fit: contain`), computed from its
  natural size, but no closer to the edge than the post arrows allow.
* In fullscreen, Chrome takes Esc to leave fullscreen before the page
  sees it, so the `?` help couldn't close on Esc. We lock Esc with the
  Keyboard Lock API (`navigator.keyboard.lock(['Escape'])`), which sends
  it to the page (holding Esc still leaves fullscreen), and leave
  fullscreen on Esc ourselves unless the help is open. Keys sent through
  the DevTools protocol (`Input.dispatchKeyEvent`) stop reaching the page
  while the lock is on, so automated tests of fullscreen keys need it
  off.
* Keys go through the shared `lib/keyboard-shortcuts.js`, which skips
  them while typing and lists them in the `?` overlay. `s` clicks
  Instagram's own mute button (the `[role="button"]` inside the volume
  `[role="slider"]` in the overlay) rather than setting `video.muted`,
  so Instagram's icon and remembered mute setting stay in step. It
  falls back to `video.muted` if that button isn't found.
* A `MutationObserver` on the document rescans for new videos and
  photos, which covers SPA navigation (Instagram changes pages without
  reloading), feeds loading as you scroll, and carousel slides changing.
  Overlays and boxes we've marked are skipped, so rescans are
  idempotent.

### Notes

* Logged out, the home feed is a login page and profile pages show
  thumbnails only, so post pages and Reels are the places media shows.
  The post popup and the home feed need a login, so they were checked
  from snapshots of a logged-in session.
* Instagram's streaming picks the video quality itself. We've seen
  720p and 1080p streams for the same post, at the same player size.
