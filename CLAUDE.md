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
npm start -- --compare reports/<old>.json  # capture fresh + diff vs old
npm start -- --compare <old>.json <new>.json  # diff two files, no fetching
npm test                                   # vitest
npm run lint && npm run type-check         # checks
```

## Conventions

- No emojis in logging or output. Plain `[INFO]` / `[ERROR]` prefixes.
- Never rely on visual judgment of an icon; classify by decoded pixels.
- Domains live in `src/config.ts`.
