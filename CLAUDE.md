# favicon-inspector

A standalone Node + TypeScript CLI that inspects what Google's favicon services
(`faviconV2` and legacy `s2/favicons`) serve and cache for a configured set of
domains, alongside each domain's own origin favicon assets. It decodes every
returned image with pure-JS `fast-png` / `jpeg-js`, classifies format,
transparency, and background color, and emits a self-contained HTML + JSON
report. A compare mode diffs two JSON snapshots.

## Why it exists

Claude clients resolve MCP connector icons through Google's favicon service, not
the MCP `icons[]` array. Transparent source icons can be flattened onto black
and re-encoded as JPEG at certain sizes, producing a black square. This tool
shows what Google is actually caching, per domain and size, so the cache state
is observable instead of guessed.

## Commands

```bash
npm start                                  # capture a snapshot, write reports/
npm start -- --compare latest              # capture fresh + diff vs previous run
npm start -- --compare <old>.json <new>.json  # diff two files, no fetching
npm start -- --help                        # full flag reference
npm test                                   # vitest
npm run lint && npm run type-check         # checks
npm run build && node dist/index.js -h     # compiled bin (npm exposes it as favicon-inspector)
```

Other flags: `--domains a.com,b.com` (override the configured list),
`--fail-on warn|alert` (exit 2 when met, for CI/cron), `--out <dir>`.
Flag parsing lives in `src/cli.ts`; unknown flags are rejected. Every
capture also updates `latest.json` / `latest.html` pointers in the
output dir, and `.github/workflows/favicon-monitor.yml` runs a daily
`--fail-on alert` capture.

## Conventions

- No emojis in logging or output. Plain `[INFO]` / `[ERROR]` prefixes.
- Never rely on visual judgment of an icon; classify by decoded pixels.
- Domains live in `src/config.ts`.
- Relative imports use explicit `.js` extensions (NodeNext ESM) so the
  compiled `dist/` runs under plain Node.
