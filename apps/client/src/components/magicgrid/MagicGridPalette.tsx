import type { GridElement } from '@cameotest/magicgrid';

interface MagicGridPaletteProps {
  templates: GridElement[];
  onAdd: (template: GridElement) => void;
}

export function MagicGridPalette({ templates, onAdd }: MagicGridPaletteProps) {
  return (
    <div className="magicgrid-palette">
      {templates.map((template) => (
        <div key={template.id} className="magicgrid-palette__item">
          <div>
            <div className="magicgrid-palette__title">{template.title}</div>
            <div className="magicgrid-palette__meta">
              {template.rowSpan}×{template.columnSpan} · layer: {template.layer}
            </div>
            {template.notes ? <div className="magicgrid-palette__notes">{template.notes}</div> : null}
          </div>
          <button className="button" type="button" onClick={() => onAdd(template)}>
            Add to grid
          </button>
        </div>
      ))}
    </div>
  );
}
