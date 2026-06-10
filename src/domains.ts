import { readFileSync } from 'node:fs';
import { CliError } from './cli.js';
import type { DomainConfig } from './config.js';

export const CONFIG_FILE = 'favicon-inspector.config.json';

function isExpected(value: unknown): value is DomainConfig['expected'] {
  return value === undefined || value === 'transparent' || value === 'opaque';
}

function normalizeEntry(entry: unknown, path: string): DomainConfig {
  if (typeof entry === 'string' && entry.length > 0) {
    return { domain: entry };
  }
  if (
    typeof entry === 'object' &&
    entry !== null &&
    typeof (entry as DomainConfig).domain === 'string' &&
    isExpected((entry as DomainConfig).expected)
  ) {
    const { domain, expected } = entry as DomainConfig;
    return expected ? { domain, expected } : { domain };
  }
  throw new CliError(
    `invalid ${path}: each domain must be a string or {domain, expected?}`
  );
}

/** Read the config file, or null when it does not exist. */
export function readConfigFile(path = CONFIG_FILE): DomainConfig[] | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new CliError(`invalid ${path}: not valid JSON`);
  }
  const domains = (parsed as { domains?: unknown }).domains;
  if (!Array.isArray(domains)) {
    throw new CliError(`invalid ${path}: expected {"domains": [...]}`);
  }
  return domains.map((entry) => normalizeEntry(entry, path));
}

/**
 * Resolve the domains to inspect: --domains wins, else the config file.
 * Config-file entries supply `expected` for matching --domains names.
 */
export function loadDomains(
  requested: string[] | null,
  path = CONFIG_FILE
): DomainConfig[] {
  const configured = readConfigFile(path);
  if (requested) {
    const byName = new Map(configured?.map((d) => [d.domain, d]));
    return requested.map((name) => byName.get(name) ?? { domain: name });
  }
  if (!configured || configured.length === 0) {
    throw new CliError(`no domains: pass --domains or create ${path}`);
  }
  return configured;
}
