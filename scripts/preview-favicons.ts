/**
 * Build a self-contained HTML gallery of the generated favicon sets so the
 * icons can be eyeballed on transparent and white backgrounds at real sizes.
 *
 * Run: npm run favicons:preview  (after npm run favicons:generate)
 */
import sharp from 'sharp';
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const GENERATED_DIR = 'generated';
const OUT = path.join(GENERATED_DIR, 'preview.html');

/** Representative files to show per domain, in display order. */
const SHOWCASE: { file: string; label: string; note?: string }[] = [
  { file: 'favicon.svg', label: 'favicon.svg', note: 'vector' },
  { file: 'favicon-16x16.png', label: 'favicon 16' },
  { file: 'favicon-32x32.png', label: 'favicon 32' },
  { file: 'favicon-48x48.png', label: 'favicon 48' },
  { file: 'android-chrome-96x96.png', label: 'png 96' },
  { file: 'apple-touch-icon.png', label: 'apple-touch', note: 'opaque' },
  { file: 'android-chrome-512x512.png', label: 'android 512' },
  {
    file: 'android-chrome-maskable-512x512.png',
    label: 'maskable 512',
    note: 'opaque',
  },
];

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

async function dataUri(file: string): Promise<string> {
  const bytes = await readFile(file);
  const mime = MIME[path.extname(file)] ?? 'application/octet-stream';
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

async function listDomains(): Promise<string[]> {
  const entries = await readdir(GENERATED_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

async function tileHtml(dir: string, item: (typeof SHOWCASE)[number]) {
  const file = path.join(dir, item.file);
  if (!existsSync(file)) return '';
  const uri = await dataUri(file);
  let dims: string;
  if (item.file.endsWith('.png')) {
    const m = await sharp(file).metadata();
    dims = `${m.width}x${m.height}`;
  } else {
    const { size } = await stat(file);
    dims = `${size} B`;
  }
  const display = 96;
  const note = item.note ? ` · ${item.note}` : '';
  return `
    <figure>
      <div class="swatch light"><img src="${uri}" width="${display}" height="${display}" alt="${item.label}"></div>
      <div class="swatch check"><img src="${uri}" width="${display}" height="${display}" alt="${item.label}"></div>
      <figcaption><strong>${item.label}</strong><br>${dims}${note}</figcaption>
    </figure>`;
}

async function domainHtml(domain: string): Promise<string> {
  const dir = path.join(GENERATED_DIR, domain);
  const tiles = (
    await Promise.all(SHOWCASE.map((item) => tileHtml(dir, item)))
  ).join('');
  return `<section><h2>${domain}</h2><div class="row">${tiles}</div></section>`;
}

async function main(): Promise<void> {
  if (!existsSync(GENERATED_DIR)) {
    console.error('[ERROR] no generated/ dir; run npm run favicons:generate');
    process.exit(1);
  }
  const domains = await listDomains();
  const sections = (await Promise.all(domains.map(domainHtml))).join('\n');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>favicon preview</title>
<style>
  body { font: 13px/1.4 -apple-system, system-ui, sans-serif; margin: 24px; color: #1f2328; }
  h1 { font-size: 18px; }
  h2 { font-size: 14px; margin: 24px 0 8px; }
  .row { display: flex; flex-wrap: wrap; gap: 16px; }
  figure { margin: 0; text-align: center; }
  .swatch { display: inline-block; padding: 8px; border: 1px solid #d0d7de; }
  .swatch.light { background: #fff; border-bottom: none; }
  .swatch.check {
    background-image:
      linear-gradient(45deg, #ccc 25%, transparent 25%),
      linear-gradient(-45deg, #ccc 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #ccc 75%),
      linear-gradient(-45deg, transparent 75%, #ccc 75%);
    background-size: 16px 16px;
    background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  }
  figcaption { color: #57606a; font-size: 11px; margin-top: 4px; }
  figcaption strong { color: #1f2328; }
</style>
</head>
<body>
  <h1>favicon preview</h1>
  <p class="meta">Top row: white background. Bottom row: transparency checkerboard.</p>
  ${sections}
</body>
</html>`;
  await writeFile(OUT, html);
  console.log(`[INFO] Preview: ${OUT} (${domains.length} domains)`);
}

main().catch((err) => {
  console.error('[ERROR]', err);
  process.exit(1);
});
