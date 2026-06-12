# Favicon findings for Google's favicon service

Research notes on how to generate and serve favicon assets so Google's
favicon services (`faviconV2` on `gstatic.com` and the legacy
`s2/favicons` on `www.google.com`) crawl, cache, and serve a correct,
high-resolution, undistorted icon. This matters because Claude clients
resolve MCP connector icons through Google's favicon service, so the
icon Google caches is what users actually see.

Confidence is noted per claim. Google's two favicon endpoints are
officially **undocumented**; endpoint and parameter details come from
live testing plus Chromium source and are observational, not
contractual.

## What Google documents (high confidence, primary source)

From [Google Search Central][google-favicon] (verified verbatim,
last updated 2026-02-04):

- The favicon must be **square (1:1)**, at least 8x8px; Google
  recommends **larger than 48x48px** so it scales across surfaces.
- **Any valid favicon format** is supported.
- Google reads `rel="icon"`, `rel="shortcut icon"`,
  `rel="apple-touch-icon"`, and `rel="apple-touch-icon-precomposed"`.
- **One favicon per hostname**, and the **URL must be stable** — do
  not change the path frequently.
- The favicon must be crawlable by `Googlebot-Image` and the home page
  by `Googlebot`; neither can be blocked in robots.txt. The dedicated
  "Google Favicon" user-agent was [removed in Oct 2023][seroundtable];
  crawling now rides on the standard Googlebot tokens.

Refuted myths (each killed 3-0 in verification):

- A favicon does **not** need dimensions that are a multiple of 48px.
- `faviconV2` is **not** limited to 16/32px; it does serve large sizes.

## The endpoints (medium confidence, undocumented)

- `faviconV2` resolves to `t0/t1/t3.gstatic.com/faviconV2` and takes
  `url`, `size`, `client`, `type`, and `fallback_opts`. A typical
  third-party request:

  ```text
  https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=<domain>&size=<px>
  ```

- The legacy `s2/favicons` endpoint now **301-redirects into
  `faviconV2`** — same backend. The `www.` host is required.
- `fallback_opts=TYPE,SIZE,URL` controls fallback across icon type and
  size. Confirmed against Chromium's `large_icon_service.cc`.

## The black-square cause and fix (verified in production)

The black square comes from one specific thing: a **served, transparent
`apple-touch-icon`**. Google's favicon service reads it, flattens the
transparent pixels onto black, and re-encodes a JPEG at 48/64px.

The fix we verified on these domains:

- Serve a **transparent, square `favicon.svg` + `favicon.ico`**.
- **Do not serve an apple-touch-icon at all** — 404 it. A _missing_
  apple-touch is the correct state; Google falls back to the transparent
  favicon and it stays transparent at every size.
- Make sure the apex page Google crawls advertises **only** that
  transparent favicon (no apple-touch `<link>`). If the apex redirects to
  a docs host that injects a transparent apple-touch (e.g. Mintlify),
  Google picks that up — serve a self-contained apex instead.

**Proof:** getbiblio.app serves a transparent favicon with the
apple-touch 404'd and renders correctly (never black) — its only defect
was a non-square favicon causing distortion. rewind.rest went black only
because its apex redirected to a Mintlify page that advertised a
transparent apple-touch.

A large **square** master is the other half: it fixes the upscaling blur
and aspect-ratio stretch when Google has only a small or non-square
source. This is independent of the black-square issue.

### When you can't drop the apple-touch (opaque fallback)

Some hosts (Mintlify) auto-generate a transparent apple-touch you can't 404. There the only fix is to make the **source image opaque and square**
so the generated apple-touch is opaque (it can't flatten to black) — at
the cost of the icon no longer being transparent. Prefer the
transparent + no-apple-touch approach wherever you control the server.

## Recommended minimal set

Built from a single large **square** master:

| File          | Size                         | Opacity / notes      |
| ------------- | ---------------------------- | -------------------- |
| `favicon.ico` | 32x32 (opt. 16/32/48 frames) | transparent, square  |
| `favicon.svg` | vector, square viewBox       | transparent          |
| apple-touch   | —                            | **not served (404)** |

If a host forces an apple-touch (Mintlify), make the favicon source
**opaque + square** so the generated apple-touch is opaque, not
transparent. The [`favicons`][favicons-npm] generator and the
[Evil Martians][evilmartians] set remain useful for that opaque path and
for full PWA/maskable coverage when a site genuinely needs installable
icons.

## Generator tooling (high confidence, primary sources)

Both generate the full set from one source image and fit a Node/TS
pipeline:

- [`favicons` (itgalaxy/favicons)][favicons-npm] — single source to a
  full multi-platform set, and exposes a **`background` option** to
  flatten icons onto an opaque color (default `#fff`, not black). The
  direct programmatic lever against the black-square problem.
- [`@realfavicongenerator/generate-favicon`][rfg-npm] — produces
  exactly the modern set above plus matching HTML link tags; mirrors
  the RealFaviconGenerator web tool.

## Caching (high confidence on the caveat)

- Google caches favicons aggressively; a refresh takes **"several days
  to several weeks"** per Google's crawl-cadence language.
- **No documented public force-refresh mechanism.** The claimed
  "30-day Cache-Control max-age" was refuted 0-3 — the real CDN TTL is
  not established.
- The only lever is keeping the favicon **URL stable** so a re-crawl
  picks up new bytes at the same path.

## Open questions (not resolved by research)

These are empirically answerable with `favicon-inspector` itself:

- `faviconV2`'s source-selection priority order and true maximum ingest
  resolution.
- The precise sizes/conditions that trigger black-flatten, and whether
  an opaque 512 master fully eliminates it at every size.
- Any reliable way to force or accelerate a cache refresh.
- Whether `faviconV2` uses SVG directly or always rasterizes, and how
  it picks a raster size from SVG for large requests.

## How this was fixed on the monitored domains

All controlled-server fixes followed the same pattern: self-contained
apex, transparent **square** favicon, apple-touch 404'd.

- **getbiblio.app** (distortion, not black): server.py already served a
  transparent favicon with apple-touch 404'd; the `favicon.svg` was a
  non-square 65x81. Fixed by squaring the SVG (81x81).
- **rewind.rest** (black square): the apex worker 404'd apple-touch but
  302-redirected `/` to the Mintlify docs, which advertised a transparent
  apple-touch Google flattened to black. Fixed by serving a
  self-contained landing page at the apex (transparent favicon only, no
  apple-touch) and squaring the favicon (23x17 -> 23x23).
- **clickwheel.fm** (black square): had no apex layer — a Cloudflare
  Redirect Rule sent everything to the Mintlify docs. Fixed by adding an
  apex worker (same pattern as rewind) and removing the redirect rule.
- **next-up.app** (stale design cached): origin already serves a clean
  512x512 transparent `icon.png`; not black. The cached old design is
  Google's stale cache, not an origin defect. Keep the URL stable, wait.

After any origin fix, Google's cached cells stay stale for days to weeks
until re-crawl; re-run `favicon-inspector` to watch them flip.

[google-favicon]: https://developers.google.com/search/docs/appearance/favicon-in-search
[seroundtable]: https://www.seroundtable.com/google-favicon-user-agent-36234.html
[evilmartians]: https://evilmartians.com/chronicles/how-to-favicon-in-2021-six-files-that-fit-most-needs
[favicons-npm]: https://github.com/itgalaxy/favicons
[rfg-npm]: https://www.npmjs.com/package/@realfavicongenerator/generate-favicon
