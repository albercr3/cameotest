import type { MagicGridManifest } from '@cameotest/magicgrid';

interface MagicGridToolbarProps {
  workspaces: MagicGridManifest[];
  activeId?: string;
  status: string;
  autosaveStatus: string;
  autosaveError: string | null;
  autosaveEnabled: boolean;
  saving: boolean;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onSave: () => void;
  onToggleAutosave: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

export function MagicGridToolbar({
  workspaces,
  activeId,
  status,
  autosaveStatus,
  autosaveError,
  autosaveEnabled,
  saving,
  dirty,
  canUndo,
  canRedo,
  onOpen,
  onCreate,
  onSave,
  onToggleAutosave,
  onUndo,
  onRedo,
}: MagicGridToolbarProps) {
  return (
    <header className="magicgrid-toolbar">
      <div className="magicgrid-toolbar__title">
        <div className="magicgrid-toolbar__identity">
          <span className="toolbar__badge">CAMEO Next</span>
          <span className="toolbar__identity-sub">MagicGrid</span>
        </div>
        <div>
          <h1>MagicGrid editor</h1>
          <p className="toolbar__status">{status}</p>
        </div>
      </div>
      <div className="magicgrid-toolbar__actions">
        <label className="toolbar__label" htmlFor="magicgrid-workspace">
          Workspace
        </label>
        <select
          id="magicgrid-workspace"
          value={activeId ?? ''}
          onChange={(event) => onOpen(event.target.value)}
        >
          <option value="">Choose…</option>
          {workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        </select>
        <button className="button" type="button" onClick={onCreate}>
          New workspace
        </button>
        <button className="button" type="button" onClick={onSave} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <label className="toolbar__toggle">
          <input type="checkbox" checked={autosaveEnabled} onChange={onToggleAutosave} />
          <span>Autosave</span>
        </label>
        <span
          className="toolbar__status toolbar__status--inline"
          data-state={autosaveError ? 'error' : saving ? 'saving' : 'ready'}
        >
          {autosaveStatus}
        </span>
        <div className="magicgrid-toolbar__group">
          <button type="button" className="button button--ghost" disabled={!canUndo} onClick={onUndo}>
            Undo
          </button>
          <button type="button" className="button button--ghost" disabled={!canRedo} onClick={onRedo}>
            Redo
          </button>
        </div>
      </div>
    </header>
  );
}
