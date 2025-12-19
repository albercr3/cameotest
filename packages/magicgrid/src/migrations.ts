import {
  MAGICGRID_VERSION,
  magicGridManifestSchema,
  type MagicGridManifest,
  type MagicGridWorkspace,
  type MagicGridWorkspaceInput,
  validateMagicGridWorkspace,
} from './ir.js';

export type MigrationStatus = 'up-to-date' | 'upgraded' | 'manual-required' | 'unsupported';

export interface MagicGridMigrationResult {
  workspace: MagicGridWorkspace;
  fromVersion: string;
  toVersion: string;
  steps: string[];
  warnings: string[];
  status: MigrationStatus;
  reason?: string;
}

interface MigrationStep {
  from: string;
  to: string;
  description: string;
  migrate(workspace: MagicGridWorkspaceInput): { workspace: MagicGridWorkspaceInput; warnings?: string[] };
}

const FALLBACK_VERSION = '0.0.0';

function compareVersions(a: string, b: string): number {
  const parse = (value: string) => value.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const [a1, a2 = 0, a3 = 0] = parse(a);
  const [b1, b2 = 0, b3 = 0] = parse(b);
  if (a1 !== b1) return a1 > b1 ? 1 : -1;
  if (a2 !== b2) return a2 > b2 ? 1 : -1;
  if (a3 !== b3) return a3 > b3 ? 1 : -1;
  return 0;
}

const MIGRATION_STEPS: MigrationStep[] = [
  {
    from: FALLBACK_VERSION,
    to: MAGICGRID_VERSION,
    description: 'Initialize MagicGrid schema metadata',
    migrate(workspace) {
      const manifest: MagicGridManifest = magicGridManifestSchema.parse({
        ...workspace.manifest,
        schemaVersion: MAGICGRID_VERSION,
        migratedFromVersion: (workspace.manifest as MagicGridManifest | undefined)?.schemaVersion ?? FALLBACK_VERSION,
        migrationWarnings: (workspace.manifest as MagicGridManifest | undefined)?.migrationWarnings ?? [],
      });
      const upgraded = validateMagicGridWorkspace({ ...workspace, manifest });
      return { workspace: upgraded };
    },
  },
];

export function upgradeWorkspace(
  workspace: MagicGridWorkspaceInput,
  explicitFromVersion?: string,
): MagicGridMigrationResult {
  const startingVersion =
    (workspace.manifest as MagicGridManifest | undefined)?.schemaVersion ??
    explicitFromVersion ??
    FALLBACK_VERSION;
  const existingWarnings =
    (workspace.manifest as MagicGridManifest | undefined)?.migrationWarnings ?? [];

  const parsed = validateMagicGridWorkspace({
    ...workspace,
    manifest: {
      ...workspace.manifest,
      schemaVersion: startingVersion,
      migrationWarnings: existingWarnings,
    },
  });

  if (compareVersions(startingVersion, MAGICGRID_VERSION) > 0) {
    const reason = `Workspace schema ${startingVersion} is newer than supported ${MAGICGRID_VERSION}`;
    return {
      workspace: parsed,
      fromVersion: startingVersion,
      toVersion: startingVersion,
      steps: [],
      warnings: reason ? [...existingWarnings, reason] : existingWarnings,
      status: 'unsupported',
      reason,
    };
  }

  let currentVersion = startingVersion;
  let candidate: MagicGridWorkspaceInput = parsed;
  const steps: string[] = [];
  const warnings = [...existingWarnings];

  while (compareVersions(currentVersion, MAGICGRID_VERSION) < 0) {
    const step = MIGRATION_STEPS.find((migration) => migration.from === currentVersion);
    if (!step) {
      const reason = `No migration path from ${currentVersion} to ${MAGICGRID_VERSION}`;
      return {
        workspace: validateMagicGridWorkspace(candidate),
        fromVersion: startingVersion,
        toVersion: currentVersion,
        steps,
        warnings: reason ? [...warnings, reason] : warnings,
        status: 'manual-required',
        reason,
      };
    }
    const result = step.migrate(candidate);
    if (result.warnings?.length) {
      warnings.push(...result.warnings);
    }
    steps.push(step.description);
    candidate = {
      ...result.workspace,
      manifest: {
        ...result.workspace.manifest,
        migrationWarnings: warnings,
      },
    };
    currentVersion = step.to;
  }

  const migratedManifest = magicGridManifestSchema.parse({
    ...candidate.manifest,
    schemaVersion: MAGICGRID_VERSION,
    migratedFromVersion: startingVersion,
    migrationWarnings: warnings,
  });

  const migratedWorkspace = validateMagicGridWorkspace({
    ...candidate,
    manifest: migratedManifest,
  });

  const status: MigrationStatus =
    compareVersions(startingVersion, MAGICGRID_VERSION) === 0 && steps.length === 0
      ? 'up-to-date'
      : 'upgraded';

  return {
    workspace: migratedWorkspace,
    fromVersion: startingVersion,
    toVersion: MAGICGRID_VERSION,
    steps,
    warnings,
    status,
  };
}
