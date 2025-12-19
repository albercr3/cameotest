import path from 'path';
import { promises as fs } from 'fs';

import {
  MagicGridManifest,
  MagicGridWorkspace,
  MagicGridWorkspaceInput,
  magicGridManifestSchema,
  upgradeWorkspace,
  validateMagicGridWorkspace,
} from '@cameotest/magicgrid';

import { WorkspaceMetadata, VersionConflictError } from './workspaceRepository.js';

export interface MagicGridRepositoryOptions {
  baseDir: string;
  legacyDir?: string;
}

export type MagicGridManifestWithVersion = MagicGridManifest & { version: number };
export type MagicGridWorkspaceWithVersion = MagicGridWorkspace & {
  manifest: MagicGridManifestWithVersion;
};

export interface MagicGridRepository {
  listWorkspaces(): Promise<MagicGridManifestWithVersion[]>;
  getWorkspace(id: string): Promise<MagicGridWorkspaceWithVersion | null>;
  getManifest(id: string): Promise<MagicGridManifestWithVersion | null>;
  createWorkspace(
    workspace: MagicGridWorkspaceWithVersion,
    metadata?: WorkspaceMetadata,
  ): Promise<MagicGridManifestWithVersion>;
  saveWorkspace(
    workspace: MagicGridWorkspaceWithVersion,
    expectedVersion?: number,
    metadata?: WorkspaceMetadata,
  ): Promise<MagicGridManifestWithVersion>;
  deleteWorkspace(id: string): Promise<boolean>;
  duplicateWorkspace(
    sourceId: string,
    manifest: MagicGridManifestWithVersion,
    metadata?: WorkspaceMetadata,
  ): Promise<MagicGridManifestWithVersion>;
  nextAvailableId(baseId: string): Promise<string>;
  migrateWorkspace(id: string): Promise<MagicGridManifestWithVersion>;
  bootstrapLegacyWorkspaces(): Promise<void>;
}

export class MagicGridMigrationRequiredError extends Error {
  constructor(
    message: string,
    public readonly workspaceId: string,
    public readonly fromVersion: string,
    public readonly targetVersion: string,
    public readonly warnings: string[] = [],
    public readonly reason?: string,
  ) {
    super(message);
  }
}

export class MagicGridUnsupportedVersionError extends Error {
  constructor(
    message: string,
    public readonly workspaceId: string,
    public readonly schemaVersion: string,
  ) {
    super(message);
  }
}

export class FileMagicGridRepository implements MagicGridRepository {
  private readonly workspaceFile = 'workspace.json';
  private readonly metadataFile = 'metadata.json';

  constructor(private readonly options: MagicGridRepositoryOptions) {}

  async bootstrapLegacyWorkspaces(): Promise<void> {
    if (!this.options.legacyDir) return;
    const legacyExists = await this.pathExists(this.options.legacyDir);
    if (!legacyExists) return;

    const entries = await fs.readdir(this.options.legacyDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const id = entry.name;
      const existing = await this.getManifest(id);
      if (existing) continue;
      const legacyWorkspace = await this.readWorkspaceFromDir(path.join(this.options.legacyDir, id));
      if (!legacyWorkspace) continue;
      try {
        const normalized = this.normalizeWorkspace({
          ...legacyWorkspace,
          manifest: {
            ...(legacyWorkspace.manifest as MagicGridManifestWithVersion),
            version: (legacyWorkspace.manifest as MagicGridManifestWithVersion | undefined)?.version ?? 1,
          },
        });
        await this.createWorkspace(normalized);
      } catch {
        // Ignore legacy entries that are not valid MagicGrid workspaces.
      }
    }
  }

  async listWorkspaces(): Promise<MagicGridManifestWithVersion[]> {
    if (!(await this.pathExists(this.options.baseDir))) {
      await fs.mkdir(this.options.baseDir, { recursive: true });
      return [];
    }

    const entries = await fs.readdir(this.options.baseDir, { withFileTypes: true });
    const manifests: MagicGridManifestWithVersion[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifest = await this.readManifest(entry.name);
      if (manifest) {
        manifests.push(manifest);
      }
    }
    return manifests;
  }

  async getWorkspace(id: string): Promise<MagicGridWorkspaceWithVersion | null> {
    return this.loadWorkspaceWithMigration(id);
  }

  async getManifest(id: string): Promise<MagicGridManifestWithVersion | null> {
    const workspace = await this.loadWorkspaceWithMigration(id);
    return workspace?.manifest ?? null;
  }

  async createWorkspace(
    workspace: MagicGridWorkspaceWithVersion,
    metadata?: WorkspaceMetadata,
  ): Promise<MagicGridManifestWithVersion> {
    const id = await this.nextAvailableId(workspace.manifest.id);
    const manifest = this.normalizeManifest({
      ...workspace.manifest,
      id,
      version: workspace.manifest.version ?? 1,
      createdAt: workspace.manifest.createdAt,
      updatedAt: workspace.manifest.updatedAt,
    });
    const normalized = this.normalizeWorkspace({ ...workspace, manifest });
    await this.writeWorkspace(normalized, metadata);
    return manifest;
  }

  async saveWorkspace(
    workspace: MagicGridWorkspaceWithVersion,
    expectedVersion?: number,
    metadata?: WorkspaceMetadata,
  ): Promise<MagicGridManifestWithVersion> {
    const id = this.sanitizeId(workspace.manifest.id);
    const existingWorkspace = await this.loadWorkspaceWithMigration(id);
    if (!existingWorkspace) {
      throw new Error(`Workspace ${id} not found`);
    }

    const requiredVersion = expectedVersion ?? existingWorkspace.manifest.version;
    if (requiredVersion !== existingWorkspace.manifest.version) {
      throw new VersionConflictError(
        `Version conflict for workspace ${id}`,
        id,
        requiredVersion,
        existingWorkspace.manifest.version,
      );
    }

    const manifest = this.normalizeManifest({
      ...workspace.manifest,
      id,
      version: existingWorkspace.manifest.version + 1,
      createdAt: existingWorkspace.manifest.createdAt,
      updatedAt: new Date().toISOString(),
    });
    const normalized = this.normalizeWorkspace({ ...workspace, manifest });
    await this.writeWorkspace(normalized, metadata ?? (await this.readMetadata(id)) ?? undefined);
    return manifest;
  }

  async deleteWorkspace(id: string): Promise<boolean> {
    const dir = this.workspaceDir(id);
    if (!(await this.pathExists(dir))) return false;
    await fs.rm(dir, { recursive: true, force: true });
    return true;
  }

  async duplicateWorkspace(
    sourceId: string,
    manifest: MagicGridManifestWithVersion,
    metadata?: WorkspaceMetadata,
  ): Promise<MagicGridManifestWithVersion> {
    const source = await this.getWorkspace(sourceId);
    if (!source) {
      throw new Error(`Workspace ${sourceId} not found`);
    }
    const targetId = await this.nextAvailableId(manifest.id);
    const nextManifest = this.normalizeManifest({
      ...manifest,
      id: targetId,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await this.writeWorkspace(
      { ...source, manifest: nextManifest },
      metadata ?? (await this.readMetadata(sourceId)) ?? undefined,
    );
    return nextManifest;
  }

  async migrateWorkspace(id: string): Promise<MagicGridManifestWithVersion> {
    const workspace = await this.loadWorkspaceWithMigration(id);
    if (!workspace) {
      throw new Error(`Workspace ${id} not found`);
    }
    const metadata = (await this.readMetadata(id)) ?? undefined;
    await this.writeWorkspace(workspace, metadata);
    return workspace.manifest;
  }

  async nextAvailableId(rawId: string): Promise<string> {
    const base = this.sanitizeId(rawId);
    let candidate = base;
    let suffix = 2;
    while (await this.pathExists(this.workspaceDir(candidate))) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  private async loadWorkspaceWithMigration(
    id: string,
    options?: { persist?: boolean },
  ): Promise<MagicGridWorkspaceWithVersion | null> {
    const raw = await this.readWorkspaceFromDir(this.workspaceDir(id));
    if (!raw) return null;

    const migration = upgradeWorkspace(raw, (raw.manifest as MagicGridManifest | undefined)?.schemaVersion);
    if (migration.status === 'unsupported') {
      throw new MagicGridUnsupportedVersionError(
        migration.reason ?? `Workspace ${id} uses unsupported schema version`,
        id,
        migration.fromVersion,
      );
    }
    if (migration.status === 'manual-required') {
      throw new MagicGridMigrationRequiredError(
        migration.reason ?? `Workspace ${id} requires manual migration`,
        id,
        migration.fromVersion,
        migration.toVersion,
        migration.warnings,
        migration.reason,
      );
    }

    const migratedFromVersion =
      (raw.manifest as MagicGridManifestWithVersion | undefined)?.migratedFromVersion ??
      migration.workspace.manifest.migratedFromVersion ??
      migration.fromVersion;

    const manifest = this.normalizeManifest({
      ...migration.workspace.manifest,
      id: raw.manifest.id,
      version: (raw.manifest as MagicGridManifestWithVersion | undefined)?.version ?? 1,
      migratedFromVersion,
      migrationWarnings: migration.warnings,
    });
    const workspace = this.normalizeWorkspace({ ...migration.workspace, manifest });

    if (migration.status === 'upgraded' && options?.persist !== false) {
      const metadata = (await this.readMetadata(id)) ?? undefined;
      await this.writeWorkspace(workspace, metadata);
    }

    return workspace;
  }

  private sanitizeId(rawId: string): string {
    return rawId.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 80) || 'workspace';
  }

  private workspaceDir(id: string): string {
    return path.join(this.options.baseDir, this.sanitizeId(id));
  }

  private normalizeManifest(manifest: MagicGridManifest & Partial<{ version: number }>): MagicGridManifestWithVersion {
    const parsed = magicGridManifestSchema.parse({
      ...manifest,
      schemaVersion: manifest.schemaVersion,
      updatedAt: manifest.updatedAt,
      createdAt: manifest.createdAt,
    });
    const version = typeof manifest.version === 'number' && manifest.version > 0 ? manifest.version : 1;
    const migratedFromVersion = parsed.migratedFromVersion ?? parsed.schemaVersion ?? manifest.schemaVersion;
    const migrationWarnings = parsed.migrationWarnings ?? [];
    return {
      ...parsed,
      id: this.sanitizeId(parsed.id),
      version,
      migratedFromVersion,
      migrationWarnings,
    } satisfies MagicGridManifestWithVersion;
  }

  private normalizeWorkspace(workspace: MagicGridWorkspaceInput): MagicGridWorkspaceWithVersion {
    const validated = validateMagicGridWorkspace(workspace);
    const manifest = this.normalizeManifest({
      ...validated.manifest,
      version: (workspace as MagicGridWorkspaceWithVersion).manifest?.version ?? 1,
    });
    return { ...validated, manifest } satisfies MagicGridWorkspaceWithVersion;
  }

  private async readManifest(id: string): Promise<MagicGridManifestWithVersion | null> {
    try {
      const workspace = await this.loadWorkspaceWithMigration(id, { persist: true });
      return workspace?.manifest ?? null;
    } catch (error) {
      if (error instanceof MagicGridMigrationRequiredError || error instanceof MagicGridUnsupportedVersionError) {
        const raw = await this.readWorkspaceFromDir(this.workspaceDir(id));
        if (!raw) return null;
        return this.normalizeManifest({
          ...(raw.manifest as MagicGridManifestWithVersion),
          version: (raw.manifest as MagicGridManifestWithVersion | undefined)?.version ?? 1,
          migrationWarnings: [
            ...(((raw.manifest as MagicGridManifestWithVersion).migrationWarnings as string[] | undefined) ?? []),
            (error as Error).message,
          ],
        });
      }
      return null;
    }
  }

  private async readWorkspaceFromDir(dir: string): Promise<MagicGridWorkspaceInput | null> {
    try {
      const content = await fs.readFile(path.join(dir, this.workspaceFile), 'utf-8');
      return JSON.parse(content) as MagicGridWorkspaceInput;
    } catch {
      return null;
    }
  }

  private async writeWorkspace(workspace: MagicGridWorkspaceWithVersion, metadata?: WorkspaceMetadata) {
    const dir = this.workspaceDir(workspace.manifest.id);
    await fs.mkdir(dir, { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(dir, this.workspaceFile), JSON.stringify(workspace, null, 2), 'utf-8'),
      metadata ? this.writeMetadata(dir, metadata) : Promise.resolve(),
    ]);
  }

  private async writeMetadata(dir: string, metadata: WorkspaceMetadata) {
    const normalized = this.normalizeMetadata(metadata);
    await fs.writeFile(path.join(dir, this.metadataFile), JSON.stringify(normalized, null, 2), 'utf-8');
  }

  private async readMetadata(id: string): Promise<WorkspaceMetadata | null> {
    const dir = this.workspaceDir(id);
    const target = path.join(dir, this.metadataFile);
    try {
      const content = await fs.readFile(target, 'utf-8');
      return this.normalizeMetadata(JSON.parse(content) as WorkspaceMetadata);
    } catch {
      return null;
    }
  }

  private normalizeMetadata(metadata?: WorkspaceMetadata): WorkspaceMetadata {
    return {
      ownerId: metadata?.ownerId,
      archived: metadata?.archived ?? false,
      labels: metadata?.labels ?? [],
    } satisfies WorkspaceMetadata;
  }

  private async pathExists(target: string): Promise<boolean> {
    try {
      await fs.access(target);
      return true;
    } catch {
      return false;
    }
  }
}
