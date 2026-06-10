# favicon-inspector

[![CI](https://github.com/pdugan20/favicon-inspector/actions/workflows/ci.yml/badge.svg)](https://github.com/pdugan20/favicon-inspector/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?logo=opensourceinitiative&logoColor=white)](https://opensource.org/licenses/MIT)

Inspect what Google's favicon services serve and cache for a set of domains, and flag the icons that come back wrong.

## Install

```bash
npm install
```

## Usage

```bash
npm start                                       # capture snapshot -> reports/
npm start -- --compare reports/<older>.json     # capture fresh, diff vs older
npm start -- --compare <a>.json <b>.json        # diff two snapshots offline
npm start -- --help                             # full flag reference
```

`npm start` writes a timestamped HTML report and JSON sibling to `reports/`, grading each icon `OK` / `WARN` / `ALERT`. Compare mode diffs two snapshots and reports only the cells that changed.

### Flags

| Flag                                   | Effect                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------- |
| `--compare <before.json> [after.json]` | Diff snapshots. With one path, captures a fresh snapshot first.                 |
| `--domains <a.com,b.com>`              | Inspect these domains instead of the configured list.                           |
| `--fail-on <warn\|alert>`              | Exit with code 2 if any cell is at or above this verdict. For CI/cron canaries. |
| `--out <dir>`                          | Output directory (default `reports`).                                           |
| `-h, --help` / `-v, --version`         | Help and version.                                                               |

### As a binary

`npm run build` compiles to `dist/`, and the package exposes a `favicon-inspector` bin:

```bash
npm run build
node dist/index.js --domains example.com --fail-on alert
```

## Configuration

Edit `src/config.ts` to change the domain list, sizes, or per-domain `expected: 'transparent' | 'opaque'` (suppresses black-background alerts for domains whose icon is legitimately an opaque tile).
