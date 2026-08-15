import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from 'vitest';

type PackageRule = {
  automerge?: boolean;
  dependencyDashboardApproval?: boolean;
  description?: string;
  matchUpdateTypes?: string[];
};

function renovateRules(): PackageRule[] {
  const config = JSON.parse(
    readFileSync(resolve(process.cwd(), 'renovate.json'), 'utf8')
  ) as { packageRules?: PackageRule[] };

  assert.ok(Array.isArray(config.packageRules), 'packageRules must be a list');
  return config.packageRules;
}

test('only proven update types may self-drain', () => {
  const automated = renovateRules().filter((rule) => rule.automerge === true);
  const forbidden = ['digest', 'pin', 'pinDigest', 'lockFileMaintenance'];

  assert.deepEqual(
    automated.map((rule) => rule.description),
    [
      'Stable npm runtime non-major updates',
      'Stable npm development non-major updates',
      'GitHub Actions non-major updates',
    ]
  );
  for (const rule of automated) {
    assert.ok(Array.isArray(rule.matchUpdateTypes));
    assert.equal(
      rule.matchUpdateTypes.some((type) => forbidden.includes(type)),
      false,
      `${String(rule.description)} includes an unproven update type`
    );
    assert.deepEqual(rule.matchUpdateTypes, ['patch', 'minor']);
  }
});

test('pin, digest, and lockfile-only changes require dashboard approval', () => {
  const manual = new Map(
    renovateRules()
      .filter((rule) => rule.automerge === false)
      .map((rule) => [rule.description, rule])
  );

  assert.deepEqual(
    manual.get('Pin and digest updates require exception handling'),
    {
      description: 'Pin and digest updates require exception handling',
      matchUpdateTypes: ['digest', 'pin', 'pinDigest'],
      dependencyDashboardApproval: true,
      automerge: false,
    }
  );
  assert.deepEqual(
    manual.get('Lockfile maintenance requires exception handling'),
    {
      description: 'Lockfile maintenance requires exception handling',
      matchUpdateTypes: ['lockFileMaintenance'],
      dependencyDashboardApproval: true,
      automerge: false,
    }
  );
});
