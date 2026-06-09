import { describe, it, expect } from 'vitest';
import { sniffFormat } from '../analyze';

describe('sniffFormat', () => {
  it('detects PNG by signature', () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0,
    ]);
    expect(sniffFormat(png)).toBe('png');
  });

  it('detects JPEG by signature', () => {
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
    expect(sniffFormat(jpg)).toBe('jpeg');
  });

  it('detects ICO by signature', () => {
    const ico = new Uint8Array([0x00, 0x00, 0x01, 0x00, 0, 0]);
    expect(sniffFormat(ico)).toBe('ico');
  });

  it('detects SVG by markup', () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    );
    expect(sniffFormat(svg)).toBe('svg');
  });

  it('returns unknown for unrecognized bytes', () => {
    expect(sniffFormat(new Uint8Array([1, 2, 3, 4]))).toBe('unknown');
  });
});
