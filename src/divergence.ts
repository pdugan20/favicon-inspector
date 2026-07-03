import type { Endpoint } from './config.js';
import type { OriginAsset } from './origin.js';
import { hammingDistance, HASH_BITS } from './perceptualHash.js';

/**
 * Wrong-icon / stale-cache detection. The pixel classifier (analyze.ts) proves
 * Google returned a well-formed, correctly-encoded image — but not that it is
 * the *current, correct* logo. A domain whose origin has been fixed can still
 * have Google serving a months-old cached design, and that stale image passes
 * every encoding check. This compares a perceptual hash of each Google cell to
 * the origin's intended icon and flags cells that have drifted too far.
 *
 * Empirically (see the calibration in the PR that added this): same-art cells
 * land within ~11/64 bits of the origin master even after Google's re-encoding,
 * while a genuinely different logo (clickwheel.fm's stale iPod icon vs the CW
 * wordmark origin) sits at ~35/64. The default threshold splits that gap.
 *
 * This catches wholesale wrong-logo drift reliably. It is deliberately not
 * sensitive to subtle recolors (a difference hash keys on luminance structure),
 * so a same-shape re-tint may slip under the threshold — hence WARN, not ALERT.
 */

export interface DivergenceFinding {
  domain: string;
  endpoint: Endpoint;
  code: 'ICON_DIVERGENCE';
  severity: 'WARN';
  /** Perceptual-hash Hamming distance, 0..64. */
  distance: number;
  /** Origin asset used as the reference icon. */
  masterPath: string;
  message: string;
}

/** A probed cell carries an optional perceptual hash added at capture time. */
export interface HashedCell {
  domain: string;
  endpoint: Endpoint;
  size: number;
  status: number;
  pHash?: string;
}

/**
 * Distance at/above which a cell is treated as a different image. Sits in the
 * empirical gap between same-art (<=~11) and wrong-art (~35) drift. Exported so
 * callers/tests can reason about it; the runtime value comes from config.
 */
export const DEFAULT_DIVERGENCE_THRESHOLD = 20;

/**
 * Rank an origin asset's suitability as the reference icon. Lower is better.
 * Prefer the canonical tab favicon over an apple-touch, because a site can ship
 * a stale or off-brand apple-touch (next-up.app did) that must not become the
 * yardstick everything else is measured against.
 */
function masterRank(asset: OriginAsset): number {
  const path = asset.path.toLowerCase();
  const isApple = /apple-(touch-)?icon/.test(path);
  if (isApple) return 90;
  if (asset.source === 'manifest') return 50;
  if (path.endsWith('/favicon.svg')) return 0;
  if (path.endsWith('.svg')) return 5;
  if (asset.source === 'html-link') return 10;
  if (path.endsWith('/favicon.ico')) return 20;
  return 30;
}

/**
 * Choose the reference icon for a domain: the highest-ranked reachable origin
 * asset that actually produced a perceptual hash. Returns null when nothing at
 * the origin can be hashed (e.g. every asset 404s), in which case there is no
 * honest baseline and the domain is skipped rather than guessed at.
 */
export function selectMaster(
  assets: (OriginAsset & { pHash?: string })[]
): (OriginAsset & { pHash: string }) | null {
  const candidates = assets
    .filter((a) => a.status === 200 && typeof a.pHash === 'string')
    .sort((a, b) => masterRank(a) - masterRank(b));
  return (
    (candidates[0] as (OriginAsset & { pHash: string }) | undefined) ?? null
  );
}

/** The largest reachable, hashed cell for an endpoint — the clearest sample. */
function representativeCell(cells: HashedCell[]): HashedCell | null {
  const usable = cells.filter((c) => c.status === 200 && c.pHash);
  if (usable.length === 0) return null;
  return usable.reduce((best, c) => (c.size > best.size ? c : best));
}

export function deriveDivergences(
  cells: HashedCell[],
  origins: Record<string, (OriginAsset & { pHash?: string })[]>,
  threshold: number = DEFAULT_DIVERGENCE_THRESHOLD
): Record<string, DivergenceFinding[]> {
  const out: Record<string, DivergenceFinding[]> = {};
  const domains = [...new Set(cells.map((c) => c.domain))];

  for (const domain of domains) {
    const master = selectMaster(origins[domain] ?? []);
    if (!master) continue; // no hashable origin baseline; can't compare

    const findings: DivergenceFinding[] = [];
    const endpoints = [
      ...new Set(
        cells.filter((c) => c.domain === domain).map((c) => c.endpoint)
      ),
    ];
    for (const endpoint of endpoints) {
      const cell = representativeCell(
        cells.filter((c) => c.domain === domain && c.endpoint === endpoint)
      );
      if (!cell?.pHash) continue;
      const distance = hammingDistance(master.pHash, cell.pHash);
      if (distance >= threshold) {
        findings.push({
          domain,
          endpoint,
          code: 'ICON_DIVERGENCE',
          severity: 'WARN',
          distance,
          masterPath: master.path,
          message: `Google's ${endpoint} icon differs from the origin ${master.path} (perceptual distance ${distance}/${HASH_BITS}); the cached favicon is likely stale or a wrong/old logo. Origin looks correct — wait for Google to re-crawl, or verify the origin serves the intended art.`,
        });
      }
    }
    if (findings.length > 0) out[domain] = findings;
  }
  return out;
}
