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
npm start                            # capture a snapshot
npm start -- --compare latest        # capture, then diff against the previous run
npm start -- --fail-on alert         # exit 2 if any icon alerts (for CI/cron)
npm start -- --help                  # all flags
```

Every run writes `report-<timestamp>.html` and `.json` to `reports/`, updates the `latest.html` / `latest.json` pointers, and grades each icon `OK` / `WARN` / `ALERT`. Compare mode reports only the cells whose verdict changed; pass two paths to diff saved snapshots without fetching.

| Flag                          | Effect                                                                                 |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| `--compare <file> [<file>]`   | Diff snapshot JSONs. One path captures fresh first; `latest` means the previous run.   |
| `--domains <list>`            | Comma-separated domains to inspect instead of the configured list, e.g. `a.com,b.com`. |
| `--fail-on <level>`           | `warn` or `alert`. Exit with code 2 if any cell is at or above this verdict.           |
| `--out <dir>`                 | Output directory (default `reports`).                                                  |
| `-h, --help`, `-v, --version` | Help and version.                                                                      |

Installed as a package (`npm install -g .`, or `npx favicon-inspector` once published), the same flags work directly: `favicon-inspector --fail-on alert`.

## Monitoring

`.github/workflows/favicon-monitor.yml` captures a snapshot with `--fail-on alert` when dispatched from the Actions tab, so a degraded icon shows up as a failed run. Reports from each run are kept as workflow artifacts for 30 days.

## Configuration

Edit `src/config.ts` to change the domain list, sizes, or per-domain `expected: 'transparent' | 'opaque'` (suppresses black-background alerts for domains whose icon is legitimately an opaque tile).
