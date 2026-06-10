import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  toDataUri,
  toJson,
  renderHtml,
  writeReports,
  type Snapshot,
} from '../report.js';

const snapshot: Snapshot = {
  capturedAt: '2026-06-09T12:00:00.000Z',
  cells: [
    {
      domain: 'rewind.rest',
      endpoint: 'faviconV2',
      size: 64,
      status: 200,
      contentType: 'image/jpeg',
      analysis: {
        format: 'jpeg',
        width: 64,
        height: 64,
        hasAlpha: false,
        cornerClass: 'OPAQUE-BLACK',
        verdict: 'ALERT',
      },
      dataUri: 'data:image/jpeg;base64,AAAA',
    },
  ],
  origins: {
    'rewind.rest': [
      {
        path: '/favicon.ico',
        source: 'well-known',
        status: 200,
        contentType: 'image/x-icon',
        analysis: { format: 'ico', cornerClass: 'UNDECODED', verdict: 'OK' },
      },
    ],
  },
};

describe('toDataUri', () => {
  it('encodes bytes as a base64 data URI', () => {
    const uri = toDataUri('image/png', new Uint8Array([1, 2, 3]));
    expect(uri).toBe('data:image/png;base64,AQID');
  });
});

describe('toJson', () => {
  it('omits dataUri from serialized cells', () => {
    const parsed = JSON.parse(toJson(snapshot));
    expect(parsed.cells[0].dataUri).toBeUndefined();
    expect(parsed.cells[0].analysis.verdict).toBe('ALERT');
    expect(parsed.capturedAt).toBe('2026-06-09T12:00:00.000Z');
  });
});

describe('writeReports', () => {
  it('writes stamped reports plus latest.json/latest.html pointers', () => {
    const dir = mkdtempSync(join(tmpdir(), 'favicon-report-'));
    try {
      const { htmlPath, jsonPath } = writeReports(snapshot, dir);
      expect(htmlPath).toBe(`${dir}/report-2026-06-09T12-00-00-000Z.html`);
      expect(readFileSync(jsonPath, 'utf8')).toBe(
        readFileSync(`${dir}/latest.json`, 'utf8')
      );
      expect(readFileSync(htmlPath, 'utf8')).toBe(
        readFileSync(`${dir}/latest.html`, 'utf8')
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('renderHtml', () => {
  it('produces an HTML document embedding the icon and its verdict', () => {
    const html = renderHtml(snapshot);
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('data:image/jpeg;base64,AAAA');
    expect(html).toContain('ALERT');
    expect(html).toContain('rewind.rest');
    expect(html).toContain('2026-06-09T12:00:00.000Z');
  });
});
