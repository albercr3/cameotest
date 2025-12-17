import cors from 'cors';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { v4 as uuid } from 'uuid';

import {
  DiagramsFile,
  ModelFile,
  WorkspaceFiles,
  WorkspaceManifest,
  diagramsFileSchema,
  modelFileSchema,
  sysmlV2JsonSchema,
  validateWorkspaceFiles,
  workspaceManifestSchema,
} from '@cameotest/shared';

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '25mb' }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspacesDir = path.resolve(__dirname, '../../../examples/workspaces');

let currentWorkspaceId: string | null = null;

function sanitizeWorkspaceId(rawId: string) {
  const safe = rawId.replace(/[^a-zA-Z0-9-_]/g, '_').slice(0, 80) || uuid();
  return safe;
}

function ensureWorkspaceDir(id: string) {
  const target = path.join(workspacesDir, id);
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }
  return target;
}

function nextAvailableWorkspaceId(id: string) {
  const base = sanitizeWorkspaceId(id);
  let candidate = base;
  let suffix = 2;
  while (fs.existsSync(path.join(workspacesDir, candidate))) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

function deleteWorkspaceDir(id: string) {
  const target = path.join(workspacesDir, id);
  if (!fs.existsSync(target)) {
    return false;
  }
  fs.rmSync(target, { recursive: true, force: true });
  return true;
}

function loadManifest(id: string): WorkspaceManifest {
  const manifestPath = path.join(workspacesDir, id, 'workspace.json');
  const content = fs.readFileSync(manifestPath, 'utf-8');
  const parsed = workspaceManifestSchema.parse(JSON.parse(content));
  return parsed;
}

function loadModel(id: string): ModelFile {
  const modelPath = path.join(workspacesDir, id, 'model.json');
  const parsed = modelFileSchema.parse(JSON.parse(fs.readFileSync(modelPath, 'utf-8')));
  return parsed;
}

function loadDiagrams(id: string): DiagramsFile {
  const diagramPath = path.join(workspacesDir, id, 'diagrams.json');
  const parsed = diagramsFileSchema.parse(JSON.parse(fs.readFileSync(diagramPath, 'utf-8')));
  return parsed;
}

function loadWorkspace(id: string): WorkspaceFiles {
  return {
    manifest: loadManifest(id),
    model: loadModel(id),
    diagrams: loadDiagrams(id),
  };
}

function listWorkspaces(): WorkspaceManifest[] {
  if (!fs.existsSync(workspacesDir)) {
    return [];
  }
  return fs
    .readdirSync(workspacesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .flatMap((id) => {
      try {
        return [loadManifest(id)];
      } catch {
        return [];
      }
    });
}

function manifestFromSysml(sysmlManifest?: Partial<WorkspaceManifest>): WorkspaceManifest {
  const now = new Date().toISOString();
  const baseId = sysmlManifest?.id ?? 'sysmlv2-import';
  return {
    id: nextAvailableWorkspaceId(baseId),
    name: sysmlManifest?.name ?? sysmlManifest?.id ?? 'Imported SysML v2 workspace',
    description: sysmlManifest?.description ?? 'Imported from SysML v2 JSON',
    createdAt: sysmlManifest?.createdAt ?? now,
    updatedAt: now,
  } satisfies WorkspaceManifest;
}

function writeWorkspace(files: WorkspaceFiles) {
  const id = sanitizeWorkspaceId(files.manifest.id);
  const manifest = { ...files.manifest, id };
  const dir = ensureWorkspaceDir(id);
  fs.writeFileSync(path.join(dir, 'workspace.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(dir, 'model.json'), JSON.stringify(files.model, null, 2));
  fs.writeFileSync(path.join(dir, 'diagrams.json'), JSON.stringify(files.diagrams, null, 2));
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
      },
    ],
    edges: [],
    viewSettings: { gridEnabled: true, snapEnabled: true, zoom: 1, panX: 0, panY: 0 },
  } satisfies DiagramsFile['diagrams'][number];

  return {
    manifest,
    model: { elements: [rootBlock, baseSignal], relationships: [] },
    diagrams: { diagrams: [starterDiagram] },
  } satisfies WorkspaceFiles;
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/workspaces', (_req, res) => {
  res.json(listWorkspaces());
});

app.post('/api/workspaces', (req, res) => {
  const { id, name, description } = req.body as Partial<WorkspaceManifest>;
  if (!id || !name) {
    return res.status(400).json({ message: 'id and name are required' });
  }
  const safeId = nextAvailableWorkspaceId(id);
  const now = new Date().toISOString();
  const manifest: WorkspaceManifest = {
    id: safeId,
    name,
    description,
    createdAt: now,
    updatedAt: now,
  };
  const starter = starterWorkspace(manifest);
  writeWorkspace(starter);
  currentWorkspaceId = manifest.id;
  res.status(201).json(manifest);
});

app.delete('/api/workspaces/:id', (req, res) => {
  const { id: rawId } = req.params;
  const id = sanitizeWorkspaceId(rawId);
  const removed = deleteWorkspaceDir(id);
  if (!removed) {
    return res.status(404).json({ message: `Workspace ${id} not found` });
  }
  if (currentWorkspaceId === id) {
    currentWorkspaceId = null;
  }
  res.status(204).end();
});

app.post('/api/workspaces/:id/open', (req, res) => {
  const { id: rawId } = req.params;
  const id = sanitizeWorkspaceId(rawId);
  try {
    const manifest = loadManifest(id);
    currentWorkspaceId = manifest.id;
    res.json({ current: manifest });
  } catch (error) {
    res.status(404).json({ message: `Workspace ${id} not found`, details: String(error) });
  }
});

app.get('/api/workspaces/current', (_req, res) => {
  const workspaceId = currentWorkspaceId;
  if (!workspaceId) {
    return res.status(400).json({ error: 'No workspace selected' });
  }
  try {
    const manifest = loadManifest(workspaceId);
    res.json({ current: manifest });
  } catch (error) {
    res.status(404).json({ message: 'Current workspace unavailable', details: String(error) });
  }
});

app.get('/api/workspaces/current/load', (_req, res) => {
  if (!currentWorkspaceId) {
    return res.status(400).json({ message: 'No workspace open' });
  }
  try {
    res.json(loadWorkspace(currentWorkspaceId));
  } catch (error) {
    res.status(500).json({ message: 'Failed to load workspace', details: String(error) });
  }
});

app.get('/api/workspaces/current/export', (req, res) => {
  if (!currentWorkspaceId) {
    return res.status(400).json({ message: 'No workspace open' });
  }
  try {
    const workspace = loadWorkspace(currentWorkspaceId);
    const format = typeof req.query.type === 'string' ? req.query.type : undefined;
    if (format === 'sysmlv2-json') {
      return res.json({ type: 'sysmlv2-json', ...workspace });
    }
    if (format === 'workspace-json') {
      return res.json({ type: 'workspace-json', workspace });
    }
    res.json(workspace);
  } catch (error) {
    res.status(500).json({ message: 'Failed to export workspace', details: String(error) });
  }
});

app.post('/api/workspaces/current/save', (req, res) => {
  if (!currentWorkspaceId) {
    return res.status(400).json({ message: 'No workspace open' });
  }
  try {
    const candidate = req.body as WorkspaceFiles;
    const validated = validateWorkspaceFiles(candidate);
    const manifest = { ...validated.manifest, id: sanitizeWorkspaceId(validated.manifest.id) };
    const workspace: WorkspaceFiles = { ...validated, manifest };
    writeWorkspace(workspace);
    currentWorkspaceId = manifest.id;
    res.json({ status: 'saved', workspace: manifest });
  } catch (error) {
    res.status(400).json({ message: 'Save failed', details: String(error) });
  }
});

app.post('/api/workspaces/current/import', (req, res) => {
  const workspaceId = currentWorkspaceId;
  if (!workspaceId) {
    return res.status(400).json({ error: 'No workspace selected' });
  }
  try {
    const body = req.body as Partial<WorkspaceFiles> & { model?: ModelFile };
    if (!body.model) {
      return res.status(400).json({ message: 'model payload is required' });
    }
    const model = modelFileSchema.parse(body.model);
    const manifest = loadManifest(workspaceId);
    const diagrams = loadDiagrams(workspaceId);
    manifest.updatedAt = new Date().toISOString();
    writeWorkspace({ manifest, model, diagrams });
    res.json({ status: 'imported', manifest });
  } catch (error) {
    res.status(400).json({ message: 'Import failed', details: String(error) });
  }
});

app.post('/api/workspaces/import', (req, res) => {
  try {
    if (req.body?.type === 'sysmlv2-json') {
      const sysml = sysmlV2JsonSchema.parse(req.body.sysml ?? req.body);
      const manifest = manifestFromSysml(sysml.manifest);
      const workspace: WorkspaceFiles = {
        manifest,
        model: sysml.model,
        diagrams: sysml.diagrams ?? { diagrams: [] },
      };
      const validated = validateWorkspaceFiles(workspace);
      writeWorkspace(validated);
      currentWorkspaceId = validated.manifest.id;
      return res.status(201).json({ status: 'imported', manifest: validated.manifest });
    }

    const candidate = (req.body as { workspace?: WorkspaceFiles } & Partial<WorkspaceFiles>).workspace ?? req.body;
    const validated = validateWorkspaceFiles(candidate as WorkspaceFiles);
    const manifest = { ...validated.manifest, id: nextAvailableWorkspaceId(validated.manifest.id) };
    const workspace: WorkspaceFiles = { ...validated, manifest };
    writeWorkspace(workspace);
    currentWorkspaceId = manifest.id;
    res.status(201).json({ status: 'imported', manifest });
  } catch (error) {
    res.status(400).json({ message: 'Import failed', details: String(error) });
  }
});

app.post('/api/workspaces/current/duplicate', (req, res) => {
  if (!currentWorkspaceId) return res.status(400).json({ message: 'No workspace open' });
  const { id, name } = req.body as Partial<WorkspaceManifest>;
  if (!id || !name) return res.status(400).json({ message: 'id and name are required' });
  try {
    const source = loadWorkspace(currentWorkspaceId);
    const manifest: WorkspaceManifest = {
      id: sanitizeWorkspaceId(id),
      name,
      description: source.manifest.description,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    writeWorkspace({ manifest, model: source.model, diagrams: source.diagrams });
    currentWorkspaceId = manifest.id;
    res.status(201).json({ status: 'duplicated', manifest });
  } catch (error) {
    res.status(400).json({ message: 'Duplicate failed', details: String(error) });
  }
});

app.post('/api/workspaces/current/new-id', (_req, res) => {
  res.json({ id: uuid() });
});

app.listen(port, () => {
  console.log(`Workspace server listening on port ${port}`);
});
