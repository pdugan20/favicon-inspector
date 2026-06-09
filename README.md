# favicon-inspector

[![CI](https://github.com/pdugan20/favicon-inspector/actions/workflows/ci.yml/badge.svg)](https://github.com/pdugan20/favicon-inspector/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?logo=opensourceinitiative&logoColor=white)](LICENSE)

Inspect what Google's favicon services serve and cache for a set of domains, and catch the case where a transparent icon gets flattened onto black.

## Why it exists

Claude clients resolve MCP connector icons through Google's favicon services (`faviconV2` and the legacy `s2/favicons`), not the MCP `icons[]` array. A transparent source icon can get flattened onto black and re-encoded as JPEG at certain sizes — producing a black-square connector icon. Google caches these per domain and size and refreshes on its own schedule, so the only way to know the current state is to ask Google directly. This tool does that, decodes every response, and tells you which cells are wrong.

## How it works

For each configured domain it probes the full matrix of Google favicon endpoints and sizes, plus the domain's own origin assets (well-known paths, HTML `<link>` icons, and manifest icons). Every returned image is decoded with pure-JS `fast-png` / `jpeg-js` and classified by:

- **format** — PNG, JPEG, ICO, or SVG
- **transparency** — whether the image carries an alpha channel
- **background** — the corner pixels: transparent, white, black, or another color
- **verdict** — `OK`, `WARN`, or `ALERT`, where `ALERT` flags the exact failure: a JPEG flattened onto a black background

Results are written as a self-contained HTML report (icons inlined as base64, on a checkerboard so transparency is unmistakable) plus a JSON sibling, timestamped under `reports/`.

## Prerequisites

- Node 22 (`nvm use`)

## Install

```bash
npm install
```

## Usage

```bash
npm start                                       # capture snapshot -> reports/
npm start -- --compare reports/<older>.json     # capture fresh, diff vs older
npm start -- --compare <a>.json <b>.json        # diff two snapshots offline
```

Open the generated `reports/report-<timestamp>.html` in any browser. Each cell shows the actual icon Google returns alongside its diagnosis and verdict.

## Output

- `reports/report-<timestamp>.html` — the visual grid, self-contained
- `reports/report-<timestamp>.json` — the structured results, and the input to `--compare`
- `reports/diff-<timestamp>.{html,json}` — only the cells whose format, background, or verdict changed between two snapshots

Compare mode is how you watch a cache refresh land: when a domain's 48px/64px cell flips from `jpeg`/black/`ALERT` to a transparent PNG, Google has re-crawled and the black square is gone.

## Configuration

Edit `src/config.ts` to change the domain list, sizes, or per-domain `expected: 'transparent' | 'opaque'` (suppresses black-background alerts for domains whose icon is legitimately an opaque tile).

## Scripts

```bash
npm test            # vitest
npm run lint        # eslint
npm run type-check  # tsc --noEmit
npm run format      # prettier --write
npm run build       # tsc -> dist/
```

## License

MIT — see [LICENSE](LICENSE).
