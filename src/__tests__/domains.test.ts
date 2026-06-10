import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadDomains, readConfigFile } from '../domains.js';
import { CliError } from '../cli.js';

let dir: string;
let configPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'favicon-config-'));
  configPath = join(dir, 'favicon-inspector.config.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeConfig(value: unknown): void {
  writeFileSync(configPath, JSON.stringify(value));
}

describe('readConfigFile', () => {
  it('returns null when the file does not exist', () => {
    expect(readConfigFile(configPath)).toBeNull();
  });

  it('normalizes string and object entries', () => {
    writeConfig({
      domains: ['a.com', { domain: 'b.com', expected: 'opaque' }],
    });
    expect(readConfigFile(configPath)).toEqual([
      { domain: 'a.com' },
      { domain: 'b.com', expected: 'opaque' },
    ]);
  });

  it('rejects malformed JSON, shapes, and entries', () => {
    writeFileSync(configPath, 'not json');
    expect(() => readConfigFile(configPath)).toThrow(CliError);

    writeConfig({ domains: 'a.com' });
    expect(() => readConfigFile(configPath)).toThrow(/expected {"domains"/);

    writeConfig({ domains: [42] });
    expect(() => readConfigFile(configPath)).toThrow(CliError);

    writeConfig({ domains: [{ domain: 'a.com', expected: 'shiny' }] });
    expect(() => readConfigFile(configPath)).toThrow(CliError);
  });
});

describe('loadDomains', () => {
  it('uses the config file when --domains is absent', () => {
    writeConfig({ domains: ['a.com'] });
    expect(loadDomains(null, configPath)).toEqual([{ domain: 'a.com' }]);
  });

  it('errors without --domains or a config file', () => {
    expect(() => loadDomains(null, configPath)).toThrow(/no domains/);
    writeConfig({ domains: [] });
    expect(() => loadDomains(null, configPath)).toThrow(/no domains/);
  });

  it('prefers --domains, merging expected from the config file', () => {
    writeConfig({ domains: [{ domain: 'a.com', expected: 'opaque' }] });
    expect(loadDomains(['a.com', 'c.com'], configPath)).toEqual([
      { domain: 'a.com', expected: 'opaque' },
      { domain: 'c.com' },
    ]);
  });

  it('accepts --domains with no config file at all', () => {
    expect(loadDomains(['c.com'], configPath)).toEqual([{ domain: 'c.com' }]);
  });
});
