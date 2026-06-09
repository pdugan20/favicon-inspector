import { describe, it, expect } from 'vitest';
import { Buffer } from 'node:buffer';
import { analyzeImage } from '../analyze';

// A 4x4 indexed-color (palette) PNG where every pixel uses palette index 0,
// and index 0 is transparent via a tRNS chunk. fast-png decodes this as
// channels:1 with a separate `palette` array, where the raw pixel data holds
// palette indices, not colors. The decoder must map indices through the
// palette; treating the index (0) as a grayscale value yields a false
// OPAQUE-BLACK. Google's faviconV2 returns indexed PNGs like this.
const PALETTE_PNG_TRANSPARENT_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAEAgMAAADUn3btAAAACVBMVEVHcEz/AAAAAADyr6JfAAAAAXRSTlMAQObYZgAAAAtJREFUeJxjYIAAAAAIAAG3WHOVAAAAAElFTkSuQmCC';

describe('analyzeImage with indexed-color (palette) PNGs', () => {
  it('maps palette indices through the palette instead of reading them as grayscale', () => {
    const bytes = new Uint8Array(
      Buffer.from(PALETTE_PNG_TRANSPARENT_B64, 'base64')
    );
    const a = analyzeImage(bytes);
    expect(a.format).toBe('png');
    // index 0 -> palette entry with alpha 0 -> transparent corners,
    // NOT a false OPAQUE-BLACK from reading the index as a gray value.
    expect(a.cornerClass).toBe('TRANSPARENT');
    expect(a.hasAlpha).toBe(true);
    expect(a.verdict).toBe('OK');
  });
});
