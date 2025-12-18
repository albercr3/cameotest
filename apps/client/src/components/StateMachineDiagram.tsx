import type { Diagram, Element, Relationship } from '@cameotest/shared';

interface StateMachineDiagramProps {
  diagram: Diagram;
  elements: Record<string, Element>;
  relationships: Record<string, Relationship>;
}

export function StateMachineDiagram({ diagram, elements, relationships }: StateMachineDiagramProps) {
  const nodeElements = diagram.nodes.map((node) => elements[node.elementId]).filter(Boolean);
  const rels = diagram.edges.map((edge) => relationships[edge.relationshipId]).filter(Boolean);

  return (
    <div className="diagram-placeholder">
      <h3>{diagram.name}</h3>
      <p className="diagram-placeholder__subtitle">State Machine diagram preview</p>
      <div className="diagram-placeholder__section">
        <div className="diagram-placeholder__label">States and vertices</div>
        <ul>
          {nodeElements.map((element) => (
            <li key={element.id}>{`${element.name} (${element.metaclass})`}</li>
          ))}
          {nodeElements.length === 0 ? <li className="diagram-placeholder__muted">No nodes placed yet.</li> : null}
        </ul>
      </div>
      <div className="diagram-placeholder__section">
        <div className="diagram-placeholder__label">Transitions</div>
        <ul>
          {rels.map((rel) => (
            <li key={rel.id}>{rel.type}</li>
          ))}
          {rels.length === 0 ? <li className="diagram-placeholder__muted">No transitions defined.</li> : null}
        </ul>
      </div>
    </div>
  );
}
