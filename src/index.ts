#!/usr/bin/env node
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { SIZES, ENDPOINTS, CONCURRENCY, type DomainConfig } from './config.js';
import { loadDomains } from './domains.js';
import { buildGoogleUrl } from './endpoints.js';
import { analyzeImage } from './analyze.js';
import { fetchImage, mapWithConcurrency } from './fetch.js';
import { probeOrigin, type OriginAsset } from './origin.js';
import { toDataUri, writeReports, type Cell, type Snapshot } from './report.js';
import { diffSnapshots, renderDiffHtml } from './compare.js';
import {
  parseArgs,
  meetsFailThreshold,
  resolveSnapshotPath,
  getVersion,
  CliError,
  USAGE,
  type CliOptions,
} from './cli.js';

interface Job {
  domain: DomainConfig;
  endpoint: (typeof ENDPOINTS)[number];
  size: number;
}

async function captureSnapshot(domains: DomainConfig[]): Promise<Snapshot> {
  const capturedAt = new Date().toISOString();

  const jobs: Job[] = [];
  for (const domain of domains) {
    for (const endpoint of ENDPOINTS) {
      for (const size of SIZES) {
        jobs.push({ domain, endpoint, size });
      }
    }
  }

  console.log(
    `[INFO] Fetching ${jobs.length} Google favicon cells across ${domains.length} domains`
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
  await mapWithConcurrency(domains, CONCURRENCY, async (d) => {
    origins[d.domain] = await probeOrigin(d.domain);
  });

  return { capturedAt, cells, origins };
}

function loadSnapshot(path: string): Snapshot {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Snapshot;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new CliError(
        `snapshot not found: ${path} (capture one first to create it)`
      );
    }
    throw e;
  }
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

function applyFailOn(snapshot: Snapshot, options: CliOptions): void {
  if (!options.failOn) return;
  const verdicts = snapshot.cells.map((c) => c.analysis.verdict);
  if (meetsFailThreshold(verdicts, options.failOn)) {
    console.error(`[ERROR] --fail-on ${options.failOn} threshold met`);
    process.exit(2);
  }
}

async function runCompare(options: CliOptions): Promise<void> {
  const paths = (options.compare as string[]).map((p) =>
    resolveSnapshotPath(p, options.outDir)
  );
  const before = loadSnapshot(paths[0]);
  const after = paths[1]
    ? loadSnapshot(paths[1])
    : await captureSnapshot(loadDomains(options.domains));
  if (!paths[1]) {
    writeReports(after, options.outDir);
  }
  const diffs = diffSnapshots(before, after);
  mkdirSync(options.outDir, { recursive: true });
  const stamp = after.capturedAt.replace(/[:.]/g, '-');
  const diffPath = `${options.outDir}/diff-${stamp}.html`;
  writeFileSync(diffPath, renderDiffHtml(diffs, after.capturedAt));
  const diffJsonPath = `${options.outDir}/diff-${stamp}.json`;
  writeFileSync(
    diffJsonPath,
    JSON.stringify(
      { comparedAt: after.capturedAt, changed: diffs.length, diffs },
      null,
      2
    )
  );
  console.log(
    `[INFO] ${diffs.length} cell(s) changed. Diff: ${diffPath} | ${diffJsonPath}`
  );
  for (const d of diffs) {
    console.log(
      `[DIFF] ${d.key}: ${d.before.format}/${d.before.cornerClass}/${d.before.verdict} -> ${d.after.format}/${d.after.cornerClass}/${d.after.verdict}`
    );
  }
  applyFailOn(after, options);
}

async function runCapture(options: CliOptions): Promise<void> {
  const snapshot = await captureSnapshot(loadDomains(options.domains));
  const { htmlPath, jsonPath } = writeReports(snapshot, options.outDir);
  summarize(snapshot);
  console.log(`[INFO] Report: ${htmlPath}`);
  console.log(`[INFO] JSON:   ${jsonPath}`);
  applyFailOn(snapshot, options);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    console.log(USAGE);
    return;
  }
  if (options.version) {
    console.log(getVersion());
    return;
  }

  if (options.compare) {
    await runCompare(options);
  } else {
    await runCapture(options);
  }
}

main().catch((e: unknown) => {
  if (e instanceof CliError) {
    console.error(`[ERROR] ${e.message}`);
  } else {
    console.error('[ERROR]', e);
  }
  process.exit(1);
});
