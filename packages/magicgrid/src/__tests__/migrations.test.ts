import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MAGICGRID_VERSION,
  defaultMagicGridWorkspace,
  upgradeWorkspace,
} from '../index.js';

describe('MagicGrid migrations', () => {
  it('upgrades legacy workspaces that are missing schema metadata', () => {
    const legacyWorkspace: any = {
      ...defaultMagicGridWorkspace,
      manifest: { ...defaultMagicGridWorkspace.manifest },
    };
    delete legacyWorkspace.manifest.schemaVersion;
    delete legacyWorkspace.manifest.migratedFromVersion;

    const migration = upgradeWorkspace(legacyWorkspace, '0.0.0');

    assert.equal(migration.status, 'upgraded');
    assert.equal(migration.fromVersion, '0.0.0');
    assert.equal(migration.toVersion, MAGICGRID_VERSION);
    assert.equal(migration.workspace.manifest.schemaVersion, MAGICGRID_VERSION);
    assert.equal(migration.workspace.manifest.migratedFromVersion, '0.0.0');
    assert.ok(Array.isArray(migration.workspace.manifest.migrationWarnings));
  });

  it('marks forward versions as unsupported', () => {
    const forwardWorkspace = {
      ...defaultMagicGridWorkspace,
      manifest: { ...defaultMagicGridWorkspace.manifest, schemaVersion: '9.9.9' },
    };

    const migration = upgradeWorkspace(forwardWorkspace);

    assert.equal(migration.status, 'unsupported');
    assert.equal(migration.fromVersion, '9.9.9');
    assert.equal(migration.toVersion, '9.9.9');
    assert.ok(migration.reason?.includes('newer'));
    assert.equal(migration.workspace.manifest.schemaVersion, '9.9.9');
  });
});
