import { useMemo, useState } from 'react';
import App from './App';
import { MagicGridApp } from './MagicGridApp';

const MAGICGRID_ENABLED = (import.meta.env.VITE_ENABLE_MAGICGRID ?? 'false') !== 'false';

type Shell = 'sysml' | 'magicgrid';

export function WorkspaceShell() {
  const [shell, setShell] = useState<Shell>('sysml');
  const availableShells = useMemo<Shell[]>(
    () => (MAGICGRID_ENABLED ? ['sysml', 'magicgrid'] : ['sysml']),
    [],
  );

  const activeShell = availableShells.includes(shell) ? shell : 'sysml';

  return (
    <div className="workspace-shell">
      {MAGICGRID_ENABLED ? (
        <div className="workspace-shell__nav">
          <button
            className={`workspace-shell__tab${activeShell === 'sysml' ? ' workspace-shell__tab--active' : ''}`}
            type="button"
            onClick={() => setShell('sysml')}
          >
            SysML workspace
          </button>
          <button
            className={`workspace-shell__tab${activeShell === 'magicgrid' ? ' workspace-shell__tab--active' : ''}`}
            type="button"
            onClick={() => setShell('magicgrid')}
          >
            MagicGrid workspace
          </button>
        </div>
      ) : null}
      {activeShell === 'magicgrid' ? <MagicGridApp /> : <App />}
    </div>
  );
}

export default WorkspaceShell;
