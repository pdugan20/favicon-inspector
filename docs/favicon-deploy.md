# Deploying the generated favicons

`npm run favicons:generate` writes a corrected set to `generated/<domain>/`,
but that only fixes anything once the files reach each site's origin. The
five domains run on three different stacks, so "apply the favicons" means
three different things. After deploying, Google's cache still takes days
to weeks to re-crawl (see [favicon-findings.md](./favicon-findings.md)).

## Mintlify sites — rewind.rest, clickwheel.fm

Mintlify does **not** accept a custom favicon set. It auto-generates every
size from a single source image declared in `docs.json`, and that
generator is what produced the transparent apple-touch that flattens to
black. So the fix is the **source image**, not the generated files.

1. Commit an **opaque, square** source into the docs repo. The tile in
   `scripts/masters/<domain>.tile.png` is exactly this — copy it into the
   Mintlify repo, e.g. as `/favicon.png`.
2. Point `docs.json` at it:

   ```json
   "favicon": "/favicon.png"
   ```

Because the source is opaque, every size Mintlify derives (including
apple-touch) stays opaque, so Google can't re-encode it onto black.

### Dark-mode tab variant (Mintlify)

Mintlify's `favicon` also takes a light/dark object (both required). Use
this when the mark disappears on one tab theme — notably **clickwheel**
(black "CW" vanishes on a dark tab):

```json
"favicon": {
  "light": "/favicon-light.png",
  "dark": "/favicon-dark.png"
}
```

Provide a dark-tab-friendly (light mark) image for `dark` and the normal
one for `light`. Both must be opaque and square.

## Next.js app router — next-up.app

Simplest path that works regardless of framework specifics: copy the whole
`generated/next-up.app/` set into `public/` (served at web root) and paste
`generated/next-up.app/head.html` into the root layout's `<head>`.

Alternatively, use Next's file conventions in `app/`: `favicon.ico`,
`icon.png` (use a large `rel=icon` PNG), `apple-icon.png` (use
`apple-touch-icon.png`), and `manifest.webmanifest`. Don't mix both
approaches — pick one so you don't emit duplicate tags.

## Static / Astro sites — getbiblio.app, patdugan.me

1. Copy everything in `generated/<domain>/` (minus `head.html`) into the
   site's web root / `public/` directory.
2. Paste the contents of `generated/<domain>/head.html` into `<head>`.

Keep the favicon URLs stable once live — Google keys its cache on a stable
URL and re-crawls slowly.

### Dark-mode tab variant (static)

These sites have no auto-generator, so a dark-adaptive tab icon needs a
`favicon.svg` that carries an internal
`@media (prefers-color-scheme: dark)` rule to flip the mark's color. This
affects the SVG path only (Chrome/Firefox/Edge; Safari support is
spotty); the PNG/ICO fallback stays single-version. Relevant for
**patdugan.me**, whose light-gray bolt is faint on a light tab.

## Verify after deploying

```bash
npm start                 # re-probe Google + origins
```

Origin findings should clear immediately; the Google favicon cells update
only after Google re-crawls (days to weeks). Re-run periodically or rely
on the monitor workflow.
