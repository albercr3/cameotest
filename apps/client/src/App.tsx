import { useEffect, useMemo, useState } from 'react';
import type { DiagramsFile, ModelFile, WorkspaceManifest } from '@cameotest/shared';
import { IR_VERSION } from '@cameotest/shared';
import { Panel } from './components/Panel';
import { Toolbar } from './components/Toolbar';

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

export default function App() {
  const [workspaces, setWorkspaces] = useState<WorkspaceManifest[]>([]);
  const [activeId, setActiveId] = useState<string | undefined>();
  const [payload, setPayload] = useState<WorkspacePayload | null>(null);
  const [status, setStatus] = useState('Fetching workspace list...');

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
        setStatus('Ready');
      })
      .catch((error) => {
        console.error(error);
        setStatus('Workspace not available');
      });
  }, [activeId]);

  const elementSummaries = useMemo(() => {
    if (!payload) return [] as Array<{ id: string; name: string; metaclass: string; ownerName: string | null }>;
    const byId = new Map(payload.model.elements.map((el) => [el.id, el]));
    return payload.model.elements.map((el) => ({
      id: el.id,
      name: el.name,
      metaclass: el.metaclass,
      ownerName: el.ownerId ? byId.get(el.ownerId)?.name ?? 'Unknown' : null,
    }));
  }, [payload]);

  const relationshipCount = payload?.model.relationships.length ?? 0;
  const diagramCount = payload?.diagrams.diagrams.length ?? 0;

  return (
    <div className="app">
      <Toolbar workspaces={workspaces} activeId={activeId} onChange={setActiveId} status={status} />
      <main className="layout">
        <Panel
          title={payload?.manifest.name ?? 'Workspace overview'}
          subtitle={payload?.manifest.description ?? 'Choose a workspace to begin'}
        >
          <p className="lede">
            {payload
              ? `${payload.model.elements.length} elements, ${relationshipCount} relationships, ${diagramCount} diagrams.`
              : 'Select a workspace to explore its contents.'}
          </p>
          <div className="grid">
            <div>
              <h3>Elements</h3>
              <ul className="list">
                {elementSummaries.map((element) => (
                  <li key={element.id}>
                    <div className="list__title">{element.name}</div>
                    <div className="list__meta">{element.metaclass}</div>
                    {element.ownerName ? <p className="list__notes">Owned by {element.ownerName}</p> : null}
                  </li>
                ))}
                {elementSummaries.length === 0 ? <li>No elements yet</li> : null}
              </ul>
            </div>
            <div>
              <h3>Diagrams</h3>
              <ul className="list">
                {payload?.diagrams.diagrams.map((diagram) => (
                  <li key={diagram.id}>
                    <div className="list__title">{diagram.name}</div>
                    <div className="list__meta">{diagram.type}</div>
                  </li>
                )) ?? <li>No diagrams yet</li>}
              </ul>
              <h3>Relationships</h3>
              <p className="list__meta">{relationshipCount}</p>
            </div>
          </div>
        </Panel>
        <Panel title="Context" subtitle={`IR schema v${IR_VERSION}`}>
          <dl className="description-list">
            <div>
              <dt>Workspace ID</dt>
              <dd>{payload?.manifest.id ?? '—'}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{payload?.manifest.updatedAt ?? 'Unknown'}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{payload?.manifest.createdAt ?? 'Unknown'}</dd>
            </div>
          </dl>
        </Panel>
      </main>
    </div>
  );
}
