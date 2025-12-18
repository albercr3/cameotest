import type { GridElement, LayoutMetadata, MagicGridConstraint } from '@cameotest/magicgrid';

interface MagicGridCanvasProps {
  layout: LayoutMetadata;
  elements: GridElement[];
  constraints: MagicGridConstraint[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function MagicGridCanvas({ layout, elements, constraints, selectedId, onSelect }: MagicGridCanvasProps) {
  const templateRows = `repeat(${layout.rows}, minmax(32px, 1fr))`;
  const templateCols = `repeat(${layout.columns}, minmax(32px, 1fr))`;

  return (
    <div className="magicgrid-canvas">
      <div className="magicgrid-canvas__header">
        <div>
          <h2>Grid workspace</h2>
          <p>
            {layout.rows} rows · {layout.columns} columns · {constraints.length} constraints
          </p>
        </div>
        <div className="magicgrid-canvas__legend">
          <span className="magicgrid-canvas__legend-item" data-layer="background">
            Background
          </span>
          <span className="magicgrid-canvas__legend-item" data-layer="content">
            Content
          </span>
          <span className="magicgrid-canvas__legend-item" data-layer="overlay">
            Overlay
          </span>
        </div>
      </div>
      <div
        className="magicgrid-canvas__grid"
        style={{
          gridTemplateRows: templateRows,
          gridTemplateColumns: templateCols,
          gap: `${layout.rowGap}px ${layout.columnGap}px`,
          background: layout.background.color,
        }}
      >
        {elements.map((element) => (
          <button
            key={element.id}
            className={`magicgrid-canvas__tile magicgrid-canvas__tile--${element.layer}`}
            style={{
              gridRow: `${element.row + 1} / span ${element.rowSpan}`,
              gridColumn: `${element.column + 1} / span ${element.columnSpan}`,
              opacity: element.visible === false ? 0.4 : 1,
            }}
            data-selected={selectedId === element.id}
            onClick={() => onSelect(element.id)}
            type="button"
            title={element.notes || element.title}
          >
            <span className="magicgrid-canvas__title">{element.title}</span>
            <span className="magicgrid-canvas__meta">
              r{element.row} c{element.column} · {element.rowSpan}×{element.columnSpan}
            </span>
          </button>
        ))}
        <div className="magicgrid-canvas__background" />
      </div>
    </div>
  );
}
