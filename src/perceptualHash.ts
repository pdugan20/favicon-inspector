import sharp from 'sharp';

/**
 * Perceptual hashing for the divergence check. The pure-JS classifier
 * (analyze.ts) answers "is Google mangling the encoding?"; it cannot answer
 * "is Google serving the *right* icon?" because a stale or wrong logo is still
 * a valid, well-formed image. A perceptual hash reduces each image to a small
 * fingerprint so we can measure how far Google's cached cell has drifted from
 * the origin's intended icon.
 *
 * We rasterize with sharp (already a dependency, used by scripts/) rather than
 * the pure-JS decoders so SVG- and ICO-only origins can be compared too — those
 * decode to null in analyze.ts. Every image is flattened onto white first,
 * matching how Google's favicon service composites transparency, so a
 * transparent master and its flattened cell hash the same when the art matches.
 */

/** dHash grid: 9x8 grayscale yields 8x8 = 64 adjacency comparisons. */
const HASH_W = 9;
const HASH_H = 8;
export const HASH_BITS = (HASH_W - 1) * HASH_H; // 64

/**
 * Difference hash. Flatten onto white, desaturate, resize to a tiny fixed grid,
 * then set each bit from whether a pixel is brighter than its right neighbor.
 * Scale-invariant and tolerant of Google's re-encoding, so same-art images land
 * close and different art lands far. Returns a 16-char hex string, or null if
 * the bytes can't be rasterized.
 */
export async function perceptualHash(
  bytes: Uint8Array
): Promise<string | null> {
  try {
    const raw = await sharp(Buffer.from(bytes), { density: 256 })
      .flatten({ background: '#ffffff' })
      .greyscale()
      .resize(HASH_W, HASH_H, { fit: 'fill' })
      .raw()
      .toBuffer();
    // raw is HASH_W*HASH_H bytes, one channel per pixel, row-major.
    let bits = '';
    for (let y = 0; y < HASH_H; y++) {
      for (let x = 0; x < HASH_W - 1; x++) {
        const left = raw[y * HASH_W + x];
        const right = raw[y * HASH_W + x + 1];
        bits += left > right ? '1' : '0';
      }
    }
    return bitsToHex(bits);
  } catch {
    return null;
  }
}

function bitsToHex(bits: string): string {
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4).padEnd(4, '0'), 2).toString(16);
  }
  return hex;
}

const HEX_BITS: Record<string, number> = {
  '0': 0,
  '1': 1,
  '2': 1,
  '3': 2,
  '4': 1,
  '5': 2,
  '6': 2,
  '7': 3,
  '8': 1,
  '9': 2,
  a: 2,
  b: 3,
  c: 2,
  d: 3,
  e: 3,
  f: 4,
};

/**
 * Hamming distance between two hex hashes (number of differing bits, 0..64).
 * Throws on mismatched lengths so a comparison bug can't masquerade as a
 * suspiciously large distance.
 */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) {
    throw new Error(`hash length mismatch: ${a.length} vs ${b.length}`);
  }
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    dist += HEX_BITS[x.toString(16)];
  }
  return dist;
}
