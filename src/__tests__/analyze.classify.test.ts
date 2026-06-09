import { describe, it, expect } from 'vitest';
import { classifyCorners, verdictFor, type Rgba } from '../analyze';

function solid(r: number, g: number, b: number, a: number): Rgba {
  const w = 4;
  const h = 4;
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = a;
  }
  return { width: w, height: h, data };
}

describe('classifyCorners', () => {
  it('classifies fully transparent corners as TRANSPARENT', () => {
    expect(classifyCorners(solid(0, 0, 0, 0))).toBe('TRANSPARENT');
  });

  it('classifies opaque near-black corners as OPAQUE-BLACK', () => {
    expect(classifyCorners(solid(2, 1, 3, 255))).toBe('OPAQUE-BLACK');
  });

  it('classifies opaque near-white corners as OPAQUE-WHITE', () => {
    expect(classifyCorners(solid(255, 254, 250, 255))).toBe('OPAQUE-WHITE');
  });

  it('classifies other opaque colors as OPAQUE-OTHER with hex', () => {
    expect(classifyCorners(solid(0x5d, 0x6d, 0xdf, 255))).toBe(
      'OPAQUE-OTHER(#5d6ddf)'
    );
  });
});

describe('verdictFor', () => {
  it('ALERTs on JPEG with black background', () => {
    expect(verdictFor('jpeg', 'OPAQUE-BLACK')).toBe('ALERT');
  });

  it('WARNs on JPEG with non-black background', () => {
    expect(verdictFor('jpeg', 'OPAQUE-WHITE')).toBe('WARN');
  });

  it('is OK for transparent PNG', () => {
    expect(verdictFor('png', 'TRANSPARENT')).toBe('OK');
  });

  it('suppresses the black-JPEG ALERT to WARN when opaque is expected', () => {
    expect(verdictFor('jpeg', 'OPAQUE-BLACK', 'opaque')).toBe('WARN');
  });
});
