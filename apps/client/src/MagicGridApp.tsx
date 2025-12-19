import { useEffect, useMemo, useRef, useState } from 'react';
import {
  defaultConstraints,
  defaultGridElements,
  defaultLayoutMetadata,
  defaultMagicGridWorkspace,
  gridElementSchema,
  layoutMetadataSchema,
  magicGridWorkspaceSchema,
  type GridElement,
  type LayoutMetadata,
  type MagicGridConstraint,
  type MagicGridManifest,
  type MagicGridWorkspace,
} from '@cameotest/magicgrid';
import { Panel } from './components/Panel';
import { ToastItem, ToastStack } from './components/Toast';
import { MagicGridCanvas } from './components/magicgrid/MagicGridCanvas';
import { MagicGridPalette } from './components/magicgrid/MagicGridPalette';
import { MagicGridProperties } from './components/magicgrid/MagicGridProperties';
import { MagicGridToolbar } from './components/magicgrid/MagicGridToolbar';
import type { DragState, GridDraft } from './components/magicgrid/interaction';
import { normalizeDraft } from './components/magicgrid/interaction';

export type MagicGridManifestWithVersion = MagicGridManifest & { version: number };
export type MagicGridWorkspaceWithVersion = MagicGridWorkspace & {
  manifest: MagicGridManifestWithVersion;
};

type HistoryEntry = { workspace: MagicGridWorkspaceWithVersion; selection?: string | null };

type LoadState = 'idle' | 'loading' | 'saving';

const HISTORY_LIMIT = 30;
const AUTOSAVE_DELAY = 1500;

class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

async function requestJson<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!response.ok) {
    const message =
      (typeof parsed === 'string' ? parsed : (parsed as { message?: string })?.message) ??
      `Request failed with status ${response.status}`;
    throw new HttpError(message, response.status, parsed);
  }
  if (!text) {
    return {} as T;
  }
  return (parsed as T) ?? ({} as T);
}

async function getJson<T>(url: string): Promise<T> {
  return requestJson<T>(url);
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  return requestJson<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function deleteJson<T>(url: string): Promise<T> {
  return requestJson<T>(url, { method: 'DELETE' });
}

export function MagicGridApp() {
  const [workspaces, setWorkspaces] = useState<MagicGridManifestWithVersion[]>([]);
  const [activeId, setActiveId] = useState<string>('');
  const [workspace, setWorkspace] = useState<MagicGridWorkspaceWithVersion | null>(null);
  const [selection, setSelection] = useState<string | null>(null);
  const [status, setStatus] = useState('Loading MagicGrid workspaces…');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [redo, setRedo] = useState<HistoryEntry[]>([]);
  const [autosaveEnabled, setAutosaveEnabled] = useState(true);
  const [autosaveError, setAutosaveError] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const autosaveTimer = useRef<number | null>(null);
  const creatingDefaultRef = useRef(false);

  const selectedElement = useMemo(
    () => workspace?.elements.find((element: GridElement) => element.id === selection) ?? null,
    [workspace, selection],
  );

  useEffect(() => {
    fetchWorkspaces({ bootstrapOnEmpty: true });
    return () => {
      if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!dirty || !autosaveEnabled || saving || loadState !== 'idle') return;
    if (autosaveTimer.current) window.clearTimeout(autosaveTimer.current);
    autosaveTimer.current = window.setTimeout(() => {
      void handleSave(true);
    }, AUTOSAVE_DELAY);
  }, [dirty, autosaveEnabled, saving, loadState, workspace]);

  useEffect(() => {
    setDragState(null);
  }, [workspace?.manifest.id]);

  const canUndo = history.length > 1;
  const canRedo = redo.length > 0;

  function getErrorMessage(error: unknown) {
    if (error instanceof HttpError) return error.message;
    if (error instanceof Error) return error.message;
    return String(error);
  }

  function toast(message: string, kind: ToastItem['kind'] = 'info', duration?: number) {
    setToasts((items) => [...items, { id: crypto.randomUUID(), message, kind, duration }]);
  }

  function closeToast(id: string) {
    setToasts((items) => items.filter((toast) => toast.id !== id));
  }

  function isVersionConflict(error: unknown): error is HttpError {
    return error instanceof HttpError && error.status === 409;
  }

  async function fetchWorkspaces(options: { bootstrapOnEmpty?: boolean; activeWorkspaceId?: string } = {}) {
    const { bootstrapOnEmpty = false, activeWorkspaceId = activeId } = options;
    try {
      setStatus('Loading MagicGrid workspaces…');
      const list = await getJson<MagicGridManifestWithVersion[]>('/api/magicgrid/workspaces');
      setWorkspaces(list);
      if (list.length === 0) {
        setStatus('No MagicGrid workspaces yet.');
        if (bootstrapOnEmpty && !creatingDefaultRef.current) {
          await createDefaultWorkspace();
        }
        return;
      }
      setStatus('Select a MagicGrid workspace to begin.');
      if (list.length && !activeWorkspaceId) {
        await openWorkspace(list[0].id);
      }
    } catch (error) {
      setStatus(getErrorMessage(error));
    }
  }

  async function openWorkspace(id: string) {
    try {
      setLoadState('loading');
      setStatus('Opening MagicGrid workspace…');
      await postJson(`/api/magicgrid/workspaces/${id}/open`);
      const loaded = await getJson<MagicGridWorkspaceWithVersion>('/api/magicgrid/workspaces/current/load');
      const validated = {
        ...magicGridWorkspaceSchema.parse(loaded),
        manifest: { ...(loaded.manifest as MagicGridManifestWithVersion) },
      } satisfies MagicGridWorkspaceWithVersion;
      setWorkspace(validated);
      setActiveId(validated.manifest.id);
      setHistory([{ workspace: validated }]);
      setRedo([]);
      setSelection(null);
      setDirty(false);
      setAutosaveError(null);
      setStatus(`Opened ${validated.manifest.name}`);
    } catch (error) {
      const message = getErrorMessage(error);
      setStatus(message);
      toast(`Failed to open MagicGrid workspace: ${message}`, 'error', 4000);
    } finally {
      setLoadState('idle');
    }
  }

  async function handleCreateWorkspace() {
    const id = crypto.randomUUID();
    const name = `MagicGrid ${new Date().toLocaleTimeString()}`;
    const manifest: MagicGridManifestWithVersion = {
      ...defaultMagicGridWorkspace.manifest,
      id,
      name,
      updatedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      version: 1,
    };
    try {
      setStatus('Creating MagicGrid workspace…');
      await postJson('/api/magicgrid/workspaces', {
        id: manifest.id,
        name: manifest.name,
        description: manifest.description,
      });
      await fetchWorkspaces({ bootstrapOnEmpty: true, activeWorkspaceId: manifest.id });
      await openWorkspace(manifest.id);
      toast(`Created MagicGrid workspace ${manifest.name}`);
    } catch (error) {
      const message = getErrorMessage(error);
      setStatus(message);
      toast(`Failed to create MagicGrid workspace: ${message}`, 'error', 4000);
    }
  }

  async function createDefaultWorkspace() {
    if (creatingDefaultRef.current) return;
    const now = new Date().toISOString();
    const manifest: MagicGridManifestWithVersion = {
      ...defaultMagicGridWorkspace.manifest,
      id: `${defaultMagicGridWorkspace.manifest.id}-${crypto.randomUUID()}`,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    try {
      creatingDefaultRef.current = true;
      setStatus('Creating default MagicGrid workspace…');
      await postJson('/api/magicgrid/workspaces', {
        id: manifest.id,
        name: manifest.name,
        description: manifest.description,
      });
      await fetchWorkspaces({ bootstrapOnEmpty: false, activeWorkspaceId: manifest.id });
      await openWorkspace(manifest.id);
      toast(`Created MagicGrid workspace ${manifest.name}`);
    } catch (error) {
      const message = getErrorMessage(error);
      setStatus(message);
      toast(`Failed to create default MagicGrid workspace: ${message}`, 'error', 4000);
    } finally {
      creatingDefaultRef.current = false;
    }
  }

  async function handleDuplicateWorkspace() {
    if (!workspace) return;
    const { manifest } = workspace;
    const duplicateId = `${manifest.id}-copy-${crypto.randomUUID()}`;
    const duplicateName = `${manifest.name} Copy`;
    try {
      setLoadState('loading');
      setStatus('Duplicating MagicGrid workspace…');
      const response = await postJson<{ status: string; manifest: MagicGridManifestWithVersion }>(
        `/api/magicgrid/workspaces/${manifest.id}/duplicate`,
        { id: duplicateId, name: duplicateName, version: manifest.version },
      );
      const duplicatedManifest = response?.manifest ?? {
        ...manifest,
        id: duplicateId,
        name: duplicateName,
      };
      await fetchWorkspaces({ bootstrapOnEmpty: false, activeWorkspaceId: duplicatedManifest.id });
      await openWorkspace(duplicatedManifest.id);
      toast(`Duplicated MagicGrid workspace as ${duplicatedManifest.name}`);
    } catch (error) {
      const message = getErrorMessage(error);
      setStatus(message);
      if (isVersionConflict(error)) {
        toast('MagicGrid workspace has been updated elsewhere. Refresh to duplicate the latest version.', 'error', 4200);
      } else {
        toast(`Failed to duplicate MagicGrid workspace: ${message}`, 'error', 4000);
      }
    } finally {
      setLoadState('idle');
    }
  }

  async function handleDeleteWorkspace() {
    if (!workspace) return;
    if (!window.confirm(`Delete MagicGrid workspace "${workspace.manifest.name}"? This cannot be undone.`)) {
      return;
    }
    const { id, name } = workspace.manifest;
    try {
      setLoadState('loading');
      setStatus('Deleting MagicGrid workspace…');
      await deleteJson(`/api/magicgrid/workspaces/${id}`);
      toast(`Deleted MagicGrid workspace ${name}`);
      setWorkspace(null);
      setActiveId('');
      setSelection(null);
      setHistory([]);
      setRedo([]);
      setDirty(false);
      setAutosaveError(null);
      await fetchWorkspaces({ bootstrapOnEmpty: true, activeWorkspaceId: '' });
    } catch (error) {
      const message = getErrorMessage(error);
      setStatus(message);
      toast(`Failed to delete MagicGrid workspace: ${message}`, 'error', 4000);
    } finally {
      setLoadState('idle');
    }
  }

  function pushHistory(nextWorkspace: MagicGridWorkspaceWithVersion, nextSelection?: string | null) {
    setHistory((entries) => {
      const updated = [...entries, { workspace: nextWorkspace, selection: nextSelection }];
      return updated.slice(-HISTORY_LIMIT);
    });
    setRedo([]);
  }

  function updateWorkspace(
    updater: (current: MagicGridWorkspaceWithVersion) => MagicGridWorkspaceWithVersion,
    nextSelection = selection,
  ) {
    setWorkspace((current: MagicGridWorkspaceWithVersion | null) => {
      if (!current) return current;
      const next = updater(current);
      pushHistory(next, nextSelection);
      setDirty(true);
      setAutosaveError(null);
      return next;
    });
  }

  function handleSelectElement(id: string | null) {
    setSelection(id);
  }

  function handleAddElement(template: GridElement) {
    const now = new Date().toISOString();
    const candidate = gridElementSchema.parse({
      ...template,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    });
    updateWorkspace((current) => ({
      ...current,
      elements: [...current.elements, candidate],
    }), candidate.id);
    toast(`Added ${candidate.title}`);
  }

  function handleUpdateElement(id: string, updates: Partial<GridElement>) {
    updateWorkspace((current) => ({
      ...current,
      elements: current.elements.map((element: GridElement) =>
        element.id === id
          ? gridElementSchema.parse({ ...element, ...updates, updatedAt: new Date().toISOString() })
          : element,
      ),
    }));
  }

  function handleCommitPosition(id: string, draft: GridDraft) {
    if (!workspace) return;
    const normalized = normalizeDraft(draft, workspace.layout);
    handleUpdateElement(id, normalized);
    setSelection(id);
    setDragState(null);
  }

  function handleDeleteElement(id: string) {
    updateWorkspace(
      (current) => ({
        ...current,
        elements: current.elements.filter((element: GridElement) => element.id !== id),
        constraints: current.constraints.map((constraint: MagicGridConstraint) => ({
          ...constraint,
          appliesTo: constraint.appliesTo.filter((target: string) => target !== id),
        })) as MagicGridConstraint[],
      }),
      null,
    );
    setSelection((current) => (current === id ? null : current));
  }

  function handleUpdateLayout(updates: Partial<LayoutMetadata>) {
    updateWorkspace((current) => ({
      ...current,
      layout: layoutMetadataSchema.parse({ ...current.layout, ...updates, updatedAt: new Date().toISOString() }),
    }));
  }

  async function handleSave(isAutosave = false) {
    if (!workspace) return;
    try {
      setSaving(!isAutosave);
      setStatus(isAutosave ? 'Autosaving…' : 'Saving MagicGrid workspace…');
      const payload = { workspace } satisfies { workspace: MagicGridWorkspaceWithVersion };
      const response = await postJson<{ status: string; manifest: MagicGridManifestWithVersion }>(
        '/api/magicgrid/workspaces/current/save',
        payload,
      );
      setWorkspace((current: MagicGridWorkspaceWithVersion | null) =>
        current
          ? {
              ...current,
              manifest: response.manifest,
            }
          : current,
      );
      setDirty(false);
      setAutosaveError(null);
      setStatus(response.status === 'saved' ? 'Saved' : 'Ready');
    } catch (error) {
      const message = getErrorMessage(error);
      setAutosaveError(message);
      setStatus(message);
      if (isVersionConflict(error)) {
        toast('MagicGrid workspace has been updated elsewhere. Please reload to continue.', 'error', 4200);
      } else if (!isAutosave) {
        toast(`Save failed: ${message}`, 'error', 4000);
      }
    } finally {
      setSaving(false);
    }
  }

  function handleUndo() {
    setHistory((entries) => {
      if (entries.length < 2) return entries;
      const updatedHistory = entries.slice(0, -1);
      const last = entries[entries.length - 1];
      setRedo((redoStack) => [...redoStack, last]);
      const previous = updatedHistory[updatedHistory.length - 1];
      setWorkspace(previous.workspace);
      setSelection(previous.selection ?? null);
      setDirty(true);
      return updatedHistory;
    });
  }

  function handleRedo() {
    setRedo((redoStack) => {
      if (!redoStack.length) return redoStack;
      const next = redoStack[redoStack.length - 1];
      const remaining = redoStack.slice(0, -1);
      setHistory((entries) => [...entries, next].slice(-HISTORY_LIMIT));
      setWorkspace(next.workspace);
      setSelection(next.selection ?? null);
      setDirty(true);
      return remaining;
    });
  }

  function handleResetToDefaults() {
    const reset: MagicGridWorkspaceWithVersion = {
      manifest: {
        ...(workspace?.manifest ?? defaultMagicGridWorkspace.manifest),
        updatedAt: new Date().toISOString(),
        version: workspace?.manifest.version ?? 1,
      },
      layout: defaultLayoutMetadata,
      elements: defaultGridElements,
      constraints: defaultConstraints,
    };
    setWorkspace(reset);
    setHistory([{ workspace: reset }]);
    setRedo([]);
    setDirty(true);
    toast('Reset workspace to defaults');
  }

  const autosaveStatus = autosaveError
    ? 'Autosave failed'
    : dirty
      ? 'Unsaved changes'
      : 'Saved';

  return (
    <div className="magicgrid">
      <MagicGridToolbar
        autosaveEnabled={autosaveEnabled}
        autosaveError={autosaveError}
        autosaveStatus={autosaveStatus}
        canRedo={canRedo}
        canUndo={canUndo}
        dirty={dirty}
        saving={saving}
        status={status}
        workspaces={workspaces}
        activeId={activeId}
        onOpen={openWorkspace}
        onCreate={handleCreateWorkspace}
        onDuplicate={handleDuplicateWorkspace}
        onDelete={handleDeleteWorkspace}
        onSave={() => handleSave(false)}
        onToggleAutosave={() => setAutosaveEnabled((value) => !value)}
        onUndo={handleUndo}
        onRedo={handleRedo}
      />
      <div className="magicgrid__layout">
        <div className="magicgrid__column magicgrid__column--sidebar">
          <Panel
            title="Workspace"
            subtitle="Open a saved MagicGrid workspace"
            actions={
              <button
                className="button button--ghost"
                onClick={() => fetchWorkspaces({ bootstrapOnEmpty: true })}
                type="button"
              >
                Refresh list
              </button>
            }
          >
            <div className="magicgrid__workspace-list">
              {workspaces.map((manifest) => (
                <button
                  key={manifest.id}
                  type="button"
                  className={`magicgrid__workspace${manifest.id === activeId ? ' magicgrid__workspace--active' : ''}`}
                  onClick={() => openWorkspace(manifest.id)}
                >
                  <strong>{manifest.name}</strong>
                  <span>{new Date(manifest.updatedAt).toLocaleString()}</span>
                </button>
              ))}
              {workspaces.length === 0 ? <p className="magicgrid__empty">No MagicGrid workspaces</p> : null}
            </div>
          </Panel>
          <Panel
            title="Palette"
            subtitle="Seed templates for common layout regions"
            actions={
              <button className="button button--ghost" type="button" onClick={handleResetToDefaults}>
                Reset to defaults
              </button>
            }
          >
            <MagicGridPalette templates={defaultGridElements} onAdd={handleAddElement} />
          </Panel>
        </div>
        <div className="magicgrid__column magicgrid__column--canvas">
          <MagicGridCanvas
            layout={workspace?.layout ?? defaultLayoutMetadata}
            elements={workspace?.elements ?? defaultGridElements}
            constraints={workspace?.constraints ?? defaultConstraints}
            selectedId={selection}
            dragState={dragState}
            onSelect={handleSelectElement}
            onDragStateChange={setDragState}
            onCommitPosition={handleCommitPosition}
          />
        </div>
        <div className="magicgrid__column magicgrid__column--properties">
          <MagicGridProperties
            element={selectedElement}
            onChange={handleUpdateElement}
            onDelete={handleDeleteElement}
            layout={workspace?.layout ?? defaultLayoutMetadata}
            onLayoutChange={handleUpdateLayout}
          />
          <Panel title="Constraints" subtitle="Applied to the selected layout">
            <div className="magicgrid__constraints">
              {(workspace?.constraints ?? defaultConstraints).map((constraint: MagicGridConstraint) => (
                <div key={constraint.id} className="magicgrid__constraint">
                  <div className="magicgrid__constraint-title">{constraint.label || constraint.kind}</div>
                  <div className="magicgrid__constraint-meta">
                    <span>Kind: {constraint.kind}</span>
                    {(constraint.kind === 'alignment' || constraint.kind === 'spacing') && (
                      <span>Axis: {constraint.axis}</span>
                    )}
                    {constraint.kind === 'spacing' ? <span>Gap: {constraint.gap}</span> : null}
                    {constraint.kind === 'alignment' ? <span>Track: {constraint.track}</span> : null}
                    {constraint.kind === 'lock' ? <span>Anchor: {constraint.anchor}</span> : null}
                    <span>Applies to: {constraint.appliesTo.length}</span>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
      <ToastStack toasts={toasts} onDismiss={closeToast} />
    </div>
  );
}
