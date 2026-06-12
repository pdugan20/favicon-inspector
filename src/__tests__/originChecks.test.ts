import { describe, it, expect } from 'vitest';
import { deriveOriginFindings } from '../originChecks.js';
import type { OriginAsset } from '../origin.js';
import type { Analysis, CornerClass, ImageFormat } from '../analyze.js';

function asset(
  path: string,
  format: ImageFormat,
  opts: {
    status?: number;
    width?: number;
    height?: number;
    cornerClass?: CornerClass;
  } = {}
): OriginAsset {
  const analysis: Analysis = {
    format,
    width: opts.width,
    height: opts.height,
    cornerClass: opts.cornerClass ?? 'UNDECODED',
    verdict: 'OK',
  };
  return {
    path,
    source: 'well-known',
    status: opts.status ?? 200,
    contentType: null,
    analysis,
  };
}

describe('deriveOriginFindings', () => {
  it('flags a transparent apple-touch-icon (rewind.rest case)', () => {
    const findings = deriveOriginFindings('rewind.rest', [
      asset('/apple-touch-icon.png', 'png', {
        width: 180,
        height: 180,
        cornerClass: 'TRANSPARENT',
      }),
      asset('/favicon.svg', 'svg', { width: 24, height: 24 }),
    ]);
    expect(findings.map((f) => f.code)).toContain('APPLE_TOUCH_TRANSPARENT');
  });

  it('flags a non-square master but not a missing apple-touch (getbiblio.app case)', () => {
    const findings = deriveOriginFindings('getbiblio.app', [
      asset('/favicon.ico', 'ico'),
      asset('/favicon.svg', 'svg', { width: 65, height: 81 }),
      asset('/apple-touch-icon.png', 'unknown', { status: 404 }),
    ]);
    const codes = findings.map((f) => f.code);
    expect(codes).toContain('NON_SQUARE_MASTER');
    // A missing apple-touch is the recommended state, not a finding.
    expect(codes).not.toContain('APPLE_TOUCH_TRANSPARENT');
  });

  it('recognizes the Next.js apple-icon name and flags it when transparent', () => {
    const findings = deriveOriginFindings('next-up.app', [
      asset('/icon.png', 'png', {
        width: 512,
        height: 512,
        cornerClass: 'TRANSPARENT',
      }),
      asset('/apple-icon.png', 'png', {
        width: 180,
        height: 180,
        cornerClass: 'TRANSPARENT',
      }),
    ]);
    expect(findings.map((f) => f.code)).toContain('APPLE_TOUCH_TRANSPARENT');
  });

  it('flags a small raster-only master with no SVG fallback', () => {
    const findings = deriveOriginFindings('tiny.example', [
      asset('/favicon.ico', 'ico'),
      asset('/apple-touch-icon.png', 'png', {
        width: 32,
        height: 32,
        cornerClass: 'OPAQUE-WHITE',
      }),
    ]);
    expect(findings.map((f) => f.code)).toContain('SMALL_MASTER');
  });

  it('does not flag SMALL_MASTER when an SVG master exists', () => {
    const findings = deriveOriginFindings('vector.example', [
      asset('/favicon.svg', 'svg', { width: 48, height: 48 }),
      asset('/apple-touch-icon.png', 'png', {
        width: 64,
        height: 64,
        cornerClass: 'OPAQUE-WHITE',
      }),
    ]);
    expect(findings.map((f) => f.code)).not.toContain('SMALL_MASTER');
  });

  it('clean origin with an opaque square apple-touch yields no findings', () => {
    const findings = deriveOriginFindings('clean.example', [
      asset('/favicon.svg', 'svg', { width: 512, height: 512 }),
      asset('/apple-touch-icon.png', 'png', {
        width: 180,
        height: 180,
        cornerClass: 'OPAQUE-WHITE',
      }),
    ]);
    expect(findings).toEqual([]);
  });

  it('returns nothing when the origin is unreachable', () => {
    const findings = deriveOriginFindings('down.example', [
      asset('/favicon.ico', 'unknown', { status: 0 }),
      asset('/favicon.svg', 'unknown', { status: 522 }),
    ]);
    expect(findings).toEqual([]);
  });
});
