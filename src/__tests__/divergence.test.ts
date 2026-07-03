import { describe, it, expect } from 'vitest';
import { deriveDivergences, selectMaster } from '../divergence.js';
import type { HashedCell } from '../divergence.js';
import type { OriginAsset } from '../origin.js';

const ZERO = '0000000000000000'; // 64 bits, all clear
const NEAR = '0000000000000001'; // distance 1 from ZERO
const FAR = 'ffffff0000000000'; // 24 set bits -> distance 24 from ZERO

function master(
  path: string,
  pHash: string | undefined,
  opts: { source?: OriginAsset['source']; status?: number } = {}
): OriginAsset & { pHash?: string } {
  return {
    path,
    source: opts.source ?? 'well-known',
    status: opts.status ?? 200,
    contentType: null,
    analysis: { format: 'png', cornerClass: 'UNDECODED', verdict: 'OK' },
    ...(pHash ? { pHash } : {}),
  };
}

function cell(
  domain: string,
  endpoint: 'faviconV2' | 's2',
  size: number,
  pHash?: string,
  status = 200
): HashedCell {
  return { domain, endpoint, size, status, ...(pHash ? { pHash } : {}) };
}

describe('selectMaster', () => {
  it('prefers the canonical favicon over an off-brand apple-touch', () => {
    const chosen = selectMaster([
      master('/apple-touch-icon.png', 'aaaa000000000000'),
      master('/favicon.svg', ZERO),
    ]);
    expect(chosen?.path).toBe('/favicon.svg');
  });

  it('skips assets that did not hash or are unreachable', () => {
    const chosen = selectMaster([
      master('/favicon.svg', undefined), // could not rasterize
      master('/favicon.ico', ZERO, { status: 404 }), // unreachable
      master('/icon.png', NEAR, { source: 'html-link' }),
    ]);
    expect(chosen?.path).toBe('/icon.png');
  });

  it('returns null when nothing at the origin can be hashed', () => {
    expect(selectMaster([master('/favicon.svg', undefined)])).toBeNull();
  });
});

describe('deriveDivergences', () => {
  const origins = { 'a.com': [master('/favicon.svg', ZERO)] };

  it('flags an endpoint whose cached icon has drifted past the threshold', () => {
    const cells = [
      cell('a.com', 'faviconV2', 256, NEAR), // matches
      cell('a.com', 's2', 256, FAR), // stale/wrong logo
    ];
    const out = deriveDivergences(cells, origins, 20);
    expect(out['a.com']).toHaveLength(1);
    expect(out['a.com'][0].endpoint).toBe('s2');
    expect(out['a.com'][0].distance).toBe(24);
  });

  it('does not flag when every endpoint matches the origin', () => {
    const cells = [
      cell('a.com', 'faviconV2', 256, NEAR),
      cell('a.com', 's2', 256, ZERO),
    ];
    expect(deriveDivergences(cells, origins, 20)['a.com']).toBeUndefined();
  });

  it('uses the largest reachable cell as the representative sample', () => {
    const cells = [
      cell('a.com', 'faviconV2', 16, ZERO), // small, matches
      cell('a.com', 'faviconV2', 256, FAR), // largest, diverges
    ];
    expect(deriveDivergences(cells, origins, 20)['a.com']).toHaveLength(1);
  });

  it('skips a domain with no hashable origin master rather than guessing', () => {
    const noMaster = { 'b.com': [master('/favicon.svg', undefined)] };
    const cells = [cell('b.com', 'faviconV2', 256, FAR)];
    expect(deriveDivergences(cells, noMaster, 20)).toEqual({});
  });
});
