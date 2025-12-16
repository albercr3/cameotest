import { PropsWithChildren, ReactNode } from 'react';

interface PanelProps extends PropsWithChildren {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

export function Panel({ title, subtitle, actions, children }: PanelProps) {
  return (
    <section className="panel">
      <header className="panel__header">
        <div>
          {typeof title === 'string' || typeof title === 'number' ? (
            <h2>{title}</h2>
          ) : (
            <div className="panel__title">{title}</div>
          )}
          {subtitle ? <p className="panel__subtitle">{subtitle}</p> : null}
        </div>
        {actions ? <div className="panel__actions">{actions}</div> : null}
      </header>
      <div className="panel__body">{children}</div>
    </section>
  );
}
