import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  perceptualHash,
  hammingDistance,
  HASH_BITS,
} from '../perceptualHash.js';

/** A 2x1 image: one pixel white, the other black. */
async function splitImage(leftWhite: boolean): Promise<Uint8Array> {
  const l = leftWhite ? 255 : 0;
  const r = leftWhite ? 0 : 255;
  const buf = await sharp(Buffer.from([l, l, l, r, r, r]), {
    raw: { width: 2, height: 1, channels: 3 },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buf);
}

describe('perceptualHash', () => {
  it('hashes identical art to distance 0', async () => {
    const a = await perceptualHash(await splitImage(true));
    const b = await perceptualHash(await splitImage(true));
    expect(a).not.toBeNull();
    expect(hammingDistance(a!, b!)).toBe(0);
  });

  it('separates opposite art by a large distance', async () => {
    const white = await perceptualHash(await splitImage(true));
    const black = await perceptualHash(await splitImage(false));
    expect(hammingDistance(white!, black!)).toBeGreaterThan(HASH_BITS / 2);
  });

  it('returns null for bytes it cannot rasterize', async () => {
    expect(
      await perceptualHash(new TextEncoder().encode('<!doctype html>'))
    ).toBeNull();
  });
});

describe('hammingDistance', () => {
  it('counts differing bits', () => {
    expect(hammingDistance('0000', '0000')).toBe(0);
    expect(hammingDistance('0000', '000f')).toBe(4);
    expect(hammingDistance('00ff', 'ff00')).toBe(16);
  });

  it('throws on length mismatch rather than reporting a bogus distance', () => {
    expect(() => hammingDistance('00', '0000')).toThrow(/length mismatch/);
  });
});
