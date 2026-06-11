# favicon-inspector

[![CI](https://github.com/pdugan20/favicon-inspector/actions/workflows/ci.yml/badge.svg)](https://github.com/pdugan20/favicon-inspector/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?logo=opensourceinitiative&logoColor=white)](https://opensource.org/licenses/MIT)

Inspect what Google's favicon services serve and cache for a set of domains, and flag the icons that come back wrong.

## Install

```bash
npm install        # run from the repo via npm start
npm install -g .   # expose the favicon-inspector bin
```

## Usage

```bash
npm start                            # capture a snapshot
npm start -- --compare latest        # capture, then diff against the previous run
npm start -- --fail-on alert         # exit 2 if any icon alerts (for CI/cron)
```

Each run writes a timestamped HTML report and JSON sibling to the output directory, updates the `latest.html` / `latest.json` pointers, and grades every icon OK / WARN / ALERT. Compare mode reports only the cells whose verdict changed.

```text
Usage: favicon-inspector [options]

Captures what Google's favicon services serve for the configured domains and
writes an HTML + JSON report. With --compare, diffs snapshots instead.

Options:
  --compare <file> [<file>]  Diff snapshot JSONs. With one path, captures a
                             fresh snapshot first. 'latest' is shorthand for
                             the latest.json pointer in the output dir.
  --domains <list>           Comma-separated domains to inspect instead of the
                             config file, e.g. a.com,b.com.
  --fail-on <level>          'warn' or 'alert'. Exit 2 if any cell is at or
                             above this verdict. For CI and cron monitoring.
  --out <dir>                Output directory (default: reports).
  -h, --help                 Show this help.
  -v, --version              Show version.

Configuration:
  Without --domains, domains come from favicon-inspector.config.json in the
  working directory:
    {"domains": ["a.com", {"domain": "b.com", "expected": "opaque"}]}
  Set expected to 'opaque' for domains whose icon is legitimately a solid
  tile; it suppresses black-background alerts.

Exit codes:
  0  success
  1  fatal error (bad flags, missing domains, unreadable snapshot, crash)
  2  --fail-on threshold met
```

## Generating corrected favicons

When the inspector flags a domain, `npm run favicons:generate` builds a
Google-correct favicon set for each configured domain. Tab icons come
from a transparent master (non-square sources letterboxed, never
stretched). The `apple-touch-icon` and maskable icon come from an opaque,
full-bleed tile you drop in `scripts/masters/<domain>.tile.png` (see
`scripts/masters/README.md` for the format) so they render edge-to-edge
and can never be flattened to a black square; domains without a tile skip
those two slots. Output lands in `generated/<domain>/` with a `head.html`
link snippet to deploy.
`npm run favicons:preview` then builds a self-contained gallery at
`generated/preview.html` to eyeball every icon on transparent and white
backgrounds. The rationale and citations are in `docs/favicon-findings.md`,
and per-platform deploy steps (Mintlify, Next.js, static) are in
`docs/favicon-deploy.md`.

## Monitoring

`.github/workflows/favicon-monitor.yml` captures a snapshot with `--fail-on alert` when dispatched from the Actions tab, so a degraded icon shows up as a failed run. Reports from each run are kept as workflow artifacts for 30 days.

## Configuration

The domain list lives in `favicon-inspector.config.json` (shape shown in the help text above). Sizes, endpoints, and fetch limits live in `src/config.ts`.
