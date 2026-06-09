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
Image decoding via **pure-JS `fast-png` + `jpeg-js`** — matching the rewind
stack, no native compile step, clean CI. `fast-png` decodes PNG to raw RGBA
(with alpha); `jpeg-js` decodes JPEG to raw RGBA. Those two cover every format
Google returns. ICO and SVG origin assets are reported by status/content-type
and a lightweight alpha-sniff rather than full decode (they are informational,
not the focus). Format is sniffed from magic bytes before decode, so an
unexpected type is classified rather than crashing the decoder.

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

For each fetched image, after sniffing format from magic bytes and decoding
PNG via `fast-png` / JPEG via `jpeg-js`:

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
    analyze.ts     # fast-png/jpeg-js decode -> {format, dims, hasAlpha, cornerClass, verdict}
    origin.ts      # origin asset + homepage <link> + manifest probing
    report.ts      # HTML + JSON emitters (snapshot and diff)
    compare.ts     # snapshot diffing
    index.ts       # CLI entry / arg parsing
  src/__tests__/   # vitest unit tests + image fixtures
  reports/         # gitignored output
  .github/
    workflows/{ci.yml, pr-lint.yml}
    dependabot.yml
  .husky/{pre-commit, pre-push}
  eslint.config.ts
  .prettierrc, .prettierignore
  tsconfig.json
  vitest.config.ts
  .editorconfig, .nvmrc, .gitignore
  package.json
  CLAUDE.md        # brief project instructions
  README.md        # usage + conventions
```

## Tooling & scaffolding

Mirrors the rewind repo's conventions, adapted from a Cloudflare Worker to a
plain Node CLI (so wrangler / Drizzle / OpenAPI / workers-types are dropped).

- **Node**: `.nvmrc` = `22`. ESM (`"type": "module"`).
- **TypeScript**: strict `tsconfig.json` matching rewind
  (`strict`, `noUnusedLocals`, `noUnusedParameters`,
  `noFallthroughCasesInSwitch`, `isolatedModules`, `resolveJsonModule`),
  retargeted with `types: ["node"]`, no jsx/hono/workers-types. Run via `tsx`;
  `build` is `tsc` to `dist/`.
- **ESLint**: flat `eslint.config.ts` = `@eslint/js` recommended +
  `typescript-eslint` recommended + `eslint-config-prettier`, plus the
  `no-unused-vars` rule with `^_` ignore pattern. (No drizzle plugin.)
- **Prettier**: `.prettierrc` identical to rewind (semi, `es5` trailing comma,
  single quotes, printWidth 80, tabWidth 2, lf). `.prettierignore` adds
  `reports/`.
- **EditorConfig**: identical to rewind.
- **Husky + lint-staged**: `pre-commit` runs `lint-staged`
  (eslint --fix + prettier on staged JS/TS; prettier on json/md/yml);
  `pre-push` runs `type-check && lint && test`. `prepare: husky`.
- **npm scripts**: `dev` (tsx watch), `start` (tsx src/index.ts), `build`
  (tsc), `lint`, `lint:fix`, `format`, `format:check`, `type-check`, `test`,
  `test:watch`, `lint:deps` (knip, informational).
- **CI** (`.github/workflows/ci.yml`): jobs `lint`
  (eslint + `format:check` + `type-check`), `test` (vitest), `build` (tsc),
  `security` (`npm audit --audit-level=moderate --omit=dev`,
  `continue-on-error`), `dependency-review` (PRs only). Same
  `actions/checkout@v6` + `actions/setup-node@v6` Node 22 + npm-cache pattern.
  `concurrency` cancel-in-progress as in rewind.
- **PR title lint** (`.github/workflows/pr-lint.yml`): verbatim from rewind
  (`amannn/action-semantic-pull-request@v6`, lowercase subject).
- **Dependabot** (`.github/dependabot.yml`): npm + github-actions, weekly
  Monday; `eslint` and `vitest` groups (cloudflare/drizzle groups dropped).
- **Vitest**: plain `vitest.config.ts` (not the workers pool); Node
  environment; tests in `src/__tests__/`.

### Deliberately omitted

- **release-please** — rewind uses it for versioned npm publishing of
  `mcp-server`; favicon-inspector is a personal, unpublished tool, so release
  automation is out of scope for v1. Trivial to add later if it is ever
  published.
- **claude-code-lint CI gate** — a brief `CLAUDE.md` is included for context,
  but the `lint:claude` CI step is omitted since the repo carries no
  `.claude/` automation to validate.
- Cloudflare/Drizzle/OpenAPI/Mintlify tooling — not applicable to a CLI.

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
- An image the decoders do not handle (e.g. multi-image ICO, SVG) is recorded
  with format sniffed from magic bytes and `cornerClass: 'UNDECODED'`, verdict
  `OK` (not an alert) — origin ICOs/SVGs are informational.
- Concurrency is bounded so a slow domain cannot stall the whole run.
