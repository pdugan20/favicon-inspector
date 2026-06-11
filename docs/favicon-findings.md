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

## The black-square cause and fix (high confidence)

The core defense against transparent icons being flattened onto black
and re-encoded as JPEG:

- Keep **tab icons** (`favicon.ico`, `favicon.svg`, small PNGs)
  **transparent**.
- Make the **`apple-touch-icon` and the 512px maskable PWA icon
  OPAQUE**, with a filled background and padding.

A transparent `apple-touch-icon` renders as a **black square** because
the consuming OS/pipeline fills empty pixels with black. Maskable icons
must be filled per Google's [web.dev maskable-icon guidance][maskable]
(use an ~80% safe zone for padding).

## Recommended minimal set (high confidence)

The 2024-2026 consensus ([Evil Martians][evilmartians]), all built from
a single large square master:

| File                           | Size                               | Opacity                     |
| ------------------------------ | ---------------------------------- | --------------------------- |
| `favicon.ico`                  | 32x32 (opt. 16/32/48 frames)       | transparent                 |
| `favicon.svg`                  | vector, light/dark via media query | transparent                 |
| `favicon-96x96.png`            | 96x96                              | transparent                 |
| `apple-touch-icon.png`         | 180x180                            | **opaque + padding**        |
| `web-app-manifest-192x192.png` | 192x192                            | transparent ok              |
| `web-app-manifest-512x512.png` | 512x512 maskable                   | **opaque + ~80% safe zone** |

A large **square** master is the single most important input: it fixes
both the upscaling blur and the aspect-ratio stretch seen when Google
has only a small or non-square source.

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

## How this maps to the monitored domains

- **rewind.rest** (s2 48/64 black square): origin serves transparent
  PNGs and has no opaque `apple-touch-icon` (it 404s). Fix: add an
  opaque, padded 180x180 `apple-touch-icon` plus an opaque maskable 512.
- **getbiblio.app** (distortion at >=96px): the largest master is a
  non-square 65x81 SVG, which violates Google's square requirement. Fix:
  add a 512x512 square master.
- **next-up.app** (stale design cached): origin already serves a clean
  512x512 transparent `icon.png`; the issue is Google's stale cache,
  which is not fixable from the origin. Keep the URL stable and wait.

Common root cause: all three lack a large, square, opacity-correct
raster master. One generated set fixes the two real bugs.

[google-favicon]: https://developers.google.com/search/docs/appearance/favicon-in-search
[seroundtable]: https://www.seroundtable.com/google-favicon-user-agent-36234.html
[maskable]: https://web.dev/articles/maskable-icon
[evilmartians]: https://evilmartians.com/chronicles/how-to-favicon-in-2021-six-files-that-fit-most-needs
[favicons-npm]: https://github.com/itgalaxy/favicons
[rfg-npm]: https://www.npmjs.com/package/@realfavicongenerator/generate-favicon
