import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { Express } from 'express';
import { MAGICGRID_VERSION, type MagicGridWorkspace } from '@cameotest/magicgrid';

import type { MagicGridManifestWithVersion } from '../magicgridRepository.js';

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
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'magicgrid-api-'));
  process.env.NODE_ENV = 'test';
  process.env.WORKSPACE_STORAGE_DIR = path.join(tempDir, 'workspaces');
  process.env.MAGICGRID_STORAGE_DIR = path.join(tempDir, 'magicgrid');
  const module = await import(`../index.js?ts=${Date.now()}`);
  app = module.app as Express;
  client = new ApiClient(app);
}

describe('magicgrid migration API', () => {
  beforeEach(async () => {
    await loadApp();
  });

  afterEach(async () => {
    await client.close();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('upgrades legacy magicgrid workspaces on load', async () => {
    const createResponse = await client.request('/api/magicgrid/workspaces', {
      method: 'POST',
      body: { id: 'legacy-magicgrid', name: 'Legacy MagicGrid' },
    });
    assert.equal(createResponse.status, 201);
    const createdManifest = createResponse.body as MagicGridManifestWithVersion;

    const workspaceFile = path.join(
      tempDir,
      'magicgrid',
      createdManifest.id,
      'workspace.json',
    );
    const raw = JSON.parse(await fs.readFile(workspaceFile, 'utf-8')) as MagicGridWorkspace;
    delete (raw.manifest as Record<string, unknown>).schemaVersion;
    delete (raw.manifest as Record<string, unknown>).migratedFromVersion;
    await fs.writeFile(workspaceFile, JSON.stringify(raw, null, 2), 'utf-8');
    const legacyCopy = JSON.parse(await fs.readFile(workspaceFile, 'utf-8')) as MagicGridWorkspace;
    assert.equal((legacyCopy.manifest as Record<string, unknown>).schemaVersion, undefined);

    const openResponse = await client.request(`/api/magicgrid/workspaces/${createdManifest.id}/open`, {
      method: 'POST',
    });
    assert.equal(openResponse.status, 200);

    const loadResponse = await client.request('/api/magicgrid/workspaces/current/load');
    assert.equal(loadResponse.status, 200);
    const workspace = loadResponse.body as MagicGridWorkspace;
    assert.equal(workspace.manifest.schemaVersion, MAGICGRID_VERSION);
    assert.equal(workspace.manifest.migratedFromVersion, '0.0.0');
    const migratedFile = JSON.parse(await fs.readFile(workspaceFile, 'utf-8')) as MagicGridWorkspace;
    assert.equal(migratedFile.manifest.migratedFromVersion, '0.0.0');
  });

  it('blocks unsupported magicgrid schema versions and surfaces migration endpoint', async () => {
    const createResponse = await client.request('/api/magicgrid/workspaces', {
      method: 'POST',
      body: { id: 'unsupported-magicgrid', name: 'Unsupported MagicGrid' },
    });
    assert.equal(createResponse.status, 201);
    const createdManifest = createResponse.body as MagicGridManifestWithVersion;

    const workspaceFile = path.join(
      tempDir,
      'magicgrid',
      createdManifest.id,
      'workspace.json',
    );
    const raw = JSON.parse(await fs.readFile(workspaceFile, 'utf-8')) as MagicGridWorkspace;
    (raw.manifest as Record<string, unknown>).schemaVersion = '9.9.9';
    await fs.writeFile(workspaceFile, JSON.stringify(raw, null, 2), 'utf-8');

    const openResponse = await client.request(`/api/magicgrid/workspaces/${createdManifest.id}/open`, {
      method: 'POST',
    });
    assert.equal(openResponse.status, 409);

    const migrateResponse = await client.request(`/api/magicgrid/workspaces/${createdManifest.id}/migrate`, {
      method: 'POST',
    });
    assert.equal(migrateResponse.status, 409);
    assert.ok(String((migrateResponse.body as { message?: string }).message).includes('unsupported'));
  });
});
