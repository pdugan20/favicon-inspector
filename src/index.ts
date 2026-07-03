#!/usr/bin/env node
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import {
  SIZES,
  ENDPOINTS,
  CONCURRENCY,
  DIVERGENCE_THRESHOLD,
  type DomainConfig,
} from './config.js';
import { loadDomains } from './domains.js';
import { buildGoogleUrl } from './endpoints.js';
import { analyzeImage } from './analyze.js';
import { perceptualHash } from './perceptualHash.js';
import { fetchImage, mapWithConcurrency } from './fetch.js';
import { probeOrigin, type OriginAsset } from './origin.js';
import { deriveAllOriginFindings } from './originChecks.js';
import { deriveDivergences } from './divergence.js';
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
    const pHash = r.bytes ? await perceptualHash(r.bytes) : null;
    const cell: Cell = {
      domain: job.domain.domain,
      endpoint: job.endpoint,
      size: job.size,
      status: r.status,
      contentType: r.contentType,
      error: r.error,
      analysis,
      dataUri: r.bytes ? toDataUri(r.contentType, r.bytes) : undefined,
      ...(pHash ? { pHash } : {}),
    };
    return cell;
  });

  console.log('[INFO] Probing origin assets');
  const origins: Record<string, OriginAsset[]> = {};
  await mapWithConcurrency(domains, CONCURRENCY, async (d) => {
    origins[d.domain] = await probeOrigin(d.domain);
  });

  const originFindings = deriveAllOriginFindings(origins);
  const divergenceFindings = deriveDivergences(
    cells,
    origins,
    DIVERGENCE_THRESHOLD
  );

  return { capturedAt, cells, origins, originFindings, divergenceFindings };
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
  const findings = Object.values(snapshot.originFindings ?? {}).flat();
  if (findings.length > 0) {
    console.log(`[INFO] ${findings.length} origin finding(s)`);
    for (const f of findings) {
      console.log(`[${f.severity}] ${f.domain} ${f.code}: ${f.message}`);
    }
  }
  const divergences = Object.values(snapshot.divergenceFindings ?? {}).flat();
  if (divergences.length > 0) {
    console.log(`[INFO] ${divergences.length} icon divergence(s)`);
    for (const d of divergences) {
      console.log(
        `[${d.severity}] ${d.domain} ${d.endpoint} diverges from ${d.masterPath} (distance ${d.distance}/64)`
      );
    }
  }
}

function applyFailOn(snapshot: Snapshot, options: CliOptions): void {
  if (!options.failOn) return;
  // Cell encoding verdicts and icon-divergence findings both count toward the
  // threshold: a stale/wrong cached icon is exactly what CI should catch.
  const verdicts = [
    ...snapshot.cells.map((c) => c.analysis.verdict),
    ...Object.values(snapshot.divergenceFindings ?? {})
      .flat()
      .map((d) => d.severity),
  ];
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
