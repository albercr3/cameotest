import type { Element } from '@cameotest/shared';

interface SysmlDrawerProps {
  open: boolean;
  element?: Element;
  preview: string;
  draft: string;
  error?: string | null;
  onDraftChange: (value: string) => void;
  onApply: () => void;
  onClose: () => void;
}

export function SysmlDrawer({ open, element, preview, draft, error, onDraftChange, onApply, onClose }: SysmlDrawerProps) {
  return (
    <aside className={`code-drawer${open ? ' code-drawer--open' : ''}`} aria-hidden={!open}>
      <div className="code-drawer__header">
        <div>
          <p className="pill pill--muted">SysML v2 code</p>
          <h3>{element ? element.name : 'No selection'}</h3>
          <p className="code-drawer__subtitle">
            {element ? `${element.metaclass} • ${element.id}` : 'Select an element to inspect or edit its code view.'}
          </p>
        </div>
        <button type="button" className="button button--ghost" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="code-drawer__body">
        <div className="code-drawer__section">
          <div className="code-drawer__label">Generated preview</div>
          <pre className="code-drawer__preview">{preview}</pre>
        </div>
        <div className="code-drawer__section">
          <div className="code-drawer__label">Editable fields</div>
          <textarea
            className="code-drawer__editor"
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder={`name: BlockName\ndoc: Optional description\nstereotypes: profile, another\ntags: key=value`}
          />
          {error ? <div className="code-drawer__error">{error}</div> : null}
          <div className="code-drawer__actions">
            <button type="button" className="button" onClick={onApply} disabled={!element}>
              Apply to model
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
