# Favicon tile masters

Drop one edge-to-edge tile here per domain to generate its
`apple-touch-icon` and maskable icon. Without a tile, the generator skips
those two slots (it never emits a white-boxed fallback).

## File naming

Name each file `<domain>.tile.png` or `<domain>.tile.svg`, matching the
domain exactly as listed in `favicon-inspector.config.json`:

```text
scripts/masters/rewind.rest.tile.png
scripts/masters/getbiblio.app.tile.png
scripts/masters/clickwheel.fm.tile.svg
```

## Format

- **Square**, 1:1 aspect ratio.
- **PNG at 1024x1024** (512 minimum), or an **SVG** with a square
  `viewBox`. PNG should be 24/32-bit.
- **Opaque and full-bleed**: the background color must reach all four
  edges. No transparency, no transparent margin, and no rounded corners
  baked in — the OS and Google round/crop the edges themselves.
- **Safe zone**: keep the logo and any important detail within the
  centre ~80% (about 10% margin on every side). Android and iOS crop the
  outer edge of the maskable icon into a circle or squircle, so let the
  background bleed to the edges while the mark stays centered.

In short: a solid-background square where the artwork is comfortably
inside the middle, exported opaque at 1024x1024.

## After adding a tile

```bash
npm run favicons:generate
npm run favicons:preview
```
