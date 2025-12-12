import { useEffect, useMemo, useState } from 'react';
import type { Diagram, DiagramsFile, Element, ModelFile, WorkspaceManifest } from '@cameotest/shared';
import { IR_VERSION, metaclassSchema } from '@cameotest/shared';
import { Panel } from './components/Panel';
import { Toolbar } from './components/Toolbar';
import { ModelBrowser, ModelBrowserNode } from './components/ModelBrowser';
import { PropertiesPanel } from './components/PropertiesPanel';
import { DiagramCanvas } from './components/DiagramCanvas';

interface WorkspacePayload {
  manifest: WorkspaceManifest;
  model: ModelFile;
  diagrams: DiagramsFile;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

const metaclasses = metaclassSchema.options;

export default function App() {
  const [workspaces, setWorkspaces] = useState<WorkspaceManifest[]>([]);
  const [activeId, setActiveId] = useState<string | undefined>();
  const [payload, setPayload] = useState<WorkspacePayload | null>(null);
  const [status, setStatus] = useState('Fetching workspace list...');
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeDiagramId, setActiveDiagramId] = useState<string | undefined>();

  useEffect(() => {
    getJson<WorkspaceManifest[]>('/api/workspaces')
      .then((list) => {
        setWorkspaces(list);
        if (list.length > 0) {
          setActiveId((current) => current ?? list[0].id);
        }
        setStatus('Ready');
      })
      .catch((error) => {
        console.error(error);
        setStatus('Unable to load workspaces');
      });
  }, []);

  useEffect(() => {
    if (!activeId) return;
    setStatus(`Opening workspace “${activeId}”...`);
    postJson(`/api/workspaces/${activeId}/open`)
      .then(() => getJson<WorkspacePayload>('/api/workspaces/current/load'))
      .then((data) => {
        setPayload(data);
        setSelectedId(data.model.elements[0]?.id);
        setActiveDiagramId(data.diagrams.diagrams[0]?.id);
        setStatus('Ready');
      })
      .catch((error) => {
        console.error(error);
        setStatus('Workspace not available');
      });
  }, [activeId]);

  const tree = useMemo<ModelBrowserNode[]>(() => {
    if (!payload) return [];
    const nodes = new Map<string, ModelBrowserNode>();
    payload.model.elements.forEach((element) => {
      nodes.set(element.id, { element, children: [] });
    });
    const roots: ModelBrowserNode[] = [];
    nodes.forEach((node) => {
      if (node.element.ownerId) {
        const parent = nodes.get(node.element.ownerId);
        if (parent) {
          parent.children.push(node);
        } else {
          roots.push(node);
        }
      } else {
        roots.push(node);
      }
    });
    return roots;
  }, [payload]);

  const selectedElement = useMemo(() => {
    if (!payload || !selectedId) return undefined;
    return payload.model.elements.find((el) => el.id === selectedId);
  }, [payload, selectedId]);

  const activeDiagram: Diagram | undefined = useMemo(() => {
    if (!payload || !activeDiagramId) return undefined;
    return payload.diagrams.diagrams.find((diagram) => diagram.id === activeDiagramId);
  }, [activeDiagramId, payload]);

  const elementsById = useMemo(() => {
    if (!payload) return {} as Record<string, Element>;
    return payload.model.elements.reduce<Record<string, Element>>((acc, element) => {
      acc[element.id] = element;
      return acc;
    }, {});
  }, [payload]);

  const summary = useMemo(() => {
    if (!payload) {
      return {
        elements: 0,
        relationships: 0,
        diagrams: 0,
      };
    }
    return {
      elements: payload.model.elements.length,
      relationships: payload.model.relationships.length,
      diagrams: payload.diagrams.diagrams.length,
    };
  }, [payload]);

  const updateElement = (id: string, updates: Partial<Element>) => {
    setPayload((current) => {
      if (!current) return current;
      const elements = current.model.elements.map((element) =>
        element.id === id ? { ...element, ...updates, updatedAt: new Date().toISOString() } : element,
      );
      return {
        ...current,
        manifest: { ...current.manifest, updatedAt: new Date().toISOString() },
        model: { ...current.model, elements },
      };
    });
  };

  const updateDiagram = (diagramId: string, next: Diagram) => {
    setPayload((current) => {
      if (!current) return current;
      const diagrams = current.diagrams.diagrams.map((diagram) => (diagram.id === diagramId ? next : diagram));
      return {
        ...current,
        manifest: { ...current.manifest, updatedAt: new Date().toISOString() },
        diagrams: { diagrams },
      };
    });
  };

  const handleSave = async () => {
    if (!payload) return;
    setSaving(true);
    const next: WorkspacePayload = {
      ...payload,
      manifest: { ...payload.manifest, updatedAt: new Date().toISOString() },
    };
    setPayload(next);
    try {
      await postJson('/api/workspaces/current/save', next);
      setStatus('Saved workspace');
    } catch (error) {
      console.error(error);
      setStatus('Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="app">
      <Toolbar
        workspaces={workspaces}
        activeId={activeId}
        onChange={setActiveId}
        status={status}
        onSave={payload ? handleSave : undefined}
        saving={saving}
      />
      <main className="layout layout--three">
        <Panel title="Model Browser" subtitle="Containment tree with search">
          <ModelBrowser
            tree={tree}
            search={search}
            onSearch={setSearch}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </Panel>
        <Panel title={payload?.manifest.name ?? 'Workspace overview'} subtitle={payload?.manifest.description}>
          <p className="lede">
            {payload
              ? `${summary.elements} elements, ${summary.relationships} relationships, ${summary.diagrams} diagrams.`
              : 'Select a workspace to explore its contents.'}
          </p>
          {activeDiagram ? (
            <div className="diagram-wrapper">
              <div className="diagram-header">
                <label className="label" htmlFor="diagram-select">
                  Diagram
                </label>
                <select
                  id="diagram-select"
                  value={activeDiagramId}
                  onChange={(event) => setActiveDiagramId(event.target.value)}
                >
                  {payload?.diagrams.diagrams.map((diagram) => (
                    <option key={diagram.id} value={diagram.id}>
                      {diagram.name}
                    </option>
                  ))}
                </select>
                <span className="diagram-meta">Type: {activeDiagram.type}</span>
              </div>
              <DiagramCanvas
                diagram={activeDiagram}
                elements={elementsById}
                onChange={(diagram) => updateDiagram(activeDiagram.id, diagram)}
              />
            </div>
          ) : (
            <div className="summary-cards">
              <div className="card">
                <div className="card__label">Workspace ID</div>
                <div className="card__value">{payload?.manifest.id ?? '—'}</div>
              </div>
              <div className="card">
                <div className="card__label">IR version</div>
                <div className="card__value">{IR_VERSION}</div>
              </div>
              <div className="card">
                <div className="card__label">Updated</div>
                <div className="card__value">{payload?.manifest.updatedAt ?? '—'}</div>
              </div>
              <div className="card">
                <div className="card__label">Created</div>
                <div className="card__value">{payload?.manifest.createdAt ?? '—'}</div>
              </div>
            </div>
          )}
        </Panel>
        <Panel title="Properties" subtitle={selectedElement ? selectedElement.name : 'Select an element to edit'}>
          <PropertiesPanel
            element={selectedElement}
            metaclasses={metaclasses}
            onChange={(updates) => selectedId && updateElement(selectedId, updates)}
          />
        </Panel>
      </main>
    </div>
  );
}
