# favicon-inspector

Inspect what Google's favicon services serve and cache for a set of domains.

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

Open the generated `reports/report-<timestamp>.html` in any browser. Each cell
shows the actual icon Google returns (on a checkerboard so transparency is
visible) with a diagnosis: format, alpha, background class, and a verdict
(`OK` / `WARN` / `ALERT`). `ALERT` flags the known failure: a JPEG flattened
onto a black background.

## Configuration

Edit `src/config.ts` to change the domain list, sizes, or per-domain
`expected: 'transparent' | 'opaque'` (suppresses black-background alerts for
domains whose icon is legitimately an opaque tile).
