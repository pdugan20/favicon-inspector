import { createRequire } from 'node:module';
import type { Verdict } from './analyze.js';

export type FailOn = 'warn' | 'alert';

export interface CliOptions {
  help: boolean;
  version: boolean;
  /** Snapshot JSON paths following --compare (1 or 2). Null when not comparing. */
  compare: string[] | null;
  failOn: FailOn | null;
  outDir: string;
  /** Domains to inspect instead of the configured list. */
  domains: string[] | null;
}

export class CliError extends Error {}

export const USAGE = `Usage: favicon-inspector [options]

Captures what Google's favicon services serve for the configured domains and
writes an HTML + JSON report. With --compare, diffs snapshots instead.

Options:
  --compare <before.json> [after.json]  Diff against a prior snapshot. With one
                                        path, captures a fresh snapshot first.
                                        'latest' is shorthand for the
                                        latest.json pointer in the output dir.
  --domains <a.com,b.com>               Inspect these domains instead of the
                                        list in src/config.ts.
  --fail-on <warn|alert>                Exit 2 if any cell is at or above this
                                        verdict. For CI and cron monitoring.
  --out <dir>                           Output directory (default: reports).
  -h, --help                            Show this help.
  -v, --version                         Show version.

Exit codes:
  0  success
  1  fatal error (bad flags, unreadable snapshot, crash)
  2  --fail-on threshold met
`;

export function getVersion(): string {
  const require = createRequire(import.meta.url);
  const pkg = require('../package.json') as { version: string };
  return pkg.version;
}

function requireValue(flag: string, value: string | undefined): string {
  if (value === undefined || value.startsWith('-')) {
    throw new CliError(`${flag} requires a value (see --help)`);
  }
  return value;
}

export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    help: false,
    version: false,
    compare: null,
    failOn: null,
    outDir: 'reports',
    domains: null,
  };

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        options.help = true;
        i += 1;
        break;
      case '-v':
      case '--version':
        options.version = true;
        i += 1;
        break;
      case '--compare': {
        const paths: string[] = [];
        while (
          paths.length < 2 &&
          argv[i + 1] !== undefined &&
          !argv[i + 1].startsWith('-')
        ) {
          paths.push(argv[i + 1]);
          i += 1;
        }
        if (paths.length === 0) {
          throw new CliError(
            '--compare requires at least one snapshot JSON path'
          );
        }
        options.compare = paths;
        i += 1;
        break;
      }
      case '--fail-on': {
        const value = requireValue('--fail-on', argv[i + 1]);
        if (value !== 'warn' && value !== 'alert') {
          throw new CliError(
            `--fail-on must be 'warn' or 'alert', got '${value}'`
          );
        }
        options.failOn = value;
        i += 2;
        break;
      }
      case '--out':
        options.outDir = requireValue('--out', argv[i + 1]);
        i += 2;
        break;
      case '--domains': {
        const value = requireValue('--domains', argv[i + 1]);
        const domains = value
          .split(',')
          .map((d) => d.trim())
          .filter((d) => d.length > 0);
        if (domains.length === 0) {
          throw new CliError('--domains requires a comma-separated list');
        }
        options.domains = domains;
        i += 2;
        break;
      }
      default:
        throw new CliError(
          arg.startsWith('-')
            ? `Unknown flag: ${arg} (see --help)`
            : `Unexpected argument: ${arg} (see --help)`
        );
    }
  }

  return options;
}

/** Expand the 'latest' shorthand to the latest.json pointer in outDir. */
export function resolveSnapshotPath(path: string, outDir: string): string {
  return path === 'latest' ? `${outDir}/latest.json` : path;
}

const VERDICT_RANK: Record<Verdict, number> = { OK: 0, WARN: 1, ALERT: 2 };

/** True when any verdict is at or above the --fail-on threshold. */
export function meetsFailThreshold(
  verdicts: Verdict[],
  failOn: FailOn
): boolean {
  const threshold = failOn === 'warn' ? VERDICT_RANK.WARN : VERDICT_RANK.ALERT;
  return verdicts.some((v) => VERDICT_RANK[v] >= threshold);
}
