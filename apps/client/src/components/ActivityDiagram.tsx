import type { Diagram, Element } from '@cameotest/shared';

interface ActivityDiagramProps {
  diagram: Diagram;
  elements: Record<string, Element>;
}

export function ActivityDiagram({ diagram, elements }: ActivityDiagramProps) {
  const nodeElements = diagram.nodes.map((node) => elements[node.elementId]).filter(Boolean);

  return (
    <div className="diagram-placeholder">
      <h3>{diagram.name}</h3>
      <p className="diagram-placeholder__subtitle">Activity diagram preview</p>
      <div className="diagram-placeholder__section">
        <div className="diagram-placeholder__label">Actions and flows</div>
        <ul>
          {nodeElements.map((element) => (
            <li key={element.id}>{`${element.name} (${element.metaclass})`}</li>
          ))}
          {nodeElements.length === 0 ? <li className="diagram-placeholder__muted">No actions yet.</li> : null}
        </ul>
      </div>
    </div>
  );
}
