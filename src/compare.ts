import type { Endpoint } from './config';
import type { Analysis } from './analyze';
import type { Snapshot } from './report';

type DiffFields = Pick<Analysis, 'format' | 'cornerClass' | 'verdict'>;

export interface CellDiff {
  key: string;
  before: DiffFields;
  after: DiffFields;
}

export function cellKey(c: {
  domain: string;
  endpoint: Endpoint;
  size: number;
}): string {
  return `${c.domain}|${c.endpoint}|${c.size}`;
}

function pick(a: Analysis): DiffFields {
  return { format: a.format, cornerClass: a.cornerClass, verdict: a.verdict };
}

export function diffSnapshots(before: Snapshot, after: Snapshot): CellDiff[] {
  const beforeMap = new Map(before.cells.map((c) => [cellKey(c), c.analysis]));
  const diffs: CellDiff[] = [];
  for (const c of after.cells) {
    const b = beforeMap.get(cellKey(c));
    if (!b) continue;
    const a = c.analysis;
    if (
      b.format !== a.format ||
      b.cornerClass !== a.cornerClass ||
      b.verdict !== a.verdict
    ) {
      diffs.push({ key: cellKey(c), before: pick(b), after: pick(a) });
    }
  }
  return diffs;
}

export function renderDiffHtml(diffs: CellDiff[], capturedAt: string): string {
  const rows = diffs
    .map(
      (d) => `
      <tr>
        <td>${d.key}</td>
        <td>${d.before.format} · ${d.before.cornerClass} · ${d.before.verdict}</td>
        <td>→</td>
        <td>${d.after.format} · ${d.after.cornerClass} · ${d.after.verdict}</td>
      </tr>`
    )
    .join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>favicon-inspector diff</title>
<style>
  body { font: 13px/1.4 system-ui, sans-serif; margin: 24px; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #d0d7de; padding: 4px 8px; text-align: left; }
</style></head>
<body>
  <h1>favicon-inspector — changes</h1>
  <div>Compared at ${capturedAt}; ${diffs.length} cell(s) changed</div>
  <table>
    <tr><th>Cell</th><th>Before</th><th></th><th>After</th></tr>
    ${rows}
  </table>
</body></html>`;
}
