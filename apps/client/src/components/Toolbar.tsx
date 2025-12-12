import { WorkspaceManifest } from '@cameotest/shared';

interface ToolbarProps {
  workspaces: WorkspaceManifest[];
  activeId?: string;
  status: string;
  onChange: (id: string) => void;
  onSave?: () => void;
  saving?: boolean;
}

export function Toolbar({ workspaces, activeId, status, onChange, onSave, saving }: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="toolbar__title">
        <span className="pill">Workspace Shell</span>
        <div>
          <h1>SysML v2 BDD</h1>
          <p className="toolbar__status">{status}</p>
        </div>
      </div>
      <div className="toolbar__actions">
        <label className="toolbar__label" htmlFor="workspace-select">
          Workspace
        </label>
        <select id="workspace-select" value={activeId ?? ''} onChange={(event) => onChange(event.target.value)}>
          {workspaces.length === 0 ? <option value="">Loading...</option> : null}
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        </select>
        <button className="button" onClick={onSave} disabled={!onSave || saving} type="button">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </header>
  );
}
