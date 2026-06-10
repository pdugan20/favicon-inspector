import { describe, expect, it } from 'vitest';
import { parseArgs, meetsFailThreshold, getVersion, CliError } from '../cli.js';

describe('parseArgs', () => {
  it('returns defaults with no args', () => {
    expect(parseArgs([])).toEqual({
      help: false,
      version: false,
      compare: null,
      failOn: null,
      outDir: 'reports',
      domains: null,
    });
  });

  it('parses --help and -h', () => {
    expect(parseArgs(['--help']).help).toBe(true);
    expect(parseArgs(['-h']).help).toBe(true);
  });

  it('parses --version and -v', () => {
    expect(parseArgs(['--version']).version).toBe(true);
    expect(parseArgs(['-v']).version).toBe(true);
  });

  it('collects one or two paths after --compare', () => {
    expect(parseArgs(['--compare', 'a.json']).compare).toEqual(['a.json']);
    expect(parseArgs(['--compare', 'a.json', 'b.json']).compare).toEqual([
      'a.json',
      'b.json',
    ]);
  });

  it('combines --compare with other flags', () => {
    const options = parseArgs(['--compare', 'a.json', '--fail-on', 'alert']);
    expect(options.compare).toEqual(['a.json']);
    expect(options.failOn).toBe('alert');
  });

  it('rejects --compare without a path', () => {
    expect(() => parseArgs(['--compare'])).toThrow(CliError);
    expect(() => parseArgs(['--compare', '--fail-on', 'warn'])).toThrow(
      CliError
    );
  });

  it('parses --fail-on values', () => {
    expect(parseArgs(['--fail-on', 'warn']).failOn).toBe('warn');
    expect(parseArgs(['--fail-on', 'alert']).failOn).toBe('alert');
  });

  it('rejects invalid --fail-on values', () => {
    expect(() => parseArgs(['--fail-on', 'bogus'])).toThrow(CliError);
    expect(() => parseArgs(['--fail-on'])).toThrow(CliError);
  });

  it('parses --out', () => {
    expect(parseArgs(['--out', 'tmp/snapshots']).outDir).toBe('tmp/snapshots');
    expect(() => parseArgs(['--out'])).toThrow(CliError);
  });

  it('parses --domains as a comma-separated list', () => {
    expect(parseArgs(['--domains', 'a.com,b.com']).domains).toEqual([
      'a.com',
      'b.com',
    ]);
    expect(parseArgs(['--domains', ' a.com , b.com ']).domains).toEqual([
      'a.com',
      'b.com',
    ]);
  });

  it('rejects empty --domains', () => {
    expect(() => parseArgs(['--domains', ','])).toThrow(CliError);
    expect(() => parseArgs(['--domains'])).toThrow(CliError);
  });

  it('rejects unknown flags and stray arguments', () => {
    expect(() => parseArgs(['--comapre', 'a.json'])).toThrow(
      /Unknown flag: --comapre/
    );
    expect(() => parseArgs(['a.json'])).toThrow(/Unexpected argument/);
  });
});

describe('meetsFailThreshold', () => {
  it('fail-on alert triggers only on ALERT', () => {
    expect(meetsFailThreshold(['OK', 'WARN'], 'alert')).toBe(false);
    expect(meetsFailThreshold(['OK', 'ALERT'], 'alert')).toBe(true);
  });

  it('fail-on warn triggers on WARN or ALERT', () => {
    expect(meetsFailThreshold(['OK', 'OK'], 'warn')).toBe(false);
    expect(meetsFailThreshold(['OK', 'WARN'], 'warn')).toBe(true);
    expect(meetsFailThreshold(['OK', 'ALERT'], 'warn')).toBe(true);
  });
});

describe('getVersion', () => {
  it('reads the package version', () => {
    expect(getVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
