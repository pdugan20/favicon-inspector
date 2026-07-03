import { CONCURRENCY } from './config.js';
import { fetchImage, mapWithConcurrency } from './fetch.js';
import { analyzeImage, type Analysis, type CornerClass } from './analyze.js';
import { perceptualHash } from './perceptualHash.js';

export interface OriginAsset {
  path: string;
  source: 'well-known' | 'html-link' | 'manifest';
  status: number;
  contentType: string | null;
  analysis: Analysis;
  /** Perceptual hash for the divergence check; absent if it couldn't rasterize. */
  pHash?: string;
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

function dedupeByUrl<T extends { url: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (!seen.has(item.url)) {
      seen.add(item.url);
      out.push(item);
    }
  }
  return out;
}

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

  const unique = dedupeByUrl(targets);

  return mapWithConcurrency(unique, CONCURRENCY, async (t) => {
    const r = await fetchImage(t.url);
    const analysis = r.bytes ? analyzeImage(r.bytes) : UNDECODED;
    const pHash = r.bytes ? await perceptualHash(r.bytes) : null;
    return {
      path: new URL(t.url).pathname,
      source: t.source,
      status: r.status,
      contentType: r.contentType,
      analysis,
      ...(pHash ? { pHash } : {}),
    };
  });
}
