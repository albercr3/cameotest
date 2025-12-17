import { useEffect, useMemo, useState } from 'react';
import type { Element, Metaclass, Relationship, RelationshipType } from '@cameotest/shared';

type Selection = { kind: 'element' | 'relationship'; id: string };
type FlowDirection = 'in' | 'out' | 'inout';

interface PropertiesPanelProps {
  selection?: Selection;
  element?: Element;
  relationship?: Relationship;
  elements: Record<string, Element>;
  relatedRelationships: Relationship[];
  metaclasses: Metaclass[];
  relationshipTypes: RelationshipType[];
  relationshipCreationTypes?: RelationshipType[];
  onSelect: (selection: Selection) => void;
  onElementChange: (updates: Partial<Element>) => void;
  onRelationshipChange: (updates: Partial<Relationship>) => void;
  onConnectorItemFlowChange?: (itemFlowLabel?: string) => void;
  onCreateRelationship?: (type: RelationshipType, targetId: string) => void;
  onDeleteRelationship?: () => void;
  onAddToDiagram?: () => void;
  onAddPort?: () => void;
  onCreatePart?: () => void;
  onCreateIbd?: () => void;
}

export function PropertiesPanel({
  selection,
  element,
  relationship,
  elements,
  relatedRelationships,
  metaclasses,
  relationshipTypes,
  relationshipCreationTypes,
  onSelect,
  onElementChange,
  onRelationshipChange,
  onConnectorItemFlowChange,
  onCreateRelationship,
  onDeleteRelationship,
  onAddToDiagram,
  onAddPort,
  onCreatePart,
  onCreateIbd,
}: PropertiesPanelProps) {
  const [newTarget, setNewTarget] = useState('');
  const [newType, setNewType] = useState<RelationshipType>(relationshipTypes[0]);

  useEffect(() => {
    setNewTarget('');
    setNewType((relationshipCreationTypes ?? relationshipTypes)[0]);
  }, [element?.id, relationshipCreationTypes, relationshipTypes]);

  const targetOptions = useMemo(() => {
    return Object.values(elements)
      .filter((el) => (element ? el.id !== element.id : true))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [element, elements]);

  const creationTypeOptions = relationshipCreationTypes ?? relationshipTypes;
  const signalOptions = useMemo(
    () => Object.values(elements).filter((item) => item.metaclass === 'Signal'),
    [elements],
  );

  if (!element && !relationship) {
    return <p className="muted">Select an element or relationship to inspect its properties.</p>;
  }

  if (relationship && selection?.kind === 'relationship') {
    const isConnector = relationship.type === 'Connector';
    const source = isConnector ? elements[relationship.sourcePortId] : elements[relationship.sourceId];
    const target = isConnector ? elements[relationship.targetPortId] : elements[relationship.targetId];
    const typeOptions = isConnector ? ['Connector'] : relationshipTypes;
    const itemFlowLabel = relationship.type === 'Connector' ? relationship.itemFlowLabel ?? '' : '';
    return (
      <form className="properties" onSubmit={(event) => event.preventDefault()}>
        <div className="properties__actions">
          <button
            type="button"
            className="button button--ghost"
            onClick={onDeleteRelationship}
            disabled={!onDeleteRelationship}
          >
            Delete relationship
          </button>
        </div>
        <label className="label" htmlFor="rel-type">
          Type
        </label>
        <select
          id="rel-type"
          value={relationship.type}
          onChange={(event) => onRelationshipChange({ type: event.target.value as RelationshipType })}
          disabled={isConnector}
        >
          {typeOptions.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>

        <label className="label">Source</label>
        <div className="pill">{source?.name ?? 'Missing source'}</div>

        <label className="label">Target</label>
        <div className="pill">{target?.name ?? 'Missing target'}</div>

        {isConnector ? (
          <>
            <label className="label" htmlFor="connector-item-flow">
              Item flow
            </label>
            <input
              id="connector-item-flow"
              value={itemFlowLabel}
              maxLength={80}
              placeholder="Optional label"
              onChange={(event) => onConnectorItemFlowChange?.(event.target.value.trim() || undefined)}
            />
          </>
        ) : null}
      </form>
    );
  }

  if (!element) {
    return <p className="muted">Select an element to inspect its properties.</p>;
  }

  return (
    <form className="properties" onSubmit={(event) => event.preventDefault()}>
      <div className="properties__actions">
        <button type="button" className="button" onClick={onAddToDiagram} disabled={!onAddToDiagram}>
          Add to current diagram
        </button>
        {onAddPort ? (
          <button type="button" className="button button--ghost" onClick={onAddPort} disabled={!onAddPort}>
            Add Port
          </button>
        ) : null}
        {onCreatePart ? (
          <button type="button" className="button button--ghost" onClick={onCreatePart} disabled={!onCreatePart}>
            Add Part
          </button>
        ) : null}
        {onCreateIbd ? (
          <button type="button" className="button button--ghost" onClick={onCreateIbd} disabled={!onCreateIbd}>
            Create / Open IBD
          </button>
        ) : null}
      </div>
      <label className="label" htmlFor="prop-name">
        Name
      </label>
      <input
        id="prop-name"
        value={element.name}
        onChange={(event) => onElementChange({ name: event.target.value })}
      />

      <label className="label" htmlFor="prop-metaclass">
        Metaclass
      </label>
      <select
        id="prop-metaclass"
        value={element.metaclass}
        onChange={(event) => onElementChange({ metaclass: event.target.value as Metaclass })}
      >
        {metaclasses.map((mc) => (
          <option key={mc} value={mc}>
            {mc}
          </option>
        ))}
      </select>

      {element.metaclass === 'Port' ? (
        <>
          <label className="label" htmlFor="prop-signal">
            Signal type
          </label>
          <select
            id="prop-signal"
            value={element.signalTypeId ?? ''}
            onChange={(event) =>
              onElementChange({ signalTypeId: event.target.value || undefined })
            }
          >
            <option value="">Unspecified</option>
            {signalOptions.map((signal) => (
              <option key={signal.id} value={signal.id}>
                {signal.name}
              </option>
            ))}
          </select>

          <label className="label" htmlFor="prop-direction">
            Flow direction
          </label>
          <select
            id="prop-direction"
            value={(element.direction as FlowDirection) ?? 'inout'}
            onChange={(event) => onElementChange({ direction: event.target.value as FlowDirection })}
          >
            <option value="in">In</option>
            <option value="out">Out</option>
            <option value="inout">Inout</option>
          </select>
        </>
      ) : null}

      {element.metaclass === 'Part' ? (
        <>
          <label className="label">Type</label>
          <div className="pill">
            {element.typeId ? elements[element.typeId]?.name ?? 'Missing type' : 'Unspecified type'}
          </div>
        </>
      ) : null}

      <label className="label" htmlFor="prop-doc">
        Documentation
      </label>
      <textarea
        id="prop-doc"
        value={element.documentation}
        onChange={(event) => onElementChange({ documentation: event.target.value })}
        rows={4}
      />

      <label className="label" htmlFor="prop-stereotypes">
        Stereotypes (comma separated)
      </label>
      <input
        id="prop-stereotypes"
        value={element.stereotypes.join(', ')}
        onChange={(event) =>
          onElementChange({ stereotypes: event.target.value.split(',').map((s) => s.trim()).filter(Boolean) })
        }
      />

      <label className="label" htmlFor="prop-tags">
        Tags (key=value, comma separated)
      </label>
      <input
        id="prop-tags"
        value={Object.entries(element.tags)
          .map(([key, value]) => `${key}=${value}`)
          .join(', ')}
        onChange={(event) => {
          const next = event.target.value
            .split(',')
            .map((pair) => pair.trim())
            .filter(Boolean)
            .reduce<Record<string, string>>((acc, pair) => {
              const [key, value] = pair.split('=');
              if (key && value) acc[key.trim()] = value.trim();
              return acc;
            }, {});
          onElementChange({ tags: next });
        }}
      />

      <hr />
      <div className="properties__row">
        <div>
          <div className="label">Relationships</div>
          <ul className="list">
            {relatedRelationships.length === 0 ? (
              <li className="muted">No relationships yet.</li>
            ) : (
              relatedRelationships.map((rel) => {
                const source = rel.type === 'Connector' ? elements[rel.sourcePortId] : elements[rel.sourceId];
                const target = rel.type === 'Connector' ? elements[rel.targetPortId] : elements[rel.targetId];
                return (
                  <li key={rel.id} className="list__relationship">
                    <div>
                      <div className="list__title">{rel.type}</div>
                      <div className="list__meta">
                        {(source?.name ?? 'Unknown')} → {(target?.name ?? 'Unknown')}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="button button--ghost"
                      onClick={() => onSelect({ kind: 'relationship', id: rel.id })}
                    >
                      Select
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      </div>

      <div className="properties__row">
        <div>
          <div className="label">Create relationship</div>
          <div className="properties__grid">
            <label className="label" htmlFor="rel-type-new">
              Type
            </label>
            <select
              id="rel-type-new"
              value={newType}
              onChange={(event) => setNewType(event.target.value as RelationshipType)}
            >
              {creationTypeOptions.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <label className="label" htmlFor="rel-target">
              Target
            </label>
            <select
              id="rel-target"
              value={newTarget}
              onChange={(event) => setNewTarget(event.target.value)}
            >
              <option value="">Select element</option>
              {targetOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </div>
          <div className="properties__actions properties__actions--inline">
            <button
              type="button"
              className="button"
              onClick={() => newTarget && onCreateRelationship?.(newType, newTarget)}
              disabled={!onCreateRelationship || !newTarget}
            >
              Create relationship
            </button>
          </div>
        </div>
      </div>
    </form>
  );
}
