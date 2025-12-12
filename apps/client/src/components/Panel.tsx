import { PropsWithChildren } from 'react';

interface PanelProps extends PropsWithChildren {
  title: string;
  subtitle?: string;
}

export function Panel({ title, subtitle, children }: PanelProps) {
  return (
    <section className="panel">
      <header className="panel__header">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p className="panel__subtitle">{subtitle}</p> : null}
        </div>
      </header>
      <div className="panel__body">{children}</div>
    </section>
  );
}
