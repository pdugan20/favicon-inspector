import { mkdirSync, writeFileSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import type { Endpoint } from './config.js';
import type { Analysis, Verdict } from './analyze.js';
import type { OriginAsset } from './origin.js';

export interface Cell {
  domain: string;
  endpoint: Endpoint;
  size: number;
  status: number;
  contentType: string | null;
  error?: string;
  analysis: Analysis;
  dataUri?: string;
}

export interface Snapshot {
  capturedAt: string;
  cells: Cell[];
  origins: Record<string, OriginAsset[]>;
}

export function toDataUri(
  contentType: string | null,
  bytes: Uint8Array
): string {
  const b64 = Buffer.from(bytes).toString('base64');
  return `data:${contentType ?? 'application/octet-stream'};base64,${b64}`;
}

export function toJson(snapshot: Snapshot): string {
  const cells = snapshot.cells.map(({ dataUri: _dataUri, ...rest }) => rest);
  return JSON.stringify(
    { capturedAt: snapshot.capturedAt, cells, origins: snapshot.origins },
    null,
    2
  );
}

const VERDICT_COLOR: Record<Verdict, string> = {
  OK: '#1a7f37',
  WARN: '#9a6700',
  ALERT: '#cf222e',
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function cellHtml(cell: Cell): string {
  const a = cell.analysis;
  const color = VERDICT_COLOR[a.verdict];
  const img = cell.dataUri
    ? `<img src="${cell.dataUri}" width="48" height="48" alt="">`
    : `<div class="missing">${cell.status || 'ERR'}</div>`;
  const diag = `${a.format} · ${a.hasAlpha ? 'alpha' : 'no-alpha'} · ${escapeHtml(a.cornerClass)}`;
  return `
    <td>
      <div class="cell">
        <div class="chk">${img}</div>
        <div class="diag">${diag}</div>
        <div class="verdict" style="color:${color}">${a.verdict}</div>
      </div>
    </td>`;
}

function originPanel(origins: Snapshot['origins']): string {
  const rows: string[] = [];
  for (const [domain, assets] of Object.entries(origins)) {
    for (const asset of assets) {
      rows.push(`
        <tr>
          <td>${escapeHtml(domain)}</td>
          <td>${escapeHtml(asset.path)}</td>
          <td>${asset.source}</td>
          <td>${asset.status}</td>
          <td>${escapeHtml(asset.contentType ?? '')}</td>
          <td>${asset.analysis.format} · ${escapeHtml(asset.analysis.cornerClass)}</td>
        </tr>`);
    }
  }
  return `
    <h2>Origin assets</h2>
    <table class="origin">
      <tr><th>Domain</th><th>Path</th><th>Source</th><th>Status</th><th>Content-Type</th><th>Analysis</th></tr>
      ${rows.join('')}
    </table>`;
}

function matrixTables(cells: Cell[]): string {
  const domains = [...new Set(cells.map((c) => c.domain))];
  const endpoints = [...new Set(cells.map((c) => c.endpoint))];
  const sizes = [...new Set(cells.map((c) => c.size))].sort((a, b) => a - b);
  const blocks: string[] = [];
  for (const domain of domains) {
    for (const endpoint of endpoints) {
      const rows = sizes
        .map((size) => {
          const cell = cells.find(
            (c) =>
              c.domain === domain && c.endpoint === endpoint && c.size === size
          );
          const body = cell
            ? cellHtml(cell)
            : '<td><div class="cell missing">-</div></td>';
          return `<tr><th>${size}px</th>${body}</tr>`;
        })
        .join('');
      blocks.push(`
        <div class="block">
          <h3>${escapeHtml(domain)} — ${endpoint}</h3>
          <table class="matrix">${rows}</table>
        </div>`);
    }
  }
  return blocks.join('');
}

export function renderHtml(snapshot: Snapshot): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>favicon-inspector — ${snapshot.capturedAt}</title>
<style>
  body { font: 13px/1.4 -apple-system, system-ui, sans-serif; margin: 24px; color: #1f2328; }
  h1 { font-size: 18px; }
  .meta { color: #57606a; margin-bottom: 16px; }
  .blocks { display: flex; flex-wrap: wrap; gap: 20px; }
  .block { border: 1px solid #d0d7de; border-radius: 8px; padding: 12px; }
  .block h3 { margin: 0 0 8px; font-size: 13px; }
  table.matrix th { text-align: right; padding-right: 8px; color: #57606a; font-weight: 500; }
  .cell { width: 120px; padding: 6px 0; }
  .chk {
    display: inline-block;
    background-image:
      linear-gradient(45deg, #ccc 25%, transparent 25%),
      linear-gradient(-45deg, #ccc 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #ccc 75%),
      linear-gradient(-45deg, transparent 75%, #ccc 75%);
    background-size: 12px 12px;
    background-position: 0 0, 0 6px, 6px -6px, -6px 0;
    padding: 4px;
    border: 1px solid #d0d7de;
  }
  .diag { color: #57606a; font-size: 11px; margin-top: 4px; }
  .verdict { font-weight: 600; font-size: 12px; }
  .missing { color: #57606a; }
  table.origin { border-collapse: collapse; margin-top: 8px; }
  table.origin th, table.origin td { border: 1px solid #d0d7de; padding: 4px 8px; text-align: left; }
</style>
</head>
<body>
  <h1>favicon-inspector</h1>
  <div class="meta">Captured ${snapshot.capturedAt}</div>
  ${originPanel(snapshot.origins)}
  <h2>Google favicon matrix</h2>
  <div class="blocks">${matrixTables(snapshot.cells)}</div>
</body>
</html>`;
}

export function writeReports(
  snapshot: Snapshot,
  outDir = 'reports'
): { htmlPath: string; jsonPath: string } {
  mkdirSync(outDir, { recursive: true });
  const stamp = snapshot.capturedAt.replace(/[:.]/g, '-');
  const htmlPath = `${outDir}/report-${stamp}.html`;
  const jsonPath = `${outDir}/report-${stamp}.json`;
  const html = renderHtml(snapshot);
  const json = toJson(snapshot);
  writeFileSync(htmlPath, html);
  writeFileSync(jsonPath, json);
  writeFileSync(`${outDir}/latest.html`, html);
  writeFileSync(`${outDir}/latest.json`, json);
  return { htmlPath, jsonPath };
}
