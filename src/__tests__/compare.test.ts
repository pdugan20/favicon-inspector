import { describe, it, expect } from 'vitest';
import { cellKey, diffSnapshots } from '../compare.js';
import type { Snapshot } from '../report.js';

function snap(
  verdict: 'ALERT' | 'OK',
  format: 'jpeg' | 'png',
  corner: string
): Snapshot {
  return {
    capturedAt: '2026-06-09T12:00:00.000Z',
    cells: [
      {
        domain: 'rewind.rest',
        endpoint: 'faviconV2',
        size: 64,
        status: 200,
        contentType: null,
        analysis: {
          format,
          cornerClass: corner as never,
          verdict,
        },
      },
    ],
    origins: {},
  };
}

describe('cellKey', () => {
  it('joins domain, endpoint, size', () => {
    expect(
      cellKey({ domain: 'rewind.rest', endpoint: 'faviconV2', size: 64 })
    ).toBe('rewind.rest|faviconV2|64');
  });
});

describe('diffSnapshots', () => {
  it('reports cells whose format/corner/verdict changed', () => {
    const before = snap('ALERT', 'jpeg', 'OPAQUE-BLACK');
    const after = snap('OK', 'png', 'TRANSPARENT');
    const diffs = diffSnapshots(before, after);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].key).toBe('rewind.rest|faviconV2|64');
    expect(diffs[0].before.verdict).toBe('ALERT');
    expect(diffs[0].after.verdict).toBe('OK');
  });

  it('reports nothing when unchanged', () => {
    const before = snap('ALERT', 'jpeg', 'OPAQUE-BLACK');
    const after = snap('ALERT', 'jpeg', 'OPAQUE-BLACK');
    expect(diffSnapshots(before, after)).toEqual([]);
  });
});
