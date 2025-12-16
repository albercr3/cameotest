import type { Element } from '@cameotest/shared';

interface SysmlDrawerProps {
  open: boolean;
  element?: Element;
  dirty: boolean;
  canApply: boolean;
  externalChange: boolean;
  pendingElement?: Element | null;
  preview: string;
  draft: string;
  error?: string | null;
  pinned?: boolean;
  onPin?: () => void;
  onUnpin?: () => void;
  onDraftChange: (value: string) => void;
  onApply: () => void;
  onClose: () => void;
  onKeepEditing?: () => void;
  onDiscardAndSwitch?: () => void;
  onReloadFromModel: () => void;
}

export function SysmlDrawer({
  open,
  element,
  dirty,
  canApply,
  externalChange,
  pendingElement,
  preview,
  draft,
  error,
  pinned,
  onPin,
  onUnpin,
  onDraftChange,
  onApply,
  onClose,
  onKeepEditing,
  onDiscardAndSwitch,
  onReloadFromModel,
}: SysmlDrawerProps) {
  const showPending = pendingElement !== undefined;
  const pendingName = pendingElement ? pendingElement.name : 'the new selection';
  const applyDisabled = !canApply || !dirty || !!error;

  return (
    <aside className={`code-drawer${open ? ' code-drawer--open' : ''}`} aria-hidden={!open}>
      <div className="code-drawer__header">
        <div className="code-drawer__header-left">
          <div className="code-drawer__status-row">
            <p className="pill pill--muted">SysML v2 code</p>
            <div className={`code-drawer__state${dirty ? ' code-drawer__state--dirty' : ''}`}>
              <span className={`code-drawer__dot${dirty ? ' code-drawer__dot--dirty' : ''}`} aria-hidden />
              {dirty ? 'Unsaved changes' : 'Saved'}
            </div>
          </div>
          <h3>{element ? element.name : 'No selection'}</h3>
          <p className="code-drawer__subtitle">
            {element ? `${element.metaclass} • ${element.id}` : 'Select an element to inspect or edit its code view.'}
          </p>
          {pinned ? (
            <div className="code-drawer__banner code-drawer__banner--info">
              <div>Drawer pinned to {element?.name ?? 'selection'}.</div>
              <div className="code-drawer__banner-actions">
                <button type="button" className="button button--ghost" onClick={onUnpin}>
                  Unpin
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="code-drawer__header-actions">
          <button type="button" className="button button--ghost" onClick={onClose}>
            Close
          </button>
          <button type="button" className="button button--ghost" onClick={pinned ? onUnpin : onPin} disabled={!element}>
            {pinned ? 'Unpin' : 'Pin'}
          </button>
        </div>
      </div>
      <div className="code-drawer__body">
        {showPending ? (
          <div className="code-drawer__banner">
            <div>
              <strong>Selection changed.</strong> You have unsaved edits for {element?.name ?? 'previous element'}.
              <br />
              Switch to {pendingName}?
            </div>
            <div className="code-drawer__banner-actions">
              <button type="button" className="button button--ghost" onClick={onKeepEditing}>
                Keep editing
              </button>
              <button type="button" className="button" onClick={onDiscardAndSwitch}>
                Discard &amp; switch
              </button>
            </div>
          </div>
        ) : null}
        <div className="code-drawer__section">
          <div className="code-drawer__label">Generated preview</div>
          <pre className="code-drawer__preview">{preview}</pre>
        </div>
        <div className="code-drawer__section">
          <div className="code-drawer__label">Editable fields</div>
          {externalChange ? (
            <div className="code-drawer__banner code-drawer__banner--info">
              <div>Model changed externally. Reload to keep the draft aligned.</div>
              <div className="code-drawer__banner-actions">
                <button type="button" className="button" onClick={onReloadFromModel}>
                  Reload from model
                </button>
              </div>
            </div>
          ) : null}
          {!externalChange && dirty ? <div className="code-drawer__hint">Draft differs from model</div> : null}
          <textarea
            className="code-drawer__editor"
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            disabled={!element}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault();
                onApply();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
              }
            }}
            placeholder={`name: BlockName\ndoc: Optional description\nstereotypes: profile, another\ntags: key=value`}
          />
          {error ? <div className="code-drawer__error">{error}</div> : null}
          <div className="code-drawer__actions">
            <button type="button" className="button" onClick={onApply} disabled={applyDisabled}>
              Apply to model
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
