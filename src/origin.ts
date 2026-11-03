import { CONCURRENCY, MAX_DOCUMENT_BYTES, MAX_ORIGIN_ICONS } from './config.js';
import { fetchImage, fetchResource, mapWithConcurrency } from './fetch.js';
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

function* linkTags(html: string): Generator<string> {
  // Do not scan across another '<': repeated unterminated tags stay linear.
  const tagRe = /<link\b[^<>]*>/gi;
  for (const match of html.matchAll(tagRe)) yield match[0];
}

function* iconLinks(html: string): Generator<DeclaredIcon> {
  for (const tag of linkTags(html)) {
    const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? '';
    if (!/icon/i.test(rel)) continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    if (href) yield { href, rel: rel.toLowerCase() };
  }
}

export function extractIconLinks(html: string): DeclaredIcon[] {
  return [...iconLinks(html)];
}

export function extractManifestHref(html: string): string | null {
  for (const tag of linkTags(html)) {
    const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? '';
    if (rel.toLowerCase() !== 'manifest') continue;
    return /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? null;
  }
  return null;
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
  const seen = new Set(targets.map((target) => target.url));
  const add = (href: unknown, base: string, source: OriginAsset['source']) => {
    if (
      typeof href !== 'string' ||
      targets.length >= WELL_KNOWN.length + MAX_ORIGIN_ICONS
    )
      return;
    try {
      const url = new URL(href, base);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        seen.has(url.href)
      )
        return;
      seen.add(url.href);
      targets.push({ url: url.href, source });
    } catch {
      /* skip invalid declarations without losing subsequent valid icons */
    }
  };

  try {
    const res = await fetchResource(base, undefined, MAX_DOCUMENT_BYTES);
    if (!res.bytes) throw new Error('Origin unavailable');
    const html = new TextDecoder().decode(res.bytes);
    const documentUrl = res.url;
    for (const link of iconLinks(html)) {
      add(link.href, documentUrl, 'html-link');
      if (targets.length >= WELL_KNOWN.length + MAX_ORIGIN_ICONS) break;
    }
    const manifestHref = extractManifestHref(html);
    if (manifestHref) {
      try {
        const manifestUrl = new URL(manifestHref, documentUrl).toString();
        const mres = await fetchResource(
          manifestUrl,
          undefined,
          MAX_DOCUMENT_BYTES
        );
        if (!mres.bytes) throw new Error('Manifest unavailable');
        const manifest = JSON.parse(new TextDecoder().decode(mres.bytes)) as {
          icons?: { src: string }[];
        };
        for (const icon of Array.isArray(manifest.icons)
          ? manifest.icons
          : []) {
          add(icon?.src, mres.url, 'manifest');
          if (targets.length >= WELL_KNOWN.length + MAX_ORIGIN_ICONS) break;
        }
      } catch {
        // manifest missing or unparseable; skip
      }
    }
  } catch {
    // homepage unreachable; fall back to well-known paths only
  }

  return mapWithConcurrency(targets, CONCURRENCY, async (t) => {
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
