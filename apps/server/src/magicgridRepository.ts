import path from 'path';
import { promises as fs } from 'fs';

import {
  MagicGridManifest,
  MagicGridWorkspace,
  MagicGridWorkspaceInput,
  magicGridManifestSchema,
  magicGridWorkspaceSchema,
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
  bootstrapLegacyWorkspaces(): Promise<void>;
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
      await this.createWorkspace(legacyWorkspace);
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
    return this.readWorkspaceFromDir(this.workspaceDir(id));
  }

  async getManifest(id: string): Promise<MagicGridManifestWithVersion | null> {
    return this.readManifest(id);
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
    const existingManifest = await this.readManifest(id);
    if (!existingManifest) {
      throw new Error(`Workspace ${id} not found`);
    }

    const requiredVersion = expectedVersion ?? existingManifest.version;
    if (requiredVersion !== existingManifest.version) {
      throw new VersionConflictError(
        `Version conflict for workspace ${id}`,
        id,
        requiredVersion,
        existingManifest.version,
      );
    }

    const manifest = this.normalizeManifest({
      ...workspace.manifest,
      id,
      version: existingManifest.version + 1,
      createdAt: existingManifest.createdAt,
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
    return { ...parsed, id: this.sanitizeId(parsed.id), version } satisfies MagicGridManifestWithVersion;
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
    const dir = this.workspaceDir(id);
    try {
      const content = await fs.readFile(path.join(dir, this.workspaceFile), 'utf-8');
      const parsed = magicGridWorkspaceSchema.parse(JSON.parse(content));
      const manifest = this.normalizeManifest({
        ...parsed.manifest,
        version: (parsed.manifest as MagicGridManifestWithVersion).version ?? 1,
      });
      return manifest;
    } catch {
      return null;
    }
  }

  private async readWorkspaceFromDir(dir: string): Promise<MagicGridWorkspaceWithVersion | null> {
    try {
      const content = await fs.readFile(path.join(dir, this.workspaceFile), 'utf-8');
      const parsed = magicGridWorkspaceSchema.parse(JSON.parse(content));
      const manifest = this.normalizeManifest({
        ...parsed.manifest,
        version: (parsed.manifest as MagicGridManifestWithVersion).version ?? 1,
      });
      return this.normalizeWorkspace({ ...parsed, manifest });
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
