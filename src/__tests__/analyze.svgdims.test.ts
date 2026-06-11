import { describe, it, expect } from 'vitest';
import { svgDimensions, analyzeImage } from '../analyze.js';

const enc = (s: string) => new TextEncoder().encode(s);

describe('svgDimensions', () => {
  it('reads explicit width and height attributes', () => {
    expect(svgDimensions(enc('<svg width="65" height="81"></svg>'))).toEqual({
      width: 65,
      height: 81,
    });
  });

  it('falls back to the viewBox extents', () => {
    expect(
      svgDimensions(enc('<svg viewBox="0 0 24 24" fill="none"></svg>'))
    ).toEqual({ width: 24, height: 24 });
  });

  it('ignores percentage width and uses the viewBox', () => {
    expect(
      svgDimensions(enc('<svg width="100%" height="100%" viewBox="0 0 48 60">'))
    ).toEqual({ width: 48, height: 60 });
  });

  it('returns empty when no dimensions are present', () => {
    expect(svgDimensions(enc('<svg xmlns="http://x"></svg>'))).toEqual({});
  });
});

describe('analyzeImage on SVG', () => {
  it('populates width/height for a non-square SVG master', () => {
    const a = analyzeImage(enc('<svg width="65" height="81"></svg>'));
    expect(a.format).toBe('svg');
    expect(a.width).toBe(65);
    expect(a.height).toBe(81);
    expect(a.cornerClass).toBe('UNDECODED');
  });
});
