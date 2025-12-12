import { useEffect, useMemo, useState } from 'react';
import { IR_VERSION, Workspace, WorkspaceMetadata } from '@cameotest/shared';
import { Panel } from './components/Panel';
import { Toolbar } from './components/Toolbar';

function fetchJson<T>(url: string): Promise<T> {
  return fetch(url).then((response) => {
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }
    return response.json() as Promise<T>;
  });
}

export default function App() {
  const [workspaces, setWorkspaces] = useState<WorkspaceMetadata[]>([]);
  const [activeId, setActiveId] = useState<string | undefined>();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [status, setStatus] = useState('Fetching workspace list...');

  useEffect(() => {
    fetchJson<WorkspaceMetadata[]>('/api/workspaces')
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
    setStatus(`Loading workspace “${activeId}”...`);
    fetchJson<Workspace>(`/api/workspaces/${activeId}`)
      .then((payload) => {
        setWorkspace(payload);
        setStatus('Ready');
      })
      .catch((error) => {
        console.error(error);
        setStatus('Workspace not available');
      });
  }, [activeId]);

  const summary = useMemo(() => {
    if (!workspace) return 'Select a workspace to explore its details.';
    const nodeCount = workspace.nodes.length;
    const edgeCount = workspace.connections.length;
    const owner = workspace.context?.owner ? `Owned by ${workspace.context.owner}.` : '';
    return `${nodeCount} nodes and ${edgeCount} connections. ${owner}`.trim();
  }, [workspace]);

  return (
    <div className="app">
      <Toolbar workspaces={workspaces} activeId={activeId} onChange={setActiveId} status={status} />
      <main className="layout">
        <Panel
          title={workspace?.name ?? 'Workspace overview'}
          subtitle={workspace?.description ?? 'Choose a workspace to begin'}
        >
          <p className="lede">{summary}</p>
          <div className="grid">
            <div>
              <h3>Nodes</h3>
              <ul className="list">
                {workspace?.nodes.map((node) => (
                  <li key={node.id}>
                    <div className="list__title">{node.label}</div>
                    <div className="list__meta">{node.type ?? 'unspecified type'}</div>
                    {node.notes ? <p className="list__notes">{node.notes}</p> : null}
                  </li>
                )) ?? <li>No nodes yet</li>}
              </ul>
            </div>
            <div>
              <h3>Connections</h3>
              <ul className="list">
                {workspace?.connections.map((edge, index) => (
                  <li key={`${edge.from}-${edge.to}-${index}`}>
                    <div className="list__title">
                      {edge.from} → {edge.to}
                    </div>
                    {edge.label ? <div className="list__meta">{edge.label}</div> : null}
                  </li>
                )) ?? <li>No connections yet</li>}
              </ul>
            </div>
          </div>
        </Panel>
        <Panel title="Context" subtitle={`IR version ${IR_VERSION}`}>
          <dl className="description-list">
            <div>
              <dt>Owner</dt>
              <dd>{workspace?.context?.owner ?? 'Unassigned'}</dd>
            </div>
            <div>
              <dt>Updated</dt>
              <dd>{workspace?.context?.updatedAt ?? 'Unknown'}</dd>
            </div>
            <div>
              <dt>Summary</dt>
              <dd>{workspace?.context?.summary ?? 'No context yet.'}</dd>
            </div>
          </dl>
        </Panel>
      </main>
    </div>
  );
}
