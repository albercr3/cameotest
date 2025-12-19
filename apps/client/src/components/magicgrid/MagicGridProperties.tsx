import { useMemo } from 'react';
import type { GridElement, LayoutMetadata, MagicGridConstraint } from '@cameotest/magicgrid';
import { Panel } from '../Panel';
import { MagicGridConstraints, type MagicGridConstraintDraft } from './MagicGridConstraints';

interface MagicGridPropertiesProps {
  element: GridElement | null;
  elements: GridElement[];
  constraints: MagicGridConstraint[];
  layout: LayoutMetadata;
  onChange: (id: string, updates: Partial<GridElement>) => void;
  onDelete: (id: string) => void;
  onAddConstraint: (constraint: MagicGridConstraintDraft) => void;
  onUpdateConstraint: (id: string, updates: Partial<MagicGridConstraint>) => void;
  onDeleteConstraint: (id: string) => void;
  onLayoutChange: (updates: Partial<LayoutMetadata>) => void;
}

export function MagicGridProperties({
  element,
  elements,
  constraints,
  layout,
  onChange,
  onDelete,
  onAddConstraint,
  onUpdateConstraint,
  onDeleteConstraint,
  onLayoutChange,
}: MagicGridPropertiesProps) {
  const availableLayers = useMemo(() => ['background', 'content', 'overlay'], []);

  return (
    <div className="magicgrid-properties">
      <Panel
        title="Layout"
        subtitle="Grid dimensions and spacing"
        actions={
          <button className="button button--ghost" type="button" onClick={() => onLayoutChange(layout)}>
            Apply
          </button>
        }
      >
        <div className="magicgrid-properties__form">
          <label>
            <span>Rows</span>
            <input
              type="number"
              value={layout.rows}
              min={1}
              onChange={(event) => onLayoutChange({ rows: Number(event.target.value) })}
            />
          </label>
          <label>
            <span>Columns</span>
            <input
              type="number"
              value={layout.columns}
              min={1}
              onChange={(event) => onLayoutChange({ columns: Number(event.target.value) })}
            />
          </label>
          <label>
            <span>Row gap</span>
            <input
              type="number"
              value={layout.rowGap}
              min={0}
              onChange={(event) => onLayoutChange({ rowGap: Number(event.target.value) })}
            />
          </label>
          <label>
            <span>Column gap</span>
            <input
              type="number"
              value={layout.columnGap}
              min={0}
              onChange={(event) => onLayoutChange({ columnGap: Number(event.target.value) })}
            />
          </label>
        </div>
      </Panel>
      <Panel title="Element" subtitle={element ? 'Edit the selected element' : 'Choose an element to edit'}>
        {element ? (
          <div className="magicgrid-properties__form">
            <label>
              <span>Title</span>
              <input
                type="text"
                value={element.title}
                onChange={(event) => onChange(element.id, { title: event.target.value })}
              />
            </label>
            <div className="magicgrid-properties__grid">
              <label>
                <span>Row</span>
                <input
                  type="number"
                  value={element.row}
                  min={0}
                  onChange={(event) => onChange(element.id, { row: Number(event.target.value) })}
                />
              </label>
              <label>
                <span>Column</span>
                <input
                  type="number"
                  value={element.column}
                  min={0}
                  onChange={(event) => onChange(element.id, { column: Number(event.target.value) })}
                />
              </label>
              <label>
                <span>Row span</span>
                <input
                  type="number"
                  value={element.rowSpan}
                  min={1}
                  onChange={(event) => onChange(element.id, { rowSpan: Number(event.target.value) })}
                />
              </label>
              <label>
                <span>Column span</span>
                <input
                  type="number"
                  value={element.columnSpan}
                  min={1}
                  onChange={(event) => onChange(element.id, { columnSpan: Number(event.target.value) })}
                />
              </label>
            </div>
            <label>
              <span>Layer</span>
              <select
                value={element.layer}
                onChange={(event) => onChange(element.id, { layer: event.target.value as GridElement['layer'] })}
              >
                {availableLayers.map((layer) => (
                  <option key={layer} value={layer}>
                    {layer}
                  </option>
                ))}
              </select>
            </label>
            <label className="magicgrid-properties__checkbox">
              <input
                type="checkbox"
                checked={element.visible !== false}
                onChange={(event) => onChange(element.id, { visible: event.target.checked })}
              />
              <span>Visible</span>
            </label>
            <label>
              <span>Notes</span>
              <textarea
                value={element.notes}
                rows={3}
                onChange={(event) => onChange(element.id, { notes: event.target.value })}
              />
            </label>
            <div className="magicgrid-properties__footer">
              <button className="button" type="button" onClick={() => onDelete(element.id)}>
                Remove element
              </button>
            </div>
          </div>
        ) : (
          <p className="magicgrid-properties__empty">Select an element on the grid to edit its properties.</p>
        )}
      </Panel>
      <Panel title="Constraints" subtitle="Define relationships between elements">
        <MagicGridConstraints
          constraints={constraints}
          elements={elements}
          selectedElementId={element?.id ?? null}
          onAddConstraint={onAddConstraint}
          onUpdateConstraint={onUpdateConstraint}
          onDeleteConstraint={onDeleteConstraint}
        />
      </Panel>
    </div>
  );
}
