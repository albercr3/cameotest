import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { Express } from 'express';
import type { WorkspaceFiles, WorkspaceManifest } from '@cameotest/shared';

type JsonValue = Record<string, unknown> | string | number | boolean | null | undefined;

class ApiClient {
  private readonly server;
  private readonly baseUrl: string;

  constructor(private readonly app: Express) {
    this.server = app.listen(0);
    const address = this.server.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${address.port}`;
  }

  async request(pathname: string, init: RequestInit = {}) {
    const { body, headers = {}, ...rest } = init;
    const normalizedHeaders = body ? { 'content-type': 'application/json', ...headers } : headers;
    const response = await fetch(`${this.baseUrl}${pathname}`, {
      ...rest,
      headers: normalizedHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let parsed: JsonValue = text;
    try {
      parsed = text ? (JSON.parse(text) as JsonValue) : undefined;
    } catch {
      parsed = text;
    }
    return { status: response.status, body: parsed };
  }

  async close() {
    await new Promise<void>((resolve, reject) => {
      this.server.close((error?: Error | null) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

let tempDir: string;
let app: Express;
let client: ApiClient;

async function loadApp() {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-api-'));
  process.env.NODE_ENV = 'test';
  process.env.WORKSPACE_STORAGE_DIR = path.join(tempDir, 'workspaces');
  process.env.MAGICGRID_STORAGE_DIR = path.join(tempDir, 'magicgrid');
  const module = await import(`../index.js?ts=${Date.now()}`);
  app = module.app as Express;
  client = new ApiClient(app);
}

describe('workspace API', () => {
  beforeEach(async () => {
    await loadApp();
  });

  afterEach(async () => {
    await client.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('handles workspace create, open, save, duplicate, and delete flows', async () => {
    const createResponse = await client.request('/api/workspaces', {
      method: 'POST',
      body: { id: 'api-workspace', name: 'API Workspace' },
    });

    assert.equal(createResponse.status, 201);
    const createdManifest = createResponse.body as WorkspaceManifest;
    const workspaceId = createdManifest.id;

    const listResponse = await client.request('/api/workspaces');
    assert.equal(listResponse.status, 200);
    const manifests = listResponse.body as WorkspaceManifest[];
    assert.ok(manifests.some((manifest) => manifest.id === workspaceId));

    const openResponse = await client.request(`/api/workspaces/${workspaceId}/open`, { method: 'POST' });
    assert.equal(openResponse.status, 200);

    const loadResponse = await client.request('/api/workspaces/current/load');
    assert.equal(loadResponse.status, 200);
    const workspace = loadResponse.body as WorkspaceFiles;

    const sanitizedWorkspace: WorkspaceFiles = {
      manifest: { ...workspace.manifest, name: 'Updated API Workspace' },
      model: { elements: [], relationships: [] },
      diagrams: { diagrams: [] },
    };

    const saveResponse = await client.request('/api/workspaces/current/save', {
      method: 'POST',
      body: sanitizedWorkspace,
    });
    assert.equal(saveResponse.status, 200, JSON.stringify(saveResponse.body));
    const savedManifest = (saveResponse.body as { manifest: WorkspaceManifest }).manifest;
    assert.equal(savedManifest.version, workspace.manifest.version + 1);

    const duplicateId = 'api-workspace-copy';
    const duplicateResponse = await client.request('/api/workspaces/current/duplicate', {
      method: 'POST',
      body: { id: duplicateId, name: 'API Workspace Copy', version: savedManifest.version },
    });
    assert.equal(duplicateResponse.status, 201);
    const duplicatedManifest = (duplicateResponse.body as { manifest: WorkspaceManifest }).manifest;
    assert.equal(duplicatedManifest.id, duplicateId);
    assert.equal(duplicatedManifest.version, 1);

    const deleteResponse = await client.request(`/api/workspaces/${duplicateId}`, { method: 'DELETE' });
    assert.equal(deleteResponse.status, 204);
    const postDeleteList = await client.request('/api/workspaces');
    assert.equal(postDeleteList.status, 200);
    const remainingManifests = postDeleteList.body as WorkspaceManifest[];
    assert.ok(!remainingManifests.find((manifest) => manifest.id === duplicateId));
  });

  it('rejects invalid workspace payloads', async () => {
    const invalidCreate = await client.request('/api/workspaces', {
      method: 'POST',
      body: { name: 'Missing id' },
    });
    assert.equal(invalidCreate.status, 400);
    assert.equal((invalidCreate.body as { message?: string }).message, 'id and name are required');

    const manifest = { id: 'valid-workspace', name: 'Valid Workspace' };
    const validCreate = await client.request('/api/workspaces', { method: 'POST', body: manifest });
    assert.equal(validCreate.status, 201);

    const openResponse = await client.request(`/api/workspaces/${manifest.id}/open`, { method: 'POST' });
    assert.equal(openResponse.status, 200);

    const loadResponse = await client.request('/api/workspaces/current/load');
    assert.equal(loadResponse.status, 200);
    const workspace = loadResponse.body as WorkspaceFiles;

    const invalidSave = await client.request('/api/workspaces/current/save', {
      method: 'POST',
      body: { ...workspace, manifest: { ...workspace.manifest, createdAt: 'not-a-date' } },
    });
    assert.equal(invalidSave.status, 400);
    const details = invalidSave.body as { message?: string; details?: string };
    assert.equal(details.message, 'Save failed');
    assert.ok(String(details.details).includes('Invalid workspace manifest'));
  });
});
