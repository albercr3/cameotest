import cors from 'cors';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';

import {
  DiagramsFile,
  ModelFile,
  WorkspaceFiles,
  WorkspaceManifest,
  diagramsFileSchema,
  parseSysmlPayload,
  modelFileSchema,
  workspaceToSysmlV2Json,
  workspaceToSysmlV2Text,
  IR_VERSION,
  validateWorkspace,
  validateWorkspaceFiles,
  workspaceManifestSchema,
} from '@cameotest/shared';

import { attachUser, requireUser, requireWorkspacePermission } from './auth.js';
import { FileWorkspaceRepository, VersionConflictError } from './workspaceRepository.js';

const app = express();
const port = process.env.PORT || 3001;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const baseWorkspacesDir =
  process.env.WORKSPACE_STORAGE_DIR ?? path.resolve(__dirname, '../../../data/workspaces');
const legacyWorkspacesDir = path.resolve(__dirname, '../../../examples/workspaces');

const repository = new FileWorkspaceRepository({ baseDir: baseWorkspacesDir, legacyDir: legacyWorkspacesDir });
await repository.bootstrapLegacyWorkspaces();

app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(attachUser());

let currentWorkspaceId: string | null = null;

function normalizeDiagrams(diagrams: DiagramsFile | undefined): DiagramsFile {
  if (!diagrams) return { diagrams: [] };
  const normalized = diagrams.diagrams.map((diagram) => ({
    ...diagram,
    kind: diagram.kind ?? diagram.type,
    type: diagram.type ?? diagram.kind,
  }));
  return { diagrams: normalized } satisfies DiagramsFile;
}

function ensureWorkspaceValid(candidate: WorkspaceFiles) {
  const validation = validateWorkspace(candidate);
  if (validation.issues.length > 0) {
    return { ok: false as const, validation } as const;
  }
  return { ok: true as const } as const;
}

function manifestFromSysml(sysmlManifest?: Partial<WorkspaceManifest>): WorkspaceManifest {
  const now = new Date().toISOString();
  return workspaceManifestSchema.parse({
    id: sysmlManifest?.id ?? 'sysmlv2-import',
    name: sysmlManifest?.name ?? sysmlManifest?.id ?? 'Imported SysML v2 workspace',
    description: sysmlManifest?.description ?? 'Imported from SysML v2 JSON',
    createdAt: sysmlManifest?.createdAt ?? now,
    updatedAt: now,
    version: sysmlManifest?.version ?? 1,
  });
}

function schemaVersionFromQuery(query: Record<string, unknown>): string {
  return (typeof query.schema === 'string' && query.schema) ||
    (typeof query.version === 'string' && query.version) ||
    IR_VERSION;
}

function starterWorkspace(manifest: WorkspaceManifest): WorkspaceFiles {
  const now = new Date().toISOString();
  const rootBlockId = uuid();
  const signalId = uuid();
  const diagramId = uuid();
  const rootNodeId = uuid();
  const rootBlock = {
    id: rootBlockId,
    metaclass: 'Block' as const,
    name: 'RootModel',
    ownerId: null,
    documentation: 'Base block for the workspace. Create child elements underneath.',
    stereotypes: [],
    tags: {},
    createdAt: now,
    updatedAt: now,
  } satisfies ModelFile['elements'][number];

  const baseSignal = {
    id: signalId,
    metaclass: 'Signal' as const,
    name: 'DefaultSignal',
    ownerId: rootBlockId,
    documentation: 'Starter signal to type ports.',
    stereotypes: [],
    tags: {},
    createdAt: now,
    updatedAt: now,
  } satisfies ModelFile['elements'][number];

  const starterDiagram = {
    id: diagramId,
    name: `${manifest.name} BDD`,
    kind: 'BDD' as const,
    type: 'BDD' as const,
    ownerId: rootBlockId,
    nodes: [
      {
        id: rootNodeId,
        elementId: rootBlockId,
        kind: 'Element' as const,
        x: 320,
        y: 180,
        w: 240,
        h: 140,
        compartments: { collapsed: false, showPorts: true, showParts: true },
        style: { highlight: false },
      },
    ],
    edges: [],
    viewSettings: { gridEnabled: true, snapEnabled: true, zoom: 1, panX: 0, panY: 0 },
  } satisfies DiagramsFile['diagrams'][number];

  return {
    manifest: { ...manifest, version: manifest.version ?? 1 },
    model: { elements: [rootBlock, baseSignal], relationships: [] },
    diagrams: { diagrams: [starterDiagram] },
  } satisfies WorkspaceFiles;
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/workspaces', requireUser(), async (_req, res) => {
  const workspaces = await repository.listWorkspaces();
  res.json(workspaces);
});

app.post('/api/workspaces', requireUser(), requireWorkspacePermission('write'), async (req, res) => {
  const { id, name, description } = req.body as Partial<WorkspaceManifest>;
  if (!id || !name) {
    return res.status(400).json({ message: 'id and name are required' });
  }
  const now = new Date().toISOString();
  try {
    const manifest = workspaceManifestSchema.parse({
      id,
      name,
      description,
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
    const created = await repository.createWorkspace(starterWorkspace(manifest), {
      ownerId: req.user?.id,
    });
    currentWorkspaceId = created.id;
    res.status(201).json(created);
  } catch (error) {
    res.status(400).json({ message: 'Unable to create workspace', details: String(error) });
  }
});

app.delete(
  '/api/workspaces/:id',
  requireUser(),
  requireWorkspacePermission('delete'),
  async (req, res) => {
    const { id } = req.params;
    const removed = await repository.deleteWorkspace(id);
    if (!removed) {
      return res.status(404).json({ message: `Workspace ${id} not found` });
    }
    if (currentWorkspaceId === id) {
      currentWorkspaceId = null;
    }
    res.status(204).end();
  },
);

app.post('/api/workspaces/:id/open', requireUser(), async (req, res) => {
  const { id } = req.params;
  try {
    const manifest = await repository.getManifest(id);
    if (!manifest) throw new Error('not found');
    currentWorkspaceId = manifest.id;
    res.json({ current: manifest });
  } catch (error) {
    res.status(404).json({ message: `Workspace ${id} not found`, details: String(error) });
  }
});

app.get('/api/workspaces/current', requireUser(), async (_req, res) => {
  const workspaceId = currentWorkspaceId;
  if (!workspaceId) {
    return res.status(400).json({ error: 'No workspace selected' });
  }
  try {
    const manifest = await repository.getManifest(workspaceId);
    if (!manifest) throw new Error('Missing manifest');
    res.json({ current: manifest });
  } catch (error) {
    res.status(404).json({ message: 'Current workspace unavailable', details: String(error) });
  }
});

app.get('/api/workspaces/current/load', requireUser(), async (_req, res) => {
  if (!currentWorkspaceId) {
    return res.status(400).json({ message: 'No workspace open' });
  }
  try {
    const workspace = await repository.getWorkspace(currentWorkspaceId);
    if (!workspace) throw new Error('Workspace not found');
    res.json(workspace);
  } catch (error) {
    res.status(500).json({ message: 'Failed to load workspace', details: String(error) });
  }
});

app.get('/api/workspaces/current/export', requireUser(), async (req, res) => {
  if (!currentWorkspaceId) {
    return res.status(400).json({ message: 'No workspace open' });
  }
  try {
    const workspace = await repository.getWorkspace(currentWorkspaceId);
    if (!workspace) throw new Error('Workspace not found');
    const format = typeof req.query.type === 'string' ? req.query.type : undefined;
    const schemaVersion = schemaVersionFromQuery(req.query as Record<string, unknown>);
    if (format === 'sysmlv2-json') {
      const bundle = workspaceToSysmlV2Json(workspace, {
        schemaVersion,
        manifestOverride: workspace.manifest,
      });
      return res.json(bundle);
    }
    if (format === 'sysmlv2-text') {
      const bundle = workspaceToSysmlV2Text(workspace, {
        schemaVersion,
        manifestOverride: workspace.manifest,
      });
      return res.json(bundle);
    }
    if (format === 'workspace-json') {
      return res.json({ type: 'workspace-json', workspace });
    }
    res.json(workspace);
  } catch (error) {
    res.status(500).json({ message: 'Failed to export workspace', details: String(error) });
  }
});

app.post('/api/workspaces/current/save', requireUser(), requireWorkspacePermission('write'), async (req, res) => {
  if (!currentWorkspaceId) {
    return res.status(400).json({ message: 'No workspace open' });
  }
  try {
    const candidate = req.body as WorkspaceFiles;
    const validated = validateWorkspaceFiles(candidate);
    const expectedVersion = validated.manifest.version;
    const workspace: WorkspaceFiles = { ...validated, manifest: { ...validated.manifest, id: currentWorkspaceId } };
    const validity = ensureWorkspaceValid(workspace);
    if (!validity.ok) {
      return res.status(400).json({ message: 'Validation failed', issues: validity.validation.issues });
    }
    const manifest = await repository.saveWorkspace(workspace, expectedVersion, {
      ownerId: req.user?.id,
    });
    currentWorkspaceId = manifest.id;
    res.json({ status: 'saved', manifest });
  } catch (error) {
    if (error instanceof VersionConflictError) {
      return res.status(409).json({
        message: 'Workspace has been updated elsewhere',
        expected: error.expected,
        actual: error.actual,
      });
    }
    res.status(400).json({ message: 'Save failed', details: String(error) });
  }
});

app.post('/api/workspaces/current/import', requireUser(), requireWorkspacePermission('write'), async (req, res) => {
  const workspaceId = currentWorkspaceId;
  if (!workspaceId) {
    return res.status(400).json({ error: 'No workspace selected' });
  }
  try {
    const existing = await repository.getWorkspace(workspaceId);
    if (!existing) {
      return res.status(404).json({ message: 'Workspace not found' });
    }
    const rawManifest =
      (req.body as { manifest?: Partial<WorkspaceManifest> }).manifest ??
      (req.body as { sysml?: { manifest?: Partial<WorkspaceManifest> } }).sysml?.manifest;
    const manifestOverride = {
      ...manifestFromSysml(rawManifest),
      id: existing.manifest.id,
      createdAt: existing.manifest.createdAt,
      version: existing.manifest.version,
    } satisfies WorkspaceManifest;
    const sysmlWorkspace = parseSysmlPayload(req.body, {
      manifestOverride: { ...manifestOverride, updatedAt: new Date().toISOString() },
    });

    if (sysmlWorkspace) {
      const workspace: WorkspaceFiles = {
        manifest: { ...sysmlWorkspace.manifest, id: existing.manifest.id },
        model: sysmlWorkspace.model,
        diagrams: normalizeDiagrams(sysmlWorkspace.diagrams),
      };
      const validity = ensureWorkspaceValid(workspace);
      if (!validity.ok) {
        return res.status(400).json({ message: 'Validation failed', issues: validity.validation.issues });
      }
      const savedManifest = await repository.saveWorkspace(workspace, existing.manifest.version, {
        ownerId: req.user?.id,
      });
      return res.json({ status: 'imported', manifest: savedManifest });
    }

    const body = req.body as Partial<WorkspaceFiles> & { model?: ModelFile };
    if (!body.model) {
      return res.status(400).json({ message: 'model payload is required' });
    }
    const model = modelFileSchema.parse(body.model);
    const manifest = { ...existing.manifest, updatedAt: new Date().toISOString() };
    const diagrams = existing.diagrams;
    const workspace: WorkspaceFiles = { manifest, model, diagrams };
    const validity = ensureWorkspaceValid(workspace);
    if (!validity.ok) {
      return res.status(400).json({ message: 'Validation failed', issues: validity.validation.issues });
    }
    const savedManifest = await repository.saveWorkspace(workspace, existing.manifest.version, {
      ownerId: req.user?.id,
    });
    res.json({ status: 'imported', manifest: savedManifest });
  } catch (error) {
    res.status(400).json({ message: 'Import failed', details: String(error) });
  }
});

app.post('/api/workspaces/import', requireUser(), requireWorkspacePermission('write'), async (req, res) => {
  try {
    const rawManifest =
      (req.body as { manifest?: Partial<WorkspaceManifest> }).manifest ??
      (req.body as { sysml?: { manifest?: Partial<WorkspaceManifest> } }).sysml?.manifest;
    const sysmlWorkspace = parseSysmlPayload(req.body, {
      manifestOverride: manifestFromSysml(rawManifest),
    });

    if (sysmlWorkspace) {
      const validated = validateWorkspaceFiles(sysmlWorkspace);
      const validity = ensureWorkspaceValid(validated);
      if (!validity.ok) {
        return res.status(400).json({ message: 'Validation failed', issues: validity.validation.issues });
      }
      const createdManifest = await repository.createWorkspace(validated, { ownerId: req.user?.id });
      currentWorkspaceId = createdManifest.id;
      return res.status(201).json({ status: 'imported', manifest: createdManifest });
    }

    const candidate = (req.body as { workspace?: WorkspaceFiles } & Partial<WorkspaceFiles>).workspace ?? req.body;
    const validated = validateWorkspaceFiles(candidate as WorkspaceFiles);
    const manifest = workspaceManifestSchema.parse({ ...validated.manifest, version: 1 });
    const workspace: WorkspaceFiles = { ...validated, manifest };
    const validity = ensureWorkspaceValid(workspace);
    if (!validity.ok) {
      return res.status(400).json({ message: 'Validation failed', issues: validity.validation.issues });
    }
    const createdManifest = await repository.createWorkspace(workspace, { ownerId: req.user?.id });
    currentWorkspaceId = createdManifest.id;
    res.status(201).json({ status: 'imported', manifest: createdManifest });
  } catch (error) {
    res.status(400).json({ message: 'Import failed', details: String(error) });
  }
});

app.post(
  '/api/workspaces/current/duplicate',
  requireUser(),
  requireWorkspacePermission('write'),
  async (req, res) => {
    if (!currentWorkspaceId) return res.status(400).json({ message: 'No workspace open' });
    const { id, name, version } = req.body as Partial<WorkspaceManifest>;
    if (!id || !name) return res.status(400).json({ message: 'id and name are required' });
    try {
      const sourceManifest = await repository.getManifest(currentWorkspaceId);
      if (!sourceManifest) return res.status(404).json({ message: 'Source workspace not found' });
      if (version !== sourceManifest.version) {
        return res.status(409).json({
          message: 'Workspace has been updated elsewhere',
          expected: version,
          actual: sourceManifest.version,
        });
      }
      const manifest: WorkspaceManifest = {
        id,
        name,
        description: sourceManifest.description,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      };
      const duplicated = await repository.duplicateWorkspace(currentWorkspaceId, manifest, {
        ownerId: req.user?.id,
      });
      currentWorkspaceId = duplicated.id;
      res.status(201).json({ status: 'duplicated', manifest: duplicated });
    } catch (error) {
      res.status(400).json({ message: 'Duplicate failed', details: String(error) });
    }
  },
);

app.post('/api/workspaces/current/new-id', requireUser(), (_req, res) => {
  res.json({ id: uuid() });
});

app.listen(port, () => {
  console.log(`Workspace server listening on port ${port}`);
});
