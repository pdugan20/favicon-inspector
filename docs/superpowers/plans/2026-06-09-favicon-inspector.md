# favicon-inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone Node + TypeScript CLI that probes Google's favicon services and each domain's origin assets, decodes and classifies every returned image, and emits a self-contained HTML + JSON report (with a snapshot-diff mode) so the user can see exactly what icon Google is caching for each of their domains.

**Architecture:** Pure functions for URL building, format sniffing, pixel-corner classification, link extraction, and snapshot diffing — each unit-tested with synthesized image fixtures (no committed binaries). A thin concurrency-limited fetch layer wraps `fetch`. An orchestrator builds the `domain × endpoint × size` matrix plus origin probes into a `Snapshot`, which renders to a self-contained HTML grid (icons inlined as base64) and a JSON sibling. Compare mode diffs two snapshot JSONs.

**Tech Stack:** Node 22, TypeScript (strict, ESM), `fast-png` + `jpeg-js` (pure-JS decoders), `tsx` (run), Vitest (test), ESLint flat config + Prettier + Husky + lint-staged, GitHub Actions CI. Conventions mirror the rewind repo.

---

## File Structure

| File                      | Responsibility                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/config.ts`           | Domains list (+ optional `expected`), sizes, endpoints, concurrency/timeout constants, shared `Endpoint`/`DomainConfig` types               |
| `src/endpoints.ts`        | Build Google `faviconV2` / `s2` URLs from `(endpoint, domain, size)`                                                                        |
| `src/analyze.ts`          | `sniffFormat`, `decodeToRgba`, `classifyCorners`, `verdictFor`, `analyzeImage`; owns `ImageFormat`/`CornerClass`/`Verdict`/`Analysis` types |
| `src/fetch.ts`            | `mapWithConcurrency`, `fetchImage`; owns `FetchResult` type                                                                                 |
| `src/origin.ts`           | `extractIconLinks`, `extractManifestHref`, `probeOrigin`; owns `OriginAsset` type                                                           |
| `src/report.ts`           | `toDataUri`, `renderHtml`, `toJson`, `writeReports`; owns `Cell`/`Snapshot` types                                                           |
| `src/compare.ts`          | `cellKey`, `diffSnapshots`, `renderDiffHtml`; owns `CellDiff` type                                                                          |
| `src/index.ts`            | CLI arg parsing, `captureSnapshot` orchestration, wiring capture/compare to report output                                                   |
| `src/__tests__/*.test.ts` | Vitest unit tests per module                                                                                                                |

Plus scaffolding: `package.json`, `tsconfig.json`, `eslint.config.ts`, `vitest.config.ts`, `.prettierrc`, `.prettierignore`, `.editorconfig`, `.nvmrc`, `.gitignore`, `.husky/{pre-commit,pre-push}`, `.github/workflows/{ci.yml,pr-lint.yml}`, `.github/dependabot.yml`, `CLAUDE.md`, `README.md`.

---

## Task 1: Scaffolding & tooling

**Files:**

- Create: `package.json`, `tsconfig.json`, `eslint.config.ts`, `vitest.config.ts`, `.prettierrc`, `.prettierignore`, `.editorconfig`, `.nvmrc`, `.gitignore`, `.husky/pre-commit`, `.husky/pre-push`, `.github/workflows/ci.yml`, `.github/workflows/pr-lint.yml`, `.github/dependabot.yml`, `CLAUDE.md`, `README.md`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "favicon-inspector",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Inspect what Google's favicon services serve/cache for a set of domains.",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "build": "tsc",
    "lint": "eslint .",
    "lint:fix": "eslint . --fix",
    "lint:deps": "knip",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "type-check": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "prepare": "husky"
  },
  "lint-staged": {
    "*.{js,ts}": ["eslint --fix", "prettier --write"],
    "*.{json,md,yml,yaml}": ["prettier --write"]
  },
  "license": "MIT",
  "dependencies": {
    "fast-png": "^8.0.0",
    "jpeg-js": "^0.4.4"
  },
  "devDependencies": {
    "@eslint/js": "^10.0.1",
    "@types/node": "^22.0.0",
    "eslint": "^10.0.3",
    "eslint-config-prettier": "^10.1.8",
    "husky": "^9.1.7",
    "jiti": "^2.4.2",
    "knip": "^5.86.0",
    "lint-staged": "^16.3.3",
    "prettier": "^3.8.1",
    "tsx": "^4.19.0",
    "typescript": "^5.9.3",
    "typescript-eslint": "^8.57.0",
    "vitest": "~3.2.0"
  }
}
```

(`jiti` is required for ESLint to load a TypeScript flat config file.)

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Create `eslint.config.ts`**

```ts
import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    ignores: ['node_modules/', 'dist/', 'reports/'],
  }
);
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/__tests__/**/*.ts'],
  },
});
```

- [ ] **Step 5: Create Prettier + EditorConfig + Node-version files**

`.prettierrc`:

```json
{
  "semi": true,
  "trailingComma": "es5",
  "singleQuote": true,
  "printWidth": 80,
  "tabWidth": 2,
  "useTabs": false,
  "endOfLine": "lf"
}
```

`.prettierignore`:

```text
node_modules
dist
reports
coverage
*.log
```

`.editorconfig`:

```text
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false
```

`.nvmrc`:

```text
22
```

`.gitignore` (overwrite the init stub):

```text
node_modules/
reports/
dist/
*.log
```

- [ ] **Step 6: Create Husky hooks**

`.husky/pre-commit`:

```sh
npx lint-staged
```

`.husky/pre-push`:

```sh
npm run type-check && npm run lint && npm test
```

- [ ] **Step 7: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - name: ESLint
        run: npm run lint
      - name: Prettier
        run: npm run format:check
      - name: Type check
        run: npm run type-check
      - name: Check unused dependencies
        run: npm run lint:deps -- --no-exit-code

  test:
    name: Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - name: Run tests
        run: npm test

  build:
    name: Build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: actions/setup-node@v6
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - name: Build
        run: npm run build

  security:
    name: Security
    runs-on: ubuntu-latest
    continue-on-error: true
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v6
        with:
          node-version: '22'
          cache: 'npm'
      - run: npm ci
      - name: Audit dependencies
        run: npm audit --audit-level=moderate --omit=dev

  dependency-review:
    name: Dependency Review
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v6
      - name: Dependency review
        uses: actions/dependency-review-action@v5
```

- [ ] **Step 8: Create `.github/workflows/pr-lint.yml`**

```yaml
name: PR Lint

on:
  pull_request_target:
    types: [opened, reopened, edited, synchronize]

permissions:
  pull-requests: read

jobs:
  validate-title:
    name: Validate PR Title
    runs-on: ubuntu-latest
    steps:
      - uses: amannn/action-semantic-pull-request@v6
        with:
          types: |
            feat
            fix
            perf
            refactor
            revert
            docs
            style
            test
            build
            ci
            chore
            deps
          requireScope: false
          subjectPattern: ^[a-z].*$
          subjectPatternError: |
            The subject must start with a lowercase letter.
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

- [ ] **Step 9: Create `.github/dependabot.yml`**

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
      day: monday
    open-pull-requests-limit: 10
    groups:
      eslint:
        patterns:
          - 'eslint'
          - '@typescript-eslint/*'
          - 'eslint-*'
          - 'typescript-eslint'
      vitest:
        patterns:
          - 'vitest'
          - '@vitest/*'

  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
      day: monday
```

- [ ] **Step 10: Create `CLAUDE.md`**

````markdown
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
````

## Conventions

- No emojis in logging or output. Plain `[INFO]` / `[ERROR]` prefixes.
- Never rely on visual judgment of an icon; classify by decoded pixels.
- Domains live in `src/config.ts`.

````

- [ ] **Step 11: Create `README.md`**

```markdown
# favicon-inspector

Inspect what Google's favicon services serve and cache for a set of domains.

## Prerequisites

- Node 22 (`nvm use`)

## Install

```bash
npm install
````

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

````

- [ ] **Step 12: Install and verify tooling**

Run:

```bash
cd /Users/patdugan/Documents/GitHub/favicon-inspector
nvm use || true
npm install
npx husky init >/dev/null 2>&1 || true
chmod +x .husky/pre-commit .husky/pre-push
npm run format:check || npm run format
````

Expected: `npm install` succeeds; Prettier check passes (or `format` rewrites files).

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "chore: scaffold favicon-inspector tooling and CI"
```

---

## Task 2: Config and endpoint URL building

**Files:**

- Create: `src/config.ts`
- Create: `src/endpoints.ts`
- Test: `src/__tests__/endpoints.test.ts`

- [ ] **Step 1: Create `src/config.ts`**

```ts
export type Endpoint = 'faviconV2' | 's2';

export interface DomainConfig {
  /** Bare apex host, e.g. 'rewind.rest'. */
  domain: string;
  /** Mark domains whose icon is legitimately an opaque tile. */
  expected?: 'transparent' | 'opaque';
}

export const DOMAINS: DomainConfig[] = [
  { domain: 'rewind.rest' },
  { domain: 'getbiblio.app' },
  { domain: 'next-up.app' },
  { domain: 'patdugan.me' },
  { domain: 'clickwheel.fm' },
];

export const SIZES = [16, 32, 48, 64, 96, 128, 256] as const;

export const ENDPOINTS: Endpoint[] = ['faviconV2', 's2'];

export const CONCURRENCY = 8;
export const FETCH_TIMEOUT_MS = 10000;
```

- [ ] **Step 2: Write the failing test for `buildGoogleUrl`**

`src/__tests__/endpoints.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildGoogleUrl } from '../endpoints';

describe('buildGoogleUrl', () => {
  it('builds a faviconV2 URL with https-prefixed domain and size', () => {
    const url = buildGoogleUrl('faviconV2', 'rewind.rest', 64);
    expect(url).toBe(
      'https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://rewind.rest&size=64'
    );
  });

  it('builds a legacy s2 URL with bare domain and sz param', () => {
    const url = buildGoogleUrl('s2', 'rewind.rest', 48);
    expect(url).toBe(
      'https://www.google.com/s2/favicons?domain=rewind.rest&sz=48'
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- endpoints`
Expected: FAIL — `buildGoogleUrl` is not exported / module not found.

- [ ] **Step 4: Create `src/endpoints.ts`**

```ts
import type { Endpoint } from './config';

export function buildGoogleUrl(
  endpoint: Endpoint,
  domain: string,
  size: number
): string {
  if (endpoint === 'faviconV2') {
    return `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=${size}`;
  }
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=${size}`;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- endpoints`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/config.ts src/endpoints.ts src/__tests__/endpoints.test.ts
git commit -m "feat: add config and Google favicon URL builders"
```

---

## Task 3: Format sniffing

**Files:**

- Create: `src/analyze.ts` (first slice: types + `sniffFormat`)
- Test: `src/__tests__/analyze.sniff.test.ts`

- [ ] **Step 1: Write the failing test**

`src/__tests__/analyze.sniff.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sniffFormat } from '../analyze';

describe('sniffFormat', () => {
  it('detects PNG by signature', () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0,
    ]);
    expect(sniffFormat(png)).toBe('png');
  });

  it('detects JPEG by signature', () => {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    expect(sniffFormat(jpg)).toBe('jpeg');
  });

  it('detects ICO by signature', () => {
    const ico = new Uint8Array([0x00, 0x00, 0x01, 0x00, 0, 0]);
    expect(sniffFormat(ico)).toBe('ico');
  });

  it('detects SVG by markup', () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    );
    expect(sniffFormat(svg)).toBe('svg');
  });

  it('returns unknown for unrecognized bytes', () => {
    expect(sniffFormat(new Uint8Array([1, 2, 3, 4]))).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- analyze.sniff`
Expected: FAIL — module `../analyze` not found.

- [ ] **Step 3: Create `src/analyze.ts` with types and `sniffFormat`**

```ts
export type ImageFormat = 'png' | 'jpeg' | 'ico' | 'svg' | 'unknown';

export type CornerClass =
  | 'TRANSPARENT'
  | 'OPAQUE-WHITE'
  | 'OPAQUE-BLACK'
  | `OPAQUE-OTHER(${string})`
  | 'UNDECODED';

export type Verdict = 'OK' | 'WARN' | 'ALERT';

export interface Analysis {
  format: ImageFormat;
  width?: number;
  height?: number;
  hasAlpha?: boolean;
  cornerClass: CornerClass;
  verdict: Verdict;
}

export function sniffFormat(bytes: Uint8Array): ImageFormat {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png';
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'jpeg';
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x00 &&
    bytes[1] === 0x00 &&
    bytes[2] === 0x01 &&
    bytes[3] === 0x00
  ) {
    return 'ico';
  }
  const head = new TextDecoder().decode(bytes.slice(0, 256)).toLowerCase();
  if (
    head.includes('<svg') ||
    (head.includes('<?xml') && head.includes('svg'))
  ) {
    return 'svg';
  }
  return 'unknown';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- analyze.sniff`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/analyze.ts src/__tests__/analyze.sniff.test.ts
git commit -m "feat: add image format sniffing by magic bytes"
```

---

## Task 4: Corner classification and verdict

**Files:**

- Modify: `src/analyze.ts` (add `Rgba`, `classifyCorners`, `verdictFor`)
- Test: `src/__tests__/analyze.classify.test.ts`

- [ ] **Step 1: Write the failing test**

`src/__tests__/analyze.classify.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classifyCorners, verdictFor, type Rgba } from '../analyze';

function solid(r: number, g: number, b: number, a: number): Rgba {
  const w = 4;
  const h = 4;
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return { width: w, height: h, data };
}

describe('classifyCorners', () => {
  it('classifies fully transparent corners as TRANSPARENT', () => {
    expect(classifyCorners(solid(0, 0, 0, 0))).toBe('TRANSPARENT');
  });

  it('classifies opaque near-black corners as OPAQUE-BLACK', () => {
    expect(classifyCorners(solid(2, 1, 3, 255))).toBe('OPAQUE-BLACK');
  });

  it('classifies opaque near-white corners as OPAQUE-WHITE', () => {
    expect(classifyCorners(solid(255, 254, 250, 255))).toBe('OPAQUE-WHITE');
  });

  it('classifies other opaque colors as OPAQUE-OTHER with hex', () => {
    expect(classifyCorners(solid(0x5d, 0x6d, 0xdf, 255))).toBe(
      'OPAQUE-OTHER(#5d6ddf)'
    );
  });
});

describe('verdictFor', () => {
  it('ALERTs on JPEG with black background', () => {
    expect(verdictFor('jpeg', 'OPAQUE-BLACK')).toBe('ALERT');
  });

  it('WARNs on JPEG with non-black background', () => {
    expect(verdictFor('jpeg', 'OPAQUE-WHITE')).toBe('WARN');
  });

  it('is OK for transparent PNG', () => {
    expect(verdictFor('png', 'TRANSPARENT')).toBe('OK');
  });

  it('suppresses the black-JPEG ALERT to WARN when opaque is expected', () => {
    expect(verdictFor('jpeg', 'OPAQUE-BLACK', 'opaque')).toBe('WARN');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- analyze.classify`
Expected: FAIL — `classifyCorners` / `verdictFor` / `Rgba` not exported.

- [ ] **Step 3: Add implementation to `src/analyze.ts`**

Append to `src/analyze.ts`:

```ts
export interface Rgba {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8Array;
}

const ALPHA_OPAQUE_MIN = 16;
const DARK_MAX = 16;
const LIGHT_MIN = 240;

function cornerPixel(
  img: Rgba,
  x: number,
  y: number
): [number, number, number, number] {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
}

export function classifyCorners(img: Rgba): CornerClass {
  const pts: [number, number][] = [
    [0, 0],
    [img.width - 1, 0],
    [0, img.height - 1],
    [img.width - 1, img.height - 1],
  ];
  const corners = pts.map(([x, y]) => cornerPixel(img, x, y));
  const maxAlpha = Math.max(...corners.map((c) => c[3]));
  if (maxAlpha < ALPHA_OPAQUE_MIN) return 'TRANSPARENT';

  const opaque = corners.filter((c) => c[3] >= ALPHA_OPAQUE_MIN);
  const allDark = opaque.every(
    (c) => c[0] <= DARK_MAX && c[1] <= DARK_MAX && c[2] <= DARK_MAX
  );
  if (allDark) return 'OPAQUE-BLACK';

  const allLight = opaque.every(
    (c) => c[0] >= LIGHT_MIN && c[1] >= LIGHT_MIN && c[2] >= LIGHT_MIN
  );
  if (allLight) return 'OPAQUE-WHITE';

  const [r, g, b] = opaque[0];
  const hex =
    '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
  return `OPAQUE-OTHER(${hex})`;
}

export function verdictFor(
  format: ImageFormat,
  cornerClass: CornerClass,
  expected?: 'transparent' | 'opaque'
): Verdict {
  if (format === 'jpeg') {
    if (cornerClass === 'OPAQUE-BLACK' && expected !== 'opaque') return 'ALERT';
    return 'WARN';
  }
  return 'OK';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- analyze.classify`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/analyze.ts src/__tests__/analyze.classify.test.ts
git commit -m "feat: add corner classification and verdict logic"
```

---

## Task 5: Decode + end-to-end analyzeImage

**Files:**

- Modify: `src/analyze.ts` (add `decodeToRgba`, `analyzeImage`)
- Test: `src/__tests__/analyze.image.test.ts`

- [ ] **Step 1: Write the failing test (synthesizes real PNG/JPEG bytes)**

`src/__tests__/analyze.image.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { encode as encodePng } from 'fast-png';
import jpeg from 'jpeg-js';
import { analyzeImage } from '../analyze';

function rgbaImage(r: number, g: number, b: number, a: number) {
  const width = 8;
  const height = 8;
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return { width, height, data };
}

describe('analyzeImage', () => {
  it('classifies a transparent PNG', () => {
    const img = rgbaImage(0, 0, 0, 0);
    const bytes = encodePng({
      width: img.width,
      height: img.height,
      data: img.data,
      channels: 4,
    });
    const a = analyzeImage(new Uint8Array(bytes));
    expect(a.format).toBe('png');
    expect(a.hasAlpha).toBe(true);
    expect(a.cornerClass).toBe('TRANSPARENT');
    expect(a.verdict).toBe('OK');
  });

  it('classifies an opaque black JPEG as ALERT', () => {
    const img = rgbaImage(0, 0, 0, 255);
    const encoded = jpeg.encode(
      { width: img.width, height: img.height, data: Buffer.from(img.data) },
      90
    );
    const a = analyzeImage(new Uint8Array(encoded.data));
    expect(a.format).toBe('jpeg');
    expect(a.cornerClass).toBe('OPAQUE-BLACK');
    expect(a.verdict).toBe('ALERT');
  });

  it('records UNDECODED for unknown bytes without throwing', () => {
    const a = analyzeImage(new Uint8Array([1, 2, 3, 4]));
    expect(a.format).toBe('unknown');
    expect(a.cornerClass).toBe('UNDECODED');
    expect(a.verdict).toBe('OK');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- analyze.image`
Expected: FAIL — `analyzeImage` not exported.

- [ ] **Step 3: Add `decodeToRgba` and `analyzeImage` to `src/analyze.ts`**

Add these imports at the TOP of `src/analyze.ts`:

```ts
import { decode as decodePng } from 'fast-png';
import jpeg from 'jpeg-js';
```

Append to `src/analyze.ts`:

```ts
/**
 * Decode PNG/JPEG bytes to a uniform 8-bit RGBA buffer. Assumes 8-bit PNG
 * depth (true for favicons). Returns null for formats we do not decode
 * (ico, svg, unknown).
 */
export function decodeToRgba(
  bytes: Uint8Array,
  format: ImageFormat
): (Rgba & { hasAlpha: boolean }) | null {
  if (format === 'png') {
    const img = decodePng(bytes);
    const { width, height, channels } = img;
    const src = img.data as Uint8Array;
    const out = new Uint8Array(width * height * 4);
    for (let p = 0; p < width * height; p++) {
      let r: number;
      let g: number;
      let b: number;
      let a: number;
      if (channels === 4) {
        r = src[p * 4];
        g = src[p * 4 + 1];
        b = src[p * 4 + 2];
        a = src[p * 4 + 3];
      } else if (channels === 3) {
        r = src[p * 3];
        g = src[p * 3 + 1];
        b = src[p * 3 + 2];
        a = 255;
      } else if (channels === 2) {
        r = g = b = src[p * 2];
        a = src[p * 2 + 1];
      } else {
        r = g = b = src[p];
        a = 255;
      }
      out[p * 4] = r;
      out[p * 4 + 1] = g;
      out[p * 4 + 2] = b;
      out[p * 4 + 3] = a;
    }
    return {
      width,
      height,
      data: out,
      hasAlpha: channels === 4 || channels === 2,
    };
  }
  if (format === 'jpeg') {
    const img = jpeg.decode(bytes, { useTArray: true });
    return {
      width: img.width,
      height: img.height,
      data: img.data as unknown as Uint8Array,
      hasAlpha: false,
    };
  }
  return null;
}

export function analyzeImage(
  bytes: Uint8Array,
  opts: { expected?: 'transparent' | 'opaque' } = {}
): Analysis {
  const format = sniffFormat(bytes);
  let width: number | undefined;
  let height: number | undefined;
  let hasAlpha: boolean | undefined;
  let cornerClass: CornerClass = 'UNDECODED';
  try {
    const img = decodeToRgba(bytes, format);
    if (img) {
      width = img.width;
      height = img.height;
      hasAlpha = img.hasAlpha;
      cornerClass = classifyCorners(img);
    }
  } catch {
    cornerClass = 'UNDECODED';
  }
  const verdict = verdictFor(format, cornerClass, opts.expected);
  return { format, width, height, hasAlpha, cornerClass, verdict };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- analyze.image`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/analyze.ts src/__tests__/analyze.image.test.ts
git commit -m "feat: add image decoding and analyzeImage"
```

---

## Task 6: Concurrency-limited fetch

**Files:**

- Create: `src/fetch.ts`
- Test: `src/__tests__/fetch.test.ts`

- [ ] **Step 1: Write the failing test for `mapWithConcurrency`**

`src/__tests__/fetch.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mapWithConcurrency } from '../fetch';

describe('mapWithConcurrency', () => {
  it('preserves input order in the results', async () => {
    const items = [1, 2, 3, 4, 5];
    const out = await mapWithConcurrency(items, 2, async (n) => n * 10);
    expect(out).toEqual([10, 20, 30, 40, 50]);
  });

  it('never exceeds the concurrency limit', async () => {
    let active = 0;
    let maxActive = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    await mapWithConcurrency(items, 3, async (n) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return n;
    });
    expect(maxActive).toBeLessThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- fetch`
Expected: FAIL — module `../fetch` not found.

- [ ] **Step 3: Create `src/fetch.ts`**

```ts
import { FETCH_TIMEOUT_MS } from './config';

export interface FetchResult {
  url: string;
  status: number;
  contentType: string | null;
  bytes: Uint8Array | null;
  error?: string;
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const count = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: count }, () => worker()));
  return results;
}

export async function fetchImage(
  url: string,
  timeoutMs: number = FETCH_TIMEOUT_MS
): Promise<FetchResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    const bytes = new Uint8Array(await res.arrayBuffer());
    return {
      url,
      status: res.status,
      contentType: res.headers.get('content-type'),
      bytes,
    };
  } catch (e) {
    return {
      url,
      status: 0,
      contentType: null,
      bytes: null,
      error: (e as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- fetch`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/fetch.ts src/__tests__/fetch.test.ts
git commit -m "feat: add concurrency-limited fetch layer"
```

---

## Task 7: Origin probing

**Files:**

- Create: `src/origin.ts`
- Test: `src/__tests__/origin.test.ts`

- [ ] **Step 1: Write the failing test for the pure link extractors**

`src/__tests__/origin.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { extractIconLinks, extractManifestHref } from '../origin';

const html = `
<html><head>
<link rel="icon" href="/favicon.ico">
<link rel="apple-touch-icon" sizes="180x180" href="https://cdn.example.com/at.png">
<link rel="stylesheet" href="/style.css">
<link rel="manifest" href="/site.webmanifest">
</head></html>`;

describe('extractIconLinks', () => {
  it('returns only icon-rel links with their href and rel', () => {
    expect(extractIconLinks(html)).toEqual([
      { href: '/favicon.ico', rel: 'icon' },
      { href: 'https://cdn.example.com/at.png', rel: 'apple-touch-icon' },
    ]);
  });

  it('returns an empty array when there are no icon links', () => {
    expect(extractIconLinks('<head></head>')).toEqual([]);
  });
});

describe('extractManifestHref', () => {
  it('returns the manifest href', () => {
    expect(extractManifestHref(html)).toBe('/site.webmanifest');
  });

  it('returns null when no manifest link is present', () => {
    expect(extractManifestHref('<head></head>')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- origin`
Expected: FAIL — module `../origin` not found.

- [ ] **Step 3: Create `src/origin.ts`**

```ts
import { CONCURRENCY } from './config';
import { fetchImage, mapWithConcurrency } from './fetch';
import { analyzeImage, type Analysis, type CornerClass } from './analyze';

export interface OriginAsset {
  path: string;
  source: 'well-known' | 'html-link' | 'manifest';
  status: number;
  contentType: string | null;
  analysis: Analysis;
}

export interface DeclaredIcon {
  href: string;
  rel: string;
}

const WELL_KNOWN = [
  '/favicon.ico',
  '/favicon.svg',
  '/apple-touch-icon.png',
  '/apple-touch-icon-precomposed.png',
];

export function extractIconLinks(html: string): DeclaredIcon[] {
  const links: DeclaredIcon[] = [];
  const tagRe = /<link\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html))) {
    const tag = m[0];
    const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? '';
    if (!/icon/i.test(rel)) continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (href) links.push({ href, rel: rel.toLowerCase() });
  }
  return links;
}

export function extractManifestHref(html: string): string | null {
  const tag = /<link\b[^>]*rel\s*=\s*["']manifest["'][^>]*>/i.exec(html)?.[0];
  if (!tag) return null;
  return /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? null;
}

const UNDECODED: Analysis = {
  format: 'unknown',
  cornerClass: 'UNDECODED' as CornerClass,
  verdict: 'OK',
};

export async function probeOrigin(domain: string): Promise<OriginAsset[]> {
  const base = `https://${domain}/`;
  const root = base.replace(/\/$/, '');
  const targets: { url: string; source: OriginAsset['source'] }[] = [];

  for (const p of WELL_KNOWN) {
    targets.push({ url: root + p, source: 'well-known' });
  }

  try {
    const res = await fetch(base, { redirect: 'follow' });
    const html = await res.text();
    for (const link of extractIconLinks(html)) {
      targets.push({
        url: new URL(link.href, base).toString(),
        source: 'html-link',
      });
    }
    const manifestHref = extractManifestHref(html);
    if (manifestHref) {
      try {
        const manifestUrl = new URL(manifestHref, base).toString();
        const mres = await fetch(manifestUrl, { redirect: 'follow' });
        const manifest = (await mres.json()) as { icons?: { src: string }[] };
        for (const icon of manifest.icons ?? []) {
          targets.push({
            url: new URL(icon.src, manifestUrl).toString(),
            source: 'manifest',
          });
        }
      } catch {
        // manifest missing or unparseable; skip
      }
    }
  } catch {
    // homepage unreachable; fall back to well-known paths only
  }

  const seen = new Set<string>();
  const unique = targets.filter((t) =>
    seen.has(t.url) ? false : (seen.add(t.url), true)
  );

  return mapWithConcurrency(unique, CONCURRENCY, async (t) => {
    const r = await fetchImage(t.url);
    const analysis = r.bytes ? analyzeImage(r.bytes) : UNDECODED;
    return {
      path: new URL(t.url).pathname,
      source: t.source,
      status: r.status,
      contentType: r.contentType,
      analysis,
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- origin`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/origin.ts src/__tests__/origin.test.ts
git commit -m "feat: add origin favicon probing"
```

---

## Task 8: Report types, serialization, and rendering

**Files:**

- Create: `src/report.ts`
- Test: `src/__tests__/report.test.ts`

- [ ] **Step 1: Write the failing test**

`src/__tests__/report.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toDataUri, toJson, renderHtml, type Snapshot } from '../report';

const snapshot: Snapshot = {
  capturedAt: '2026-06-09T12:00:00.000Z',
  cells: [
    {
      domain: 'rewind.rest',
      endpoint: 'faviconV2',
      size: 64,
      status: 200,
      contentType: 'image/jpeg',
      analysis: {
        format: 'jpeg',
        width: 64,
        height: 64,
        hasAlpha: false,
        cornerClass: 'OPAQUE-BLACK',
        verdict: 'ALERT',
      },
      dataUri: 'data:image/jpeg;base64,AAAA',
    },
  ],
  origins: {
    'rewind.rest': [
      {
        path: '/favicon.ico',
        source: 'well-known',
        status: 200,
        contentType: 'image/x-icon',
        analysis: { format: 'ico', cornerClass: 'UNDECODED', verdict: 'OK' },
      },
    ],
  },
};

describe('toDataUri', () => {
  it('encodes bytes as a base64 data URI', () => {
    const uri = toDataUri('image/png', new Uint8Array([1, 2, 3]));
    expect(uri).toBe('data:image/png;base64,AQID');
  });
});

describe('toJson', () => {
  it('omits dataUri from serialized cells', () => {
    const parsed = JSON.parse(toJson(snapshot));
    expect(parsed.cells[0].dataUri).toBeUndefined();
    expect(parsed.cells[0].analysis.verdict).toBe('ALERT');
    expect(parsed.capturedAt).toBe('2026-06-09T12:00:00.000Z');
  });
});

describe('renderHtml', () => {
  it('produces an HTML document embedding the icon and its verdict', () => {
    const html = renderHtml(snapshot);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('data:image/jpeg;base64,AAAA');
    expect(html).toContain('ALERT');
    expect(html).toContain('rewind.rest');
    expect(html).toContain('2026-06-09T12:00:00.000Z');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- report`
Expected: FAIL — module `../report` not found.

- [ ] **Step 3: Create `src/report.ts`**

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import type { Endpoint } from './config';
import type { Analysis, Verdict } from './analyze';
import type { OriginAsset } from './origin';

export interface Cell {
  domain: string;
  endpoint: Endpoint;
  size: number;
  status: number;
  contentType: string | null;
  error?: string;
  analysis: Analysis;
  dataUri?: string;
}

export interface Snapshot {
  capturedAt: string;
  cells: Cell[];
  origins: Record<string, OriginAsset[]>;
}

export function toDataUri(
  contentType: string | null,
  bytes: Uint8Array
): string {
  const b64 = Buffer.from(bytes).toString('base64');
  return `data:${contentType ?? 'application/octet-stream'};base64,${b64}`;
}

export function toJson(snapshot: Snapshot): string {
  const cells = snapshot.cells.map(({ dataUri: _dataUri, ...rest }) => rest);
  return JSON.stringify(
    { capturedAt: snapshot.capturedAt, cells, origins: snapshot.origins },
    null,
    2
  );
}

const VERDICT_COLOR: Record<Verdict, string> = {
  OK: '#1a7f37',
  WARN: '#9a6700',
  ALERT: '#cf222e',
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function cellHtml(cell: Cell): string {
  const a = cell.analysis;
  const color = VERDICT_COLOR[a.verdict];
  const img = cell.dataUri
    ? `<img src="${cell.dataUri}" width="48" height="48" alt="">`
    : `<div class="missing">${cell.status || 'ERR'}</div>`;
  const diag = `${a.format} · ${a.hasAlpha ? 'alpha' : 'no-alpha'} · ${escapeHtml(a.cornerClass)}`;
  return `
    <td>
      <div class="cell">
        <div class="chk">${img}</div>
        <div class="diag">${diag}</div>
        <div class="verdict" style="color:${color}">${a.verdict}</div>
      </div>
    </td>`;
}

function originPanel(origins: Snapshot['origins']): string {
  const rows: string[] = [];
  for (const [domain, assets] of Object.entries(origins)) {
    for (const asset of assets) {
      rows.push(`
        <tr>
          <td>${escapeHtml(domain)}</td>
          <td>${escapeHtml(asset.path)}</td>
          <td>${asset.source}</td>
          <td>${asset.status}</td>
          <td>${escapeHtml(asset.contentType ?? '')}</td>
          <td>${asset.analysis.format} · ${escapeHtml(asset.analysis.cornerClass)}</td>
        </tr>`);
    }
  }
  return `
    <h2>Origin assets</h2>
    <table class="origin">
      <tr><th>Domain</th><th>Path</th><th>Source</th><th>Status</th><th>Content-Type</th><th>Analysis</th></tr>
      ${rows.join('')}
    </table>`;
}

function matrixTables(cells: Cell[]): string {
  const domains = [...new Set(cells.map((c) => c.domain))];
  const endpoints = [...new Set(cells.map((c) => c.endpoint))];
  const sizes = [...new Set(cells.map((c) => c.size))].sort((a, b) => a - b);
  const blocks: string[] = [];
  for (const domain of domains) {
    for (const endpoint of endpoints) {
      const rows = sizes
        .map((size) => {
          const cell = cells.find(
            (c) =>
              c.domain === domain && c.endpoint === endpoint && c.size === size
          );
          const body = cell
            ? cellHtml(cell)
            : '<td><div class="cell missing">-</div></td>';
          return `<tr><th>${size}px</th>${body}</tr>`;
        })
        .join('');
      blocks.push(`
        <div class="block">
          <h3>${escapeHtml(domain)} — ${endpoint}</h3>
          <table class="matrix">${rows}</table>
        </div>`);
    }
  }
  return blocks.join('');
}

export function renderHtml(snapshot: Snapshot): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>favicon-inspector — ${snapshot.capturedAt}</title>
<style>
  body { font: 13px/1.4 -apple-system, system-ui, sans-serif; margin: 24px; color: #1f2328; }
  h1 { font-size: 18px; }
  .meta { color: #57606a; margin-bottom: 16px; }
  .blocks { display: flex; flex-wrap: wrap; gap: 20px; }
  .block { border: 1px solid #d0d7de; border-radius: 8px; padding: 12px; }
  .block h3 { margin: 0 0 8px; font-size: 13px; }
  table.matrix th { text-align: right; padding-right: 8px; color: #57606a; font-weight: 500; }
  .cell { width: 120px; padding: 6px 0; }
  .chk {
    display: inline-block;
    background-image:
      linear-gradient(45deg, #ccc 25%, transparent 25%),
      linear-gradient(-45deg, #ccc 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #ccc 75%),
      linear-gradient(-45deg, transparent 75%, #ccc 75%);
    background-size: 12px 12px;
    background-position: 0 0, 0 6px, 6px -6px, -6px 0;
    padding: 4px;
    border: 1px solid #d0d7de;
  }
  .diag { color: #57606a; font-size: 11px; margin-top: 4px; }
  .verdict { font-weight: 600; font-size: 12px; }
  .missing { color: #57606a; }
  table.origin { border-collapse: collapse; margin-top: 8px; }
  table.origin th, table.origin td { border: 1px solid #d0d7de; padding: 4px 8px; text-align: left; }
</style>
</head>
<body>
  <h1>favicon-inspector</h1>
  <div class="meta">Captured ${snapshot.capturedAt}</div>
  ${originPanel(snapshot.origins)}
  <h2>Google favicon matrix</h2>
  <div class="blocks">${matrixTables(snapshot.cells)}</div>
</body>
</html>`;
}

export function writeReports(
  snapshot: Snapshot,
  outDir = 'reports'
): { htmlPath: string; jsonPath: string } {
  mkdirSync(outDir, { recursive: true });
  const stamp = snapshot.capturedAt.replace(/[:.]/g, '-');
  const htmlPath = `${outDir}/report-${stamp}.html`;
  const jsonPath = `${outDir}/report-${stamp}.json`;
  writeFileSync(htmlPath, renderHtml(snapshot));
  writeFileSync(jsonPath, toJson(snapshot));
  return { htmlPath, jsonPath };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- report`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/report.ts src/__tests__/report.test.ts
git commit -m "feat: add report serialization and HTML rendering"
```

---

## Task 9: Snapshot diffing (compare mode)

**Files:**

- Create: `src/compare.ts`
- Test: `src/__tests__/compare.test.ts`

- [ ] **Step 1: Write the failing test**

`src/__tests__/compare.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { cellKey, diffSnapshots } from '../compare';
import type { Snapshot } from '../report';

function snap(
  verdict: 'ALERT' | 'OK',
  format: 'jpeg' | 'png',
  corner: string
): Snapshot {
  return {
    capturedAt: '2026-06-09T12:00:00.000Z',
    cells: [
      {
        domain: 'rewind.rest',
        endpoint: 'faviconV2',
        size: 64,
        status: 200,
        contentType: null,
        analysis: {
          format,
          cornerClass: corner as never,
          verdict,
        },
      },
    ],
    origins: {},
  };
}

describe('cellKey', () => {
  it('joins domain, endpoint, size', () => {
    expect(
      cellKey({ domain: 'rewind.rest', endpoint: 'faviconV2', size: 64 })
    ).toBe('rewind.rest|faviconV2|64');
  });
});

describe('diffSnapshots', () => {
  it('reports cells whose format/corner/verdict changed', () => {
    const before = snap('ALERT', 'jpeg', 'OPAQUE-BLACK');
    const after = snap('OK', 'png', 'TRANSPARENT');
    const diffs = diffSnapshots(before, after);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].key).toBe('rewind.rest|faviconV2|64');
    expect(diffs[0].before.verdict).toBe('ALERT');
    expect(diffs[0].after.verdict).toBe('OK');
  });

  it('reports nothing when unchanged', () => {
    const before = snap('ALERT', 'jpeg', 'OPAQUE-BLACK');
    const after = snap('ALERT', 'jpeg', 'OPAQUE-BLACK');
    expect(diffSnapshots(before, after)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- compare`
Expected: FAIL — module `../compare` not found.

- [ ] **Step 3: Create `src/compare.ts`**

```ts
import type { Endpoint } from './config';
import type { Analysis } from './analyze';
import type { Snapshot } from './report';

type DiffFields = Pick<Analysis, 'format' | 'cornerClass' | 'verdict'>;

export interface CellDiff {
  key: string;
  before: DiffFields;
  after: DiffFields;
}

export function cellKey(c: {
  domain: string;
  endpoint: Endpoint;
  size: number;
}): string {
  return `${c.domain}|${c.endpoint}|${c.size}`;
}

function pick(a: Analysis): DiffFields {
  return { format: a.format, cornerClass: a.cornerClass, verdict: a.verdict };
}

export function diffSnapshots(before: Snapshot, after: Snapshot): CellDiff[] {
  const beforeMap = new Map(before.cells.map((c) => [cellKey(c), c.analysis]));
  const diffs: CellDiff[] = [];
  for (const c of after.cells) {
    const b = beforeMap.get(cellKey(c));
    if (!b) continue;
    const a = c.analysis;
    if (
      b.format !== a.format ||
      b.cornerClass !== a.cornerClass ||
      b.verdict !== a.verdict
    ) {
      diffs.push({ key: cellKey(c), before: pick(b), after: pick(a) });
    }
  }
  return diffs;
}

export function renderDiffHtml(diffs: CellDiff[], capturedAt: string): string {
  const rows = diffs
    .map(
      (d) => `
      <tr>
        <td>${d.key}</td>
        <td>${d.before.format} · ${d.before.cornerClass} · ${d.before.verdict}</td>
        <td>→</td>
        <td>${d.after.format} · ${d.after.cornerClass} · ${d.after.verdict}</td>
      </tr>`
    )
    .join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>favicon-inspector diff</title>
<style>
  body { font: 13px/1.4 system-ui, sans-serif; margin: 24px; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #d0d7de; padding: 4px 8px; text-align: left; }
</style></head>
<body>
  <h1>favicon-inspector — changes</h1>
  <div>Compared at ${capturedAt}; ${diffs.length} cell(s) changed</div>
  <table>
    <tr><th>Cell</th><th>Before</th><th></th><th>After</th></tr>
    ${rows}
  </table>
</body></html>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- compare`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/compare.ts src/__tests__/compare.test.ts
git commit -m "feat: add snapshot diffing for compare mode"
```

---

## Task 10: CLI orchestration and live run

**Files:**

- Create: `src/index.ts`

- [ ] **Step 1: Create `src/index.ts`**

```ts
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import {
  DOMAINS,
  SIZES,
  ENDPOINTS,
  CONCURRENCY,
  type DomainConfig,
} from './config';
import { buildGoogleUrl } from './endpoints';
import { analyzeImage } from './analyze';
import { fetchImage, mapWithConcurrency } from './fetch';
import { probeOrigin, type OriginAsset } from './origin';
import { toDataUri, writeReports, type Cell, type Snapshot } from './report';
import { diffSnapshots, renderDiffHtml } from './compare';

interface Job {
  domain: DomainConfig;
  endpoint: (typeof ENDPOINTS)[number];
  size: number;
}

async function captureSnapshot(): Promise<Snapshot> {
  const capturedAt = new Date().toISOString();

  const jobs: Job[] = [];
  for (const domain of DOMAINS) {
    for (const endpoint of ENDPOINTS) {
      for (const size of SIZES) {
        jobs.push({ domain, endpoint, size });
      }
    }
  }

  console.log(
    `[INFO] Fetching ${jobs.length} Google favicon cells across ${DOMAINS.length} domains`
  );
  const cells = await mapWithConcurrency(jobs, CONCURRENCY, async (job) => {
    const url = buildGoogleUrl(job.endpoint, job.domain.domain, job.size);
    const r = await fetchImage(url);
    const analysis = r.bytes
      ? analyzeImage(r.bytes, { expected: job.domain.expected })
      : {
          format: 'unknown' as const,
          cornerClass: 'UNDECODED' as const,
          verdict: 'OK' as const,
        };
    const cell: Cell = {
      domain: job.domain.domain,
      endpoint: job.endpoint,
      size: job.size,
      status: r.status,
      contentType: r.contentType,
      error: r.error,
      analysis,
      dataUri: r.bytes ? toDataUri(r.contentType, r.bytes) : undefined,
    };
    return cell;
  });

  console.log('[INFO] Probing origin assets');
  const origins: Record<string, OriginAsset[]> = {};
  await mapWithConcurrency(DOMAINS, CONCURRENCY, async (d) => {
    origins[d.domain] = await probeOrigin(d.domain);
  });

  return { capturedAt, cells, origins };
}

function loadSnapshot(path: string): Snapshot {
  return JSON.parse(readFileSync(path, 'utf8')) as Snapshot;
}

function summarize(snapshot: Snapshot): void {
  const alerts = snapshot.cells.filter((c) => c.analysis.verdict === 'ALERT');
  const warns = snapshot.cells.filter((c) => c.analysis.verdict === 'WARN');
  console.log(
    `[INFO] ${snapshot.cells.length} cells: ${alerts.length} ALERT, ${warns.length} WARN`
  );
  for (const c of alerts) {
    console.log(
      `[ALERT] ${c.domain} ${c.endpoint} ${c.size}px -> ${c.analysis.format}/${c.analysis.cornerClass}`
    );
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const compareIdx = args.indexOf('--compare');

  if (compareIdx !== -1) {
    const rest = args.slice(compareIdx + 1).filter((a) => !a.startsWith('--'));
    if (rest.length === 0) {
      console.error(
        '[ERROR] --compare requires at least one snapshot JSON path'
      );
      process.exit(1);
    }
    const before = loadSnapshot(rest[0]);
    const after = rest[1] ? loadSnapshot(rest[1]) : await captureSnapshot();
    if (!rest[1]) {
      writeReports(after);
    }
    const diffs = diffSnapshots(before, after);
    mkdirSync('reports', { recursive: true });
    const stamp = after.capturedAt.replace(/[:.]/g, '-');
    const diffPath = `reports/diff-${stamp}.html`;
    writeFileSync(diffPath, renderDiffHtml(diffs, after.capturedAt));
    console.log(`[INFO] ${diffs.length} cell(s) changed. Diff: ${diffPath}`);
    for (const d of diffs) {
      console.log(
        `[DIFF] ${d.key}: ${d.before.format}/${d.before.cornerClass}/${d.before.verdict} -> ${d.after.format}/${d.after.cornerClass}/${d.after.verdict}`
      );
    }
    return;
  }

  const snapshot = await captureSnapshot();
  const { htmlPath, jsonPath } = writeReports(snapshot);
  summarize(snapshot);
  console.log(`[INFO] Report: ${htmlPath}`);
  console.log(`[INFO] JSON:   ${jsonPath}`);
}

main().catch((e) => {
  console.error('[ERROR]', e);
  process.exit(1);
});
```

- [ ] **Step 2: Type-check and lint the whole project**

Run: `npm run type-check && npm run lint`
Expected: both pass with no errors.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: all suites PASS.

- [ ] **Step 4: Live capture run against the real domains**

Run: `npm start`
Expected: logs `[INFO] Fetching 70 Google favicon cells ...`, then `[INFO] Probing origin assets`, a summary line, and writes `reports/report-<timestamp>.html` + `.json`. At least the `rewind.rest faviconV2 48px` / `64px` cells should currently report `jpeg`/`OPAQUE-BLACK` (the known issue), confirming detection works end-to-end.

- [ ] **Step 5: Verify the HTML report opens and renders**

Run: `open reports/report-*.html`
Expected: the page shows the origin panel and the Google matrix grid; icons render on a checkerboard; verdict cells are color-coded; the known black cells show `ALERT`.

- [ ] **Step 6: Smoke-test compare mode**

Run:

```bash
ls -t reports/report-*.json | head -1
npm start -- --compare "$(ls -t reports/report-*.json | head -1)"
```

Expected: captures a fresh snapshot, writes a `reports/diff-<timestamp>.html`, and logs the changed-cell count (likely `0 cell(s) changed` immediately after the first run).

- [ ] **Step 7: Commit**

```bash
git add src/index.ts
git commit -m "feat: add CLI orchestration, capture, and compare wiring"
```

---

## Self-Review

**Spec coverage:**

- Snapshot report (HTML + JSON, timestamped) — Tasks 8, 10. ✓
- Probe matrix (faviconV2 + s2 × 7 sizes × 5 domains) — Tasks 2, 10. ✓
- Origin probing (well-known + HTML `<link>` + manifest) — Task 7. ✓
- Per-cell analysis (format sniff, alpha, corner class, verdict, `expected` suppression) — Tasks 3, 4, 5. ✓
- Pure-JS decode via fast-png + jpeg-js — Task 5. ✓
- Self-contained HTML (base64 inlined, checkerboard) — Task 8. ✓
- Compare mode (one path = capture+diff; two paths = offline diff) — Tasks 9, 10. ✓
- Error handling (failed fetch recorded not fatal; undecodable = UNDECODED/OK; bounded concurrency) — Tasks 5, 6, 7, 10. ✓
- Tooling/scaffolding mirroring rewind; release-please omitted — Task 1. ✓
- Tests for analyze/compare/endpoints + origin link extraction — Tasks 2–9. ✓

**Placeholder scan:** No TBD/TODO; every code step contains complete code. ✓

**Type consistency:** `Analysis`, `CornerClass`, `Verdict`, `Rgba` (analyze.ts); `FetchResult`, `mapWithConcurrency` (fetch.ts); `OriginAsset` (origin.ts); `Cell`, `Snapshot`, `writeReports`, `toDataUri` (report.ts); `cellKey`, `diffSnapshots`, `renderDiffHtml`, `CellDiff` (compare.ts) — names and signatures are used consistently across tasks. `buildGoogleUrl(endpoint, domain, size)` signature matches its call site in Task 10. ✓
