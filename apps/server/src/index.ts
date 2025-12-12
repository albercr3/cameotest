import cors from 'cors';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import type { Workspace, WorkspaceMetadata } from '@cameotest/shared';

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspacesDir = path.resolve(__dirname, '../../../examples/workspaces');

interface WorkspaceStore {
  list: WorkspaceMetadata[];
  map: Map<string, Workspace>;
}

function isWorkspace(value: unknown): value is Workspace {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    Array.isArray(candidate.nodes) &&
    Array.isArray(candidate.connections)
  );
}

function loadWorkspaces(): WorkspaceStore {
  const files = fs.readdirSync(workspacesDir).filter((file) => file.endsWith('.json'));
  const map = new Map<string, Workspace>();

  for (const file of files) {
    const workspacePath = path.join(workspacesDir, file);
    const content = fs.readFileSync(workspacePath, 'utf-8');
    try {
      const workspace = JSON.parse(content) as unknown;
      if (isWorkspace(workspace)) {
        map.set(workspace.id, workspace);
      } else {
        console.warn(`Skipping invalid workspace file: ${file}`);
      }
    } catch (error) {
      console.warn(`Failed to parse workspace file ${file}:`, error);
    }
  }

  const list = Array.from(map.values()).map(({ id, name, description }) => ({ id, name, description }));
  return { list, map };
}

const workspaceStore = loadWorkspaces();

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/workspaces', (_req, res) => {
  res.json(workspaceStore.list);
});

app.get('/api/workspaces/:id', (req, res) => {
  const workspace = workspaceStore.map.get(req.params.id);
  if (!workspace) {
    return res.status(404).json({ message: 'Workspace not found' });
  }
  res.json(workspace);
});

app.listen(port, () => {
  console.log(`Workspace server listening on port ${port}`);
});
