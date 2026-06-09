# favicon-inspector — Design

Status: approved design, pre-implementation
Date: 2026-06-09

## Problem

Claude's mobile/desktop clients render MCP connector icons by resolving the
server's `websiteUrl` through Google's favicon services (`faviconV2` and the
legacy `s2/favicons`), not through the MCP `icons[]` array. Those services
crawl a site's favicons on their own schedule and cache results per
`(domain, size)`. When the source favicon is transparent, Google may flatten
it onto a black background and re-encode as JPEG at certain sizes (observed at
48px and 64px for `rewind.rest`), producing a black square in the client.

There is no existing tool that shows **what Google is actually serving/caching
right now**, across sizes and endpoints, for a chosen set of domains. Origin
config checkers exist (e.g. realfavicongenerator.net), but they inspect the
site's declared favicon setup, not Google's live cache — which is the thing
that actually drives the client icon.

A prior debugging session was misled by **eyeballing** a rendered thumbnail
(it looked light-backgrounded but corner pixels measured near-black). The tool
must therefore analyze pixels programmatically, never rely on visual judgment.

## Goal

A one-shot, re-runnable diagnostic that, for a configured set of domains:

1. Probes Google's favicon services across endpoints and sizes.
2. Probes each domain's origin favicon assets (source of truth).
3. Decodes every returned image server-side and classifies format,
   transparency, and background color.
4. Emits a self-contained HTML report (icons inlined as base64) plus a JSON
   sibling, timestamped, so repeated runs let the user watch Google's cache
   change over time.
5. Diffs two JSON snapshots to highlight cells that changed (e.g. a size
   flipping from JPEG/black to PNG/transparent).

Non-goals (v1): hosting/live dashboard, scheduled monitoring/alerting,
re-implementing origin config validation that realfavicongenerator already
does well (we do a lightweight origin probe only, to compare against Google's
output).

## Domains (initial config)

- rewind.rest
- getbiblio.app
- next-up.app
- patdugan.me
- clickwheel.fm

Domains live in `src/config.ts`; adding one is a one-line edit. Each domain may
optionally declare `expected: 'transparent' | 'opaque'` to tune the verdict.

## Architecture

Standalone Node + TypeScript CLI, its own repo. No server, no deployment.
Image decoding via `sharp` (native module — noted as an install prerequisite in
the README). `sharp` reliably decodes the PNG/JPEG that Google returns; ICO and
SVG origin assets are reported by status/content-type and a lightweight
alpha-sniff rather than full decode.

### The probe matrix

Per domain, the cartesian product of:

- **Google endpoints**: `faviconV2` (modern, what Claude uses) and legacy
  `s2/favicons`. Both are probed because they can disagree.
  - faviconV2: `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://<domain>&size=<sz>`
  - s2: `https://www.google.com/s2/favicons?domain=<domain>&sz=<sz>`
- **Sizes**: `16, 32, 48, 64, 96, 128, 256`. (48 and 64 are the
  Claude-mobile-critical sizes.)
- **Origin assets** (fetched once per domain, not per size):
  `/favicon.ico`, `/favicon.svg`, `/apple-touch-icon.png`,
  `/apple-touch-icon-precomposed.png`, plus icons declared in the homepage HTML
  `<link rel="icon"|"apple-touch-icon">` and in `manifest.json`
  (`android-chrome` etc.).

Scale: ~5 domains × 2 endpoints × 7 sizes = ~70 Google cells + ~5 origin
checks each. Concurrency-limited fetch; completes in seconds.

### Per-cell analysis

For each fetched image:

- HTTP status and `content-type`
- **format** sniffed from magic bytes (PNG / JPEG / ICO / SVG) — the JPEG tell
- pixel dimensions and **hasAlpha**
- **corner background classification**: sample the 4 corner pixels and reduce to
  one of `TRANSPARENT`, `OPAQUE-WHITE`, `OPAQUE-BLACK`, `OPAQUE-OTHER(#hex)`.
  A corner counts as black if RGB are all below a small threshold (~16) and
  alpha is opaque; transparent if alpha is ~0.
- **verdict**:
  - `ALERT` — format=JPEG and bg=OPAQUE-BLACK (the exact observed failure)
  - `WARN` — format=JPEG (any other bg) — JPEG implies forced flattening
  - `OK` — otherwise
  - When a domain declares `expected: 'opaque'`, an opaque black/white bg is not
    flagged (e.g. a brand whose icon is legitimately a dark tile).

Classification, not hard pass/fail: some brands legitimately ship opaque tiles
(observed: Vercel returns opaque black PNG and is fine).

### Output

Written to `reports/` (gitignored), timestamped:

- `report-<ISO timestamp>.html` — self-contained:
  - Top: per-domain **origin panel** — what each site actually serves
    (status, content-type, transparency) for ico/svg/apple-touch/manifest.
  - Main: a **grid**, rows = sizes, columns grouped by domain × endpoint. Each
    cell renders the actual icon on a checkerboard backdrop (so transparency is
    visually unmistakable) with the diagnosis beneath
    (`format · alpha · bg · verdict`), color-coded by verdict.
  - Header: capture timestamp and the run's config.
  - All icons inlined as base64 data-URIs → no CORS tainting, renders offline
    forever.
- `report-<ISO timestamp>.json` — the full structured result set, the input to
  `--compare`.

Timestamps are derived from the process start time captured once at entry.

### Compare mode (v1)

`favicon-inspector --compare reports/<older>.json [reports/<newer>.json]`

- With one path: compares that snapshot against a freshly captured run.
- With two paths: compares the two files offline (no fetching).
- Output: a diff report (HTML + JSON) listing only cells whose
  `(format, bg, verdict)` changed, rendered old → new side by side. This is the
  direct answer to "has Google's cache refreshed yet?".

## Repo layout

```text
favicon-inspector/
  src/
    config.ts      # domains[] + optional expected per domain; sizes; endpoints
    endpoints.ts   # builds faviconV2 / s2 URLs from (domain, size)
    fetch.ts       # concurrency-limited fetcher, returns {status, contentType, bytes}
    analyze.ts     # sharp decode -> {format, dims, hasAlpha, cornerClass, verdict}
    origin.ts      # origin asset + homepage <link> + manifest probing
    report.ts      # HTML + JSON emitters (snapshot and diff)
    compare.ts     # snapshot diffing
    index.ts       # CLI entry / arg parsing
  reports/         # gitignored output
  package.json
  tsconfig.json
  README.md        # usage; notes sharp native-module prerequisite
```

## Testing

- Unit tests for `analyze.ts` corner-classification against fixture images
  (known transparent PNG, opaque-black JPEG, opaque-white PNG).
- Unit test for `compare.ts` diff logic on two synthetic JSON snapshots.
- Unit test for `endpoints.ts` URL construction.
- Network fetching is not unit-tested against live Google; `fetch.ts` is kept
  thin and injectable so analysis/report logic is tested on fixtures.

## Error handling

- A failed fetch (timeout, non-200) is recorded as a cell with its status and no
  image; it does not abort the run.
- An image `sharp` cannot decode (e.g. multi-image ICO) is recorded with format
  sniffed from magic bytes and `cornerClass: 'UNDECODED'`, verdict `OK` (not an
  alert) — origin ICOs are informational.
- Concurrency is bounded so a slow domain cannot stall the whole run.
