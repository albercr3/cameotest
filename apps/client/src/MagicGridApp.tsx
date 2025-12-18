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

export type MagicGridManifestWithVersion = MagicGridManifest & { version: number };
export type MagicGridWorkspaceWithVersion = MagicGridWorkspace & {
  manifest: MagicGridManifestWithVersion;
};

type HistoryEntry = { workspace: MagicGridWorkspaceWithVersion; selection?: string | null };

type LoadState = 'idle' | 'loading' | 'saving';

const HISTORY_LIMIT = 30;
const AUTOSAVE_DELAY = 1500;

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const text = await response.text();
    const message = text || `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return (await response.json()) as T;
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    const message = text || `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return text ? ((JSON.parse(text) as T) ?? ({} as T)) : ({} as T);
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
  const autosaveTimer = useRef<number | null>(null);

  const selectedElement = useMemo(
    () => workspace?.elements.find((element: GridElement) => element.id === selection) ?? null,
    [workspace, selection],
  );

  useEffect(() => {
    fetchWorkspaces();
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

  const canUndo = history.length > 1;
  const canRedo = redo.length > 0;

  async function fetchWorkspaces() {
    try {
      setStatus('Loading MagicGrid workspaces…');
      const list = await getJson<MagicGridManifestWithVersion[]>('/api/magicgrid/workspaces');
      setWorkspaces(list);
      setStatus(list.length ? 'Select a MagicGrid workspace to begin.' : 'No MagicGrid workspaces yet.');
      if (list.length && !activeId) {
        await openWorkspace(list[0].id);
      }
    } catch (error) {
      setStatus(String(error));
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
      setStatus(String(error));
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
      await fetchWorkspaces();
      await openWorkspace(manifest.id);
      toast(`Created MagicGrid workspace ${manifest.name}`);
    } catch (error) {
      setStatus(String(error));
    }
  }

  function toast(message: string) {
    setToasts((items) => [...items, { id: crypto.randomUUID(), message }]);
  }

  function closeToast(id: string) {
    setToasts((items) => items.filter((toast) => toast.id !== id));
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
      const message = String(error);
      setAutosaveError(message);
      setStatus(message);
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
              <button className="button button--ghost" onClick={fetchWorkspaces} type="button">
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
            onSelect={handleSelectElement}
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
