/**
 * Generate a Google-correct favicon set for each configured domain.
 *
 * Recipe (see docs/favicon-findings.md):
 *  - Tab icons (favicon.ico/.svg/16/32/48/96 + android-chrome rel=icon) come
 *    from a transparent master, letterboxed into a square so non-square or
 *    small sources are never stretched/upscaled into distortion.
 *  - apple-touch-icon and the maskable icon come from a separate, full-bleed
 *    OPAQUE tile the user supplies per domain (scripts/masters/<domain>.tile.
 *    png|svg). They are emitted edge-to-edge — no padding, no white box — and
 *    being opaque they can't be re-encoded onto black. Domains without a tile
 *    simply skip those two slots rather than emit a white square.
 *
 * Output goes to generated/<domain>/ with a head.html link snippet.
 *
 * Run: npm run favicons:generate
 */
import favicons from 'favicons';
import sharp from 'sharp';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const MASTER_SIZE = 512;
const OPAQUE_BG = '#ffffff';
const MASTERS_DIR = path.join('scripts', 'masters');

type MasterSource =
  | { kind: 'url'; url: string }
  | { kind: 'file'; file: string };

interface DomainSpec {
  domain: string;
  /** Transparent source for the tab icons. */
  master: MasterSource;
  /** Context surfaced in logs (e.g. why the master lives elsewhere). */
  note?: string;
}

/**
 * One transparent master per domain for the tab icons. SVG masters rasterize
 * crisply at any size; raster masters should already be large and square.
 * The opaque apple-touch/maskable tile is discovered separately from
 * scripts/masters/<domain>.tile.png|svg.
 */
const DOMAINS: DomainSpec[] = [
  {
    domain: 'rewind.rest',
    master: { kind: 'url', url: 'https://rewind.rest/favicon.svg' },
  },
  {
    domain: 'getbiblio.app',
    master: { kind: 'url', url: 'https://getbiblio.app/favicon.svg' },
  },
  {
    domain: 'next-up.app',
    master: { kind: 'url', url: 'https://next-up.app/icon.png' },
  },
  {
    domain: 'patdugan.me',
    master: { kind: 'url', url: 'https://pdugan.com/favicon.svg' },
    note: 'patdugan.me redirects its asset paths to pdugan.com; master pulled from there.',
  },
  {
    domain: 'clickwheel.fm',
    master: {
      kind: 'url',
      url: 'https://clickwheel.fm/mintlify-assets/_mintlify/favicons/clickwheel/CuRoBSRv4zW_iFoj/_generated/favicon/android-chrome-192x192.png',
    },
    note: 'No SVG/large master at origin; tab icons built from the 192px Mintlify PNG.',
  },
];

/** Detect an SVG payload so we can pass the vector tab icon through. */
function isSvg(bytes: Buffer): boolean {
  const head = bytes.subarray(0, 256).toString('utf8').toLowerCase();
  return head.includes('<svg') || head.includes('<?xml');
}

async function loadMasterBytes(src: MasterSource): Promise<Buffer | null> {
  if (src.kind === 'file') {
    if (!existsSync(src.file)) return null;
    return readFile(src.file);
  }
  const res = await fetch(src.url, { redirect: 'follow' });
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

/** The opaque tile a user dropped in for this domain, if any. */
function tileFileFor(domain: string): string | null {
  for (const ext of ['png', 'svg']) {
    const file = path.join(MASTERS_DIR, `${domain}.tile.${ext}`);
    if (existsSync(file)) return file;
  }
  return null;
}

/**
 * Letterbox the master into a square transparent PNG. Rendering SVG at a
 * high density first keeps small-viewBox sources sharp after the resize.
 */
async function toSquareMaster(bytes: Buffer): Promise<Buffer> {
  return sharp(bytes, { density: 1024 })
    .resize(MASTER_SIZE, MASTER_SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

/**
 * Square, fully opaque, edge-to-edge tile for the apple-touch/maskable slots.
 * `cover` fills the square (cropping any overflow); any stray edge alpha is
 * flattened onto the tile's own dominant color (not white) so the icon stays
 * on-brand to the edges and nothing can be re-encoded onto black.
 */
async function toOpaqueTile(bytes: Buffer): Promise<Buffer> {
  const { dominant } = await sharp(bytes, { density: 1024 }).stats();
  return sharp(bytes, { density: 1024 })
    .resize(MASTER_SIZE, MASTER_SIZE, { fit: 'cover' })
    .flatten({ background: dominant })
    .png()
    .toBuffer();
}

async function generate(spec: DomainSpec): Promise<boolean> {
  const bytes = await loadMasterBytes(spec.master);
  if (!bytes) {
    const where =
      spec.master.kind === 'url' ? spec.master.url : spec.master.file;
    console.error(`[SKIP] ${spec.domain}: master unavailable (${where})`);
    if (spec.note) console.error(`       ${spec.note}`);
    return false;
  }

  const tilePath = tileFileFor(spec.domain);
  const tileBytes = tilePath ? await readFile(tilePath) : null;
  const tile = tileBytes ? await toOpaqueTile(tileBytes) : null;

  // Tab icons + android rel=icon + manifest from the transparent master.
  // The maskable icon (if a tile exists) is sourced from the opaque tile.
  const tabRun = await favicons(await toSquareMaster(bytes), {
    path: '/',
    appName: spec.domain,
    appShortName: spec.domain,
    background: OPAQUE_BG,
    theme_color: OPAQUE_BG,
    ...(tile ? { manifestMaskable: tile } : {}),
    icons: {
      favicons: true, // favicon.ico + favicon-16/32/48 (transparent)
      android: true, // android-chrome rel=icon (transparent) + maskable
      appleIcon: false, // built from the tile below instead
      appleStartup: false,
      windows: false,
      yandex: false,
    },
  });

  const images = [...tabRun.images];
  const html = [...tabRun.html];

  // apple-touch-icon from the opaque tile, edge-to-edge (no white box).
  if (tile) {
    const appleRun = await favicons(tile, {
      path: '/',
      icons: {
        favicons: false,
        android: false,
        appleIcon: true,
        appleStartup: false,
        windows: false,
        yandex: false,
      },
    });
    images.push(...appleRun.images);
    html.push(...appleRun.html.filter((h) => /apple-touch-icon/.test(h)));
  }

  const outDir = path.join('generated', spec.domain);
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  for (const img of images)
    await writeFile(path.join(outDir, img.name), img.contents);
  for (const file of tabRun.files)
    await writeFile(path.join(outDir, file.name), file.contents);

  // Pass a vector master through as favicon.svg so the crisp tab icon
  // survives a wholesale deploy, advertised with the modern rel=icon tag.
  const headHtml = [...html];
  if (isSvg(bytes)) {
    await writeFile(path.join(outDir, 'favicon.svg'), bytes);
    headHtml.unshift(
      '<link rel="icon" type="image/svg+xml" href="/favicon.svg">'
    );
  }
  await writeFile(path.join(outDir, 'head.html'), headHtml.join('\n') + '\n');

  const tileNote = tile
    ? `tile: ${tilePath}`
    : 'no tile (apple-touch/maskable skipped)';
  console.log(
    `[OK]   ${spec.domain}: ${images.length} images -> ${outDir}/  (${tileNote})`
  );
  if (spec.note) console.log(`       ${spec.note}`);
  return true;
}

async function main(): Promise<void> {
  console.log(`[INFO] Generating favicon sets for ${DOMAINS.length} domains`);
  let ok = 0;
  for (const spec of DOMAINS) {
    if (await generate(spec)) ok++;
  }
  console.log(`[INFO] Done: ${ok}/${DOMAINS.length} generated`);
}

main().catch((err) => {
  console.error('[ERROR]', err);
  process.exit(1);
});
