import { useEffect, useRef, useState } from 'react';
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (menuRef.current && event.target instanceof Node && menuRef.current.contains(event.target)) return;
      setMenuOpen(false);
    };
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [menuOpen]);

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
        <div className="toolbar__group">
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
        </div>
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
        <div className="toolbar__menu" ref={menuRef}>
          <button
            className="button button--ghost toolbar__menu-trigger"
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
          >
            ⋯
          </button>
          {menuOpen ? (
            <div className="toolbar__menu-items">
              <div className="toolbar__menu-label">Workspace</div>
              <button className="toolbar__menu-item" type="button" onClick={onCreateWorkspace}>
                New workspace
              </button>
              <button className="toolbar__menu-item" type="button" onClick={onImportWorkspace}>
                Open / Import
              </button>
              <button className="toolbar__menu-item" type="button" onClick={onImportSysml}>
                Import SysML v2
              </button>
              <button
                className="toolbar__menu-item"
                type="button"
                onClick={onExportWorkspace}
                disabled={!onExportWorkspace}
              >
                Export
              </button>
              <button className="toolbar__menu-item" type="button" onClick={onExportSysml} disabled={!onExportSysml}>
                Export SysML v2
              </button>
              <div className="toolbar__menu-label">Edit</div>
              <button className="toolbar__menu-item" type="button" onClick={onUndo} disabled={!onUndo || !canUndo}>
                Undo
              </button>
              <button className="toolbar__menu-item" type="button" onClick={onRedo} disabled={!onRedo || !canRedo}>
                Redo
              </button>
              {canConnect ? (
                <button
                  className={`toolbar__menu-item${connectMode ? ' toolbar__menu-item--active' : ''}`}
                  type="button"
                  onClick={onToggleConnectMode}
                  disabled={!onToggleConnectMode}
                >
                  {connectMode ? 'Connecting…' : 'Connect mode'}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
