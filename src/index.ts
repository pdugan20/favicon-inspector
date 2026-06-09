import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import {
  DOMAINS,
  SIZES,
  ENDPOINTS,
  CONCURRENCY,
  type DomainConfig,
} from './config';
import { buildGoogleUrl } from './endpoints';
import { analyzeImage } from './analyze';
import { fetchImage, mapWithConcurrency } from './fetch';
import { probeOrigin, type OriginAsset } from './origin';
import { toDataUri, writeReports, type Cell, type Snapshot } from './report';
import { diffSnapshots, renderDiffHtml } from './compare';

interface Job {
  domain: DomainConfig;
  endpoint: (typeof ENDPOINTS)[number];
  size: number;
}

async function captureSnapshot(): Promise<Snapshot> {
  const capturedAt = new Date().toISOString();

  const jobs: Job[] = [];
  for (const domain of DOMAINS) {
    for (const endpoint of ENDPOINTS) {
      for (const size of SIZES) {
        jobs.push({ domain, endpoint, size });
      }
    }
  }

  console.log(
    `[INFO] Fetching ${jobs.length} Google favicon cells across ${DOMAINS.length} domains`
  );
  const cells = await mapWithConcurrency(jobs, CONCURRENCY, async (job) => {
    const url = buildGoogleUrl(job.endpoint, job.domain.domain, job.size);
    const r = await fetchImage(url);
    const analysis = r.bytes
      ? analyzeImage(r.bytes, { expected: job.domain.expected })
      : {
          format: 'unknown' as const,
          cornerClass: 'UNDECODED' as const,
          verdict: 'OK' as const,
        };
    const cell: Cell = {
      domain: job.domain.domain,
      endpoint: job.endpoint,
      size: job.size,
      status: r.status,
      contentType: r.contentType,
      error: r.error,
      analysis,
      dataUri: r.bytes ? toDataUri(r.contentType, r.bytes) : undefined,
    };
    return cell;
  });

  console.log('[INFO] Probing origin assets');
  const origins: Record<string, OriginAsset[]> = {};
  await mapWithConcurrency(DOMAINS, CONCURRENCY, async (d) => {
    origins[d.domain] = await probeOrigin(d.domain);
  });

  return { capturedAt, cells, origins };
}

function loadSnapshot(path: string): Snapshot {
  return JSON.parse(readFileSync(path, 'utf8')) as Snapshot;
}

function summarize(snapshot: Snapshot): void {
  const alerts = snapshot.cells.filter((c) => c.analysis.verdict === 'ALERT');
  const warns = snapshot.cells.filter((c) => c.analysis.verdict === 'WARN');
  console.log(
    `[INFO] ${snapshot.cells.length} cells: ${alerts.length} ALERT, ${warns.length} WARN`
  );
  for (const c of alerts) {
    console.log(
      `[ALERT] ${c.domain} ${c.endpoint} ${c.size}px -> ${c.analysis.format}/${c.analysis.cornerClass}`
    );
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const compareIdx = args.indexOf('--compare');

  if (compareIdx !== -1) {
    const rest = args.slice(compareIdx + 1).filter((a) => !a.startsWith('--'));
    if (rest.length === 0) {
      console.error(
        '[ERROR] --compare requires at least one snapshot JSON path'
      );
      process.exit(1);
    }
    const before = loadSnapshot(rest[0]);
    const after = rest[1] ? loadSnapshot(rest[1]) : await captureSnapshot();
    if (!rest[1]) {
      writeReports(after);
    }
    const diffs = diffSnapshots(before, after);
    mkdirSync('reports', { recursive: true });
    const stamp = after.capturedAt.replace(/[:.]/g, '-');
    const diffPath = `reports/diff-${stamp}.html`;
    writeFileSync(diffPath, renderDiffHtml(diffs, after.capturedAt));
    console.log(`[INFO] ${diffs.length} cell(s) changed. Diff: ${diffPath}`);
    for (const d of diffs) {
      console.log(
        `[DIFF] ${d.key}: ${d.before.format}/${d.before.cornerClass}/${d.before.verdict} -> ${d.after.format}/${d.after.cornerClass}/${d.after.verdict}`
      );
    }
    return;
  }

  const snapshot = await captureSnapshot();
  const { htmlPath, jsonPath } = writeReports(snapshot);
  summarize(snapshot);
  console.log(`[INFO] Report: ${htmlPath}`);
  console.log(`[INFO] JSON:   ${jsonPath}`);
}

main().catch((e) => {
  console.error('[ERROR]', e);
  process.exit(1);
});
