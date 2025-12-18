import path from 'path';
import { promises as fs } from 'fs';
import {
  DiagramsFile,
  WorkspaceFiles,
  WorkspaceManifest,
  workspaceManifestSchema,
  validateWorkspaceFiles,
} from '@cameotest/shared';

export interface WorkspaceMetadata {
  ownerId?: string;
  labels?: string[];
  archived?: boolean;
}

export interface WorkspaceRepositoryOptions {
  baseDir: string;
  legacyDir?: string;
}

export class VersionConflictError extends Error {
  constructor(
    message: string,
    public readonly workspaceId: string,
    public readonly expected: number,
    public readonly actual: number,
  ) {
    super(message);
  }
}

export interface WorkspaceRepository {
  listWorkspaces(): Promise<WorkspaceManifest[]>;
  getWorkspace(id: string): Promise<WorkspaceFiles | null>;
  getManifest(id: string): Promise<WorkspaceManifest | null>;
  createWorkspace(files: WorkspaceFiles, metadata?: WorkspaceMetadata): Promise<WorkspaceManifest>;
  saveWorkspace(
    files: WorkspaceFiles,
    expectedVersion?: number,
    metadata?: WorkspaceMetadata,
  ): Promise<WorkspaceManifest>;
  deleteWorkspace(id: string): Promise<boolean>;
  duplicateWorkspace(
    sourceId: string,
    manifest: WorkspaceManifest,
    metadata?: WorkspaceMetadata,
  ): Promise<WorkspaceManifest>;
  nextAvailableId(baseId: string): Promise<string>;
  bootstrapLegacyWorkspaces(): Promise<void>;
}

export class FileWorkspaceRepository implements WorkspaceRepository {
  private readonly metadataFile = 'metadata.json';

  constructor(private readonly options: WorkspaceRepositoryOptions) {}

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
      const manifest = { ...legacyWorkspace.manifest, version: legacyWorkspace.manifest.version ?? 1 };
      await this.createWorkspace({ ...legacyWorkspace, manifest });
    }
  }

  async listWorkspaces(): Promise<WorkspaceManifest[]> {
    if (!(await this.pathExists(this.options.baseDir))) {
      await fs.mkdir(this.options.baseDir, { recursive: true });
      return [];
    }

    const entries = await fs.readdir(this.options.baseDir, { withFileTypes: true });
    const manifests: WorkspaceManifest[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const manifest = await this.readManifest(entry.name);
      if (manifest) {
        manifests.push(manifest);
      }
    }
    return manifests;
  }

  async getWorkspace(id: string): Promise<WorkspaceFiles | null> {
    const manifest = await this.readManifest(id);
    if (!manifest) return null;
    const dir = this.workspaceDir(id);
    try {
      const [model, diagrams] = await Promise.all([
        fs.readFile(path.join(dir, 'model.json'), 'utf-8').then((content) => JSON.parse(content)),
        fs
          .readFile(path.join(dir, 'diagrams.json'), 'utf-8')
          .then((content) => this.normalizeDiagrams(JSON.parse(content) as DiagramsFile)),
      ]);
      return validateWorkspaceFiles({ manifest, model, diagrams });
    } catch {
      return null;
    }
  }

  async getManifest(id: string): Promise<WorkspaceManifest | null> {
    return this.readManifest(id);
  }

  async createWorkspace(files: WorkspaceFiles, metadata?: WorkspaceMetadata): Promise<WorkspaceManifest> {
    const id = await this.nextAvailableId(files.manifest.id);
    const manifest = this.normalizeManifest({ ...files.manifest, id, version: files.manifest.version ?? 1 });
    const workspace = validateWorkspaceFiles({ ...files, manifest });
    await this.writeWorkspace(workspace, metadata);
    return manifest;
  }

  async saveWorkspace(
    files: WorkspaceFiles,
    expectedVersion?: number,
    metadata?: WorkspaceMetadata,
  ): Promise<WorkspaceManifest> {
    const id = this.sanitizeWorkspaceId(files.manifest.id);
    const existing = await this.readManifest(id);
    if (!existing) {
      throw new Error(`Workspace ${id} not found`);
    }
    const currentVersion = existing.version ?? 1;
    const requiredVersion = expectedVersion ?? files.manifest.version ?? currentVersion;
    if (requiredVersion !== currentVersion) {
      throw new VersionConflictError(
        `Version conflict for workspace ${id}`,
        id,
        requiredVersion,
        currentVersion,
      );
    }

    const manifest: WorkspaceManifest = this.normalizeManifest({
      ...files.manifest,
      id,
      version: currentVersion + 1,
      updatedAt: new Date().toISOString(),
    });
    const workspace = validateWorkspaceFiles({ ...files, manifest });
    await this.writeWorkspace(workspace, metadata ?? (await this.readMetadata(id)) ?? undefined);
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
    manifest: WorkspaceManifest,
    metadata?: WorkspaceMetadata,
  ): Promise<WorkspaceManifest> {
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
    await this.writeWorkspace({ manifest: nextManifest, model: source.model, diagrams: source.diagrams }, metadata);
    return nextManifest;
  }

  async nextAvailableId(rawId: string): Promise<string> {
    const base = this.sanitizeWorkspaceId(rawId);
    let candidate = base;
    let suffix = 2;
    while (await this.pathExists(this.workspaceDir(candidate))) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  private sanitizeWorkspaceId(rawId: string): string {
    return rawId.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 80) || 'workspace';
  }

  private workspaceDir(id: string): string {
    return path.join(this.options.baseDir, this.sanitizeWorkspaceId(id));
  }

  private normalizeManifest(manifest: WorkspaceManifest): WorkspaceManifest {
    const parsed = workspaceManifestSchema.parse({ ...manifest, version: manifest.version ?? 1 });
    return { ...parsed, id: this.sanitizeWorkspaceId(parsed.id) } satisfies WorkspaceManifest;
  }

  private async readManifest(id: string): Promise<WorkspaceManifest | null> {
    const dir = this.workspaceDir(id);
    try {
      const content = await fs.readFile(path.join(dir, 'workspace.json'), 'utf-8');
      const manifest = workspaceManifestSchema.parse(JSON.parse(content));
      return this.normalizeManifest(manifest);
    } catch {
      return null;
    }
  }

  private async readWorkspaceFromDir(dir: string): Promise<WorkspaceFiles | null> {
    try {
      const [manifestContent, modelContent, diagramsContent] = await Promise.all([
        fs.readFile(path.join(dir, 'workspace.json'), 'utf-8'),
        fs.readFile(path.join(dir, 'model.json'), 'utf-8'),
        fs.readFile(path.join(dir, 'diagrams.json'), 'utf-8'),
      ]);
      const manifest = workspaceManifestSchema.parse(JSON.parse(manifestContent));
      return validateWorkspaceFiles({
        manifest: this.normalizeManifest(manifest),
        model: JSON.parse(modelContent),
        diagrams: this.normalizeDiagrams(JSON.parse(diagramsContent) as DiagramsFile),
      });
    } catch {
      return null;
    }
  }

  private async writeWorkspace(files: WorkspaceFiles, metadata?: WorkspaceMetadata) {
    const dir = this.workspaceDir(files.manifest.id);
    await fs.mkdir(dir, { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(dir, 'workspace.json'), JSON.stringify(files.manifest, null, 2), 'utf-8'),
      fs.writeFile(path.join(dir, 'model.json'), JSON.stringify(files.model, null, 2), 'utf-8'),
      fs.writeFile(path.join(dir, 'diagrams.json'), JSON.stringify(files.diagrams, null, 2), 'utf-8'),
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

  private async pathExists(target: string): Promise<boolean> {
    try {
      await fs.access(target);
      return true;
    } catch {
      return false;
    }
  }

  private normalizeMetadata(metadata?: WorkspaceMetadata): WorkspaceMetadata {
    return {
      ownerId: metadata?.ownerId,
      archived: metadata?.archived ?? false,
      labels: metadata?.labels ?? [],
    };
  }

  private normalizeDiagrams(diagrams?: DiagramsFile): DiagramsFile {
    if (!diagrams?.diagrams) return { diagrams: [] };
    return {
      diagrams: diagrams.diagrams.map((diagram) => ({
        ...diagram,
        kind: diagram.kind ?? diagram.type,
        type: diagram.type ?? diagram.kind,
      })),
    } satisfies DiagramsFile;
  }
}
