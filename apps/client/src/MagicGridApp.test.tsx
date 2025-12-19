import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { defaultConstraints, defaultGridElements, defaultLayoutMetadata, defaultMagicGridWorkspace } from '@cameotest/magicgrid';
import { cleanup, render, waitFor } from '@testing-library/react';

import { MagicGridApp, type MagicGridManifestWithVersion, type MagicGridWorkspaceWithVersion } from './MagicGridApp';

type FetchCall = [RequestInfo | URL, RequestInit | undefined];
type MockResponse = Response | Promise<Response>;

const originalFetch = global.fetch;
let domInstance: JSDOM | null = null;
type UserEventSetupOptions = Parameters<(typeof import('@testing-library/user-event'))['default']['setup']>[0];

async function createUser(options?: UserEventSetupOptions) {
  const userEvent = (await import('@testing-library/user-event')).default;
  return userEvent.setup(options);
}

function createDom() {
  domInstance?.window.close();
  domInstance = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  const { window } = domInstance;
  Reflect.deleteProperty(globalThis, 'window');
  Reflect.deleteProperty(globalThis, 'document');
  Reflect.deleteProperty(globalThis, 'navigator');
  Reflect.deleteProperty(globalThis, 'Node');
  globalThis.window = window as typeof globalThis.window;
  globalThis.document = window.document;
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  globalThis.Node = window.Node;
  globalThis.Element = window.Element;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.SVGElement = window.SVGElement;
  globalThis.DOMRect = window.DOMRect;
  Object.defineProperty(window, 'crypto', { value: globalThis.crypto, configurable: true });
}

function withVersion(workspace = defaultMagicGridWorkspace): MagicGridWorkspaceWithVersion {
  return {
    ...workspace,
    manifest: { ...workspace.manifest, version: 1 } as MagicGridManifestWithVersion,
  };
}

function jsonResponse(payload: unknown, status = 200): MockResponse {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createMagicGridFetchMock(initialWorkspace: MagicGridWorkspaceWithVersion) {
  let currentWorkspace = initialWorkspace;

  const fetchCalls: FetchCall[] = [];
  const fn = mock.fn(async (input: RequestInfo | URL, init: RequestInit | undefined = {}) => {
    fetchCalls.push([input, init]);
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init.method ?? 'GET').toUpperCase();

    if (url.endsWith('/api/magicgrid/workspaces') && method === 'GET') {
      return jsonResponse([currentWorkspace.manifest]);
    }

    if (url.includes('/api/magicgrid/workspaces/') && url.endsWith('/open') && method === 'POST') {
      return jsonResponse({ current: currentWorkspace.manifest });
    }

    if (url.endsWith('/api/magicgrid/workspaces/current/load') && method === 'GET') {
      return jsonResponse(currentWorkspace);
    }

    if (url.endsWith('/api/magicgrid/workspaces/current/save') && method === 'POST') {
      const payload = init.body ? (JSON.parse(init.body.toString()) as { workspace: MagicGridWorkspaceWithVersion }) : null;
      const nextVersion = (currentWorkspace.manifest.version ?? 1) + 1;
      currentWorkspace = payload?.workspace
        ? {
            ...payload.workspace,
            manifest: {
              ...payload.workspace.manifest,
              version: nextVersion,
              updatedAt: new Date().toISOString(),
            },
          }
        : currentWorkspace;
      return jsonResponse({ status: 'saved', manifest: currentWorkspace.manifest });
    }

    return jsonResponse({}, 200);
  });

  return { fetchMock: fn as unknown as typeof fetch, calls: fetchCalls };
}

describe('MagicGridApp', () => {
  const workspace = withVersion({
    ...defaultMagicGridWorkspace,
    layout: { ...defaultLayoutMetadata, rows: 6, columns: 6 },
    elements: defaultGridElements.slice(0, 2),
    constraints: defaultConstraints.slice(0, 2),
  });

  beforeEach(() => {
    createDom();
  });

  afterEach(() => {
    mock.restoreAll();
    cleanup();
    global.fetch = originalFetch;
    domInstance?.window.close();
    domInstance = null;
  });

  it('adds an element from the palette and focuses its properties', async () => {
    createDom();
    assert.ok(globalThis.document?.body);
    const { fetchMock } = createMagicGridFetchMock(workspace);
    global.fetch = fetchMock;

    const { findByLabelText, findAllByRole, container } = render(<MagicGridApp />);

    const workspaceSelect = await findByLabelText(/Workspace/i, { selector: 'select' });
    await waitFor(() => assert.equal((workspaceSelect as HTMLSelectElement).value, workspace.manifest.id));

    const user = await createUser();
    const addButtons = await findAllByRole('button', { name: /Add to grid/i });
    const initialTileCount = container.querySelectorAll('[data-testid^="tile-"]').length;
    await user.click(addButtons[0]);

    await waitFor(() => {
      const tiles = container.querySelectorAll('[data-testid^="tile-"]').length;
      assert.equal(tiles, initialTileCount + 1);
    });
    await waitFor(() => assert.match(container.textContent ?? '', /Added Header/));
  });

  it('triggers autosave after changes when autosave is enabled', async () => {
    createDom();
    assert.ok(globalThis.document?.body);

    const { fetchMock, calls } = createMagicGridFetchMock(workspace);
    global.fetch = fetchMock;

    const { findByLabelText, findAllByRole, container } = render(<MagicGridApp />);

    const workspaceSelect = await findByLabelText(/Workspace/i, { selector: 'select' });
    await waitFor(() => assert.equal((workspaceSelect as HTMLSelectElement).value, workspace.manifest.id));

    const user = await createUser();

    const addButtons = await findAllByRole('button', { name: /Add to grid/i });
    const initialTileCount = container.querySelectorAll('[data-testid^="tile-"]').length;
    await user.click(addButtons[1]);

    await new Promise((resolve) => setTimeout(resolve, 1600));

    await waitFor(() => {
      assert.ok(calls.some(([url]) => url.toString().includes('/api/magicgrid/workspaces/current/save')));
      const tiles = container.querySelectorAll('[data-testid^="tile-"]').length;
      assert.equal(tiles, initialTileCount + 1);
    });
  });

  it('supports undoing and redoing palette changes', async () => {
    createDom();
    assert.ok(globalThis.document?.body);
    const { fetchMock } = createMagicGridFetchMock(workspace);
    global.fetch = fetchMock;

    const { findByLabelText, findAllByRole, getByText, container } = render(<MagicGridApp />);

    const workspaceSelect = await findByLabelText(/Workspace/i, { selector: 'select' });
    await waitFor(() => assert.equal((workspaceSelect as HTMLSelectElement).value, workspace.manifest.id));

    const user = await createUser();
    const addButtons = await findAllByRole('button', { name: /Add to grid/i });
    const initialTileCount = container.querySelectorAll('[data-testid^="tile-"]').length;
    await user.click(addButtons[0]);
    await waitFor(() => {
      const tiles = container.querySelectorAll('[data-testid^="tile-"]').length;
      assert.equal(tiles, initialTileCount + 1);
    });

    const undoButton = getByText('Undo');
    await user.click(undoButton);
    await waitFor(() => {
      const tiles = container.querySelectorAll('[data-testid^="tile-"]').length;
      assert.equal(tiles, initialTileCount);
    });

    const redoButton = getByText('Redo');
    await user.click(redoButton);

    await waitFor(() => {
      const tiles = container.querySelectorAll('[data-testid^="tile-"]').length;
      assert.equal(tiles, initialTileCount + 1);
    });
  });
});
