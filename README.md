# favicon-inspector

[![CI](https://github.com/pdugan20/favicon-inspector/actions/workflows/ci.yml/badge.svg?branch=main&event=push)](https://github.com/pdugan20/favicon-inspector/actions/workflows/ci.yml)
[![License](https://img.shields.io/github/license/pdugan20/favicon-inspector)](LICENSE)

Inspect what Google's favicon services serve and cache for a set of domains, and flag the icons that come back wrong.

## Quick start

Requires Node.js 22+.

```bash
git clone https://github.com/pdugan20/favicon-inspector.git
cd favicon-inspector
npm install
npm start
```

Each run writes timestamped HTML and JSON reports to `reports/`, updates `latest.html` and `latest.json`, and grades every icon `OK`, `WARN`, or `ALERT`.

## Common commands

```bash
npm start                            # capture a snapshot
npm start -- --compare latest        # capture, then diff against the previous run
npm start -- --domains a.com,b.com   # override the configured domains
npm start -- --fail-on alert         # exit 2 if any icon alerts (for CI/cron)
npm start -- --help                  # show all options and exit codes
```

## Configuration

Domains come from [`favicon-inspector.config.json`](favicon-inspector.config.json). Set `expected` to `opaque` when a domain legitimately uses a solid tile; this suppresses black-background alerts. Sizes, endpoints, and fetch limits live in [`src/config.ts`](src/config.ts).

## Network and image limits

Captures accept credential-free public HTTP(S) destinations only. DNS results are checked
and pinned for each connection and redirect; local/private and special-use addresses are
rejected. Each resource has one 10-second deadline, at most five redirects, and a 4 MiB
body cap (2 MiB for HTML/manifests). Compressed HTTP responses and HTTPS downgrade
redirects are rejected. Origin discovery adds at most 32 icons beyond the four well-known
paths. Images exceeding four million pixels or decoder limits remain undecoded; PNG
compressed metadata is not processed. Hashing accepts recognized PNG/JPEG/ICO and resource-free UTF-8 SVG; unknown encodings are not passed to native auto-detection. SVG hashing supports resource-free vectors; embedded raster/font resources, external references, entities, and escaped CSS are rejected. A rejected resource appears as a failed fetch or
undecoded image instead of terminating the capture.

## Generating corrected favicons

`npm run favicons:generate` builds favicon sets designed to avoid the known Google rendering failures. Output lands in `generated/<domain>/`; optional opaque tile assets add full-bleed `apple-touch-icon` and maskable outputs. See the [master asset requirements](scripts/masters/README.md), [favicon findings](docs/favicon-findings.md), and [deployment guide](docs/favicon-deploy.md).

Run `npm run favicons:preview` to build a self-contained gallery at `generated/preview.html`.

## Development

The synthetic TLS regression fixtures require `openssl` on PATH; they generate temporary test-only keys and remove them after the tests.

```bash
npm test                # run the test suite
npm run lint            # run ESLint
npm run type-check      # type-check without emitting
npm run build           # compile the CLI to dist/
```

The manual [favicon monitor workflow](.github/workflows/favicon-monitor.yml) captures a snapshot with `--fail-on alert` and retains its reports as workflow artifacts for 30 days.
