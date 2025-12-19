import type { GridElement, LayoutMetadata } from '@cameotest/magicgrid';

export type GridDraft = Pick<GridElement, 'row' | 'column' | 'rowSpan' | 'columnSpan'>;

export type DragState = {
  id: string;
  mode: 'move' | 'resize';
  origin: GridDraft;
  draft: GridDraft;
  collision: boolean;
  snapping: boolean;
};

export function normalizeDraft(draft: GridDraft, layout: LayoutMetadata): GridDraft {
  const rowSpan = Math.min(layout.rows, Math.max(1, Math.round(draft.rowSpan)));
  const columnSpan = Math.min(layout.columns, Math.max(1, Math.round(draft.columnSpan)));
  const maxRow = Math.max(0, layout.rows - rowSpan);
  const maxColumn = Math.max(0, layout.columns - columnSpan);

  const row = Math.min(Math.max(0, Math.round(draft.row)), maxRow);
  const column = Math.min(Math.max(0, Math.round(draft.column)), maxColumn);

  return { row, column, rowSpan, columnSpan };
}

export function hasCollision(draft: GridDraft, elements: GridElement[], id: string): boolean {
  return elements.some((other) => {
    if (other.id === id) return false;
    return rectanglesOverlap(draft, other);
  });
}

function rectanglesOverlap(a: GridDraft, b: GridElement): boolean {
  const horizontal = a.column < b.column + b.columnSpan && a.column + a.columnSpan > b.column;
  const vertical = a.row < b.row + b.rowSpan && a.row + a.rowSpan > b.row;
  return horizontal && vertical;
}
