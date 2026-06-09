# favicon-inspector

[![CI](https://github.com/pdugan20/favicon-inspector/actions/workflows/ci.yml/badge.svg)](https://github.com/pdugan20/favicon-inspector/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?logo=opensourceinitiative&logoColor=white)](https://opensource.org/licenses/MIT)

Inspect what Google's favicon services serve and cache for a set of domains. Claude and other clients resolve connector icons through Google's favicon service, which can flatten a transparent icon onto black and re-encode it as a JPEG at certain sizes — surfacing as a black square. This probes every Google endpoint and size for each domain (plus the domain's own favicon assets), decodes each image with pure-JS `fast-png` / `jpeg-js`, and flags the ones that are wrong.

## Install

```bash
npm install
```

Requires Node 22 (`nvm use`).

## Usage

```bash
npm start                                       # capture snapshot -> reports/
npm start -- --compare reports/<older>.json     # capture fresh, diff vs older
npm start -- --compare <a>.json <b>.json        # diff two snapshots offline
```

`npm start` writes a self-contained `reports/report-<timestamp>.html` — icons on a checkerboard so transparency is obvious — plus a JSON sibling. Each cell shows the icon Google returns with its format, transparency, background, and a verdict: `OK`, `WARN`, or `ALERT`, where `ALERT` is the black-JPEG failure. Compare mode diffs two snapshots and reports only the cells that changed, so you can catch the moment a cache refresh lands.

## Configuration

Edit `src/config.ts` to change the domain list, sizes, or per-domain `expected: 'transparent' | 'opaque'` (suppresses black-background alerts for domains whose icon is legitimately an opaque tile).
