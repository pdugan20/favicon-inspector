import { describe, it, expect } from 'vitest';
import { encode as encodePng } from 'fast-png';
import * as jpeg from 'jpeg-js';
import { analyzeImage } from '../analyze.js';

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
