import { WorkspaceManifest } from '@cameotest/shared';

interface ToolbarProps {
  workspaces: WorkspaceManifest[];
  activeId?: string;
  status: string;
  onChange: (id: string) => void;
  onSave?: () => void;
  saving?: boolean;
  onCreateWorkspace?: () => void;
  onImportWorkspace?: () => void;
  onImportSysml?: () => void;
  onExportWorkspace?: () => void;
  onExportSysml?: () => void;
  autosaveEnabled: boolean;
  autosaveStatus: string;
  onToggleAutosave?: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  connectMode: boolean;
  canConnect: boolean;
  onToggleConnectMode?: () => void;
}

export function Toolbar({
  workspaces,
  activeId,
  status,
  onChange,
  onSave,
  saving,
  onCreateWorkspace,
  onImportWorkspace,
  onImportSysml,
  onExportWorkspace,
  onExportSysml,
  autosaveEnabled,
  autosaveStatus,
  onToggleAutosave,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  connectMode,
  canConnect,
  onToggleConnectMode,
}: ToolbarProps) {
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
        <button className="button button--ghost" onClick={onUndo} disabled={!onUndo || !canUndo} type="button">
          Undo
        </button>
        <button className="button button--ghost" onClick={onRedo} disabled={!onRedo || !canRedo} type="button">
          Redo
        </button>
        <button
          className={`button button--ghost${connectMode ? ' button--active' : ''}`}
          onClick={onToggleConnectMode}
          disabled={!onToggleConnectMode || !canConnect}
          type="button"
        >
          {connectMode ? 'Connecting…' : 'Connect ports'}
        </button>
        <label className="toolbar__label" htmlFor="workspace-select">
          Workspace
        </label>
        <select id="workspace-select" value={activeId ?? ''} onChange={(event) => onChange(event.target.value)}>
          <option value="">Choose…</option>
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        </select>
        <button className="button button--ghost" onClick={onCreateWorkspace} type="button">
          New workspace
        </button>
        <button className="button button--ghost" onClick={onImportWorkspace} type="button">
          Open / Import
        </button>
        <button className="button button--ghost" onClick={onImportSysml} type="button">
          Import SysML v2
        </button>
        <button className="button button--ghost" onClick={onExportWorkspace} disabled={!onExportWorkspace} type="button">
          Export
        </button>
        <button className="button button--ghost" onClick={onExportSysml} disabled={!onExportSysml} type="button">
          Export SysML v2
        </button>
        <button className="button" onClick={onSave} disabled={!onSave || saving} type="button">
          {saving ? 'Saving…' : 'Save'}
        </button>
        <label className="toolbar__toggle">
          <input
            type="checkbox"
            checked={autosaveEnabled}
            onChange={onToggleAutosave}
            disabled={!onToggleAutosave}
          />
          <span>Autosave</span>
        </label>
        <span className="toolbar__status toolbar__status--inline">{autosaveStatus}</span>
      </div>
    </header>
  );
}
