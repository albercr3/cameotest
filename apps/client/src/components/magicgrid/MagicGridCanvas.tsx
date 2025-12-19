import { useEffect, useMemo, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { GridElement, LayoutMetadata, MagicGridConstraint } from '@cameotest/magicgrid';
import type { DragState, GridDraft } from './interaction';
import { hasCollision, normalizeDraft } from './interaction';

interface MagicGridCanvasProps {
  layout: LayoutMetadata;
  elements: GridElement[];
  constraints: MagicGridConstraint[];
  selectedId: string | null;
  dragState: DragState | null;
  onSelect: (id: string | null) => void;
  onDragStateChange: (state: DragState | null) => void;
  onCommitPosition: (id: string, draft: GridDraft) => void;
}

type GridMetrics = {
  originX: number;
  originY: number;
  columnSize: number;
  rowSize: number;
};

type InteractionSession = {
  pointerId: number;
  id: string;
  mode: DragState['mode'];
  startX: number;
  startY: number;
  origin: GridDraft;
  metrics: GridMetrics;
  lastDraft: GridDraft;
  collision: boolean;
};

export function MagicGridCanvas({
  layout,
  elements,
  constraints,
  selectedId,
  dragState,
  onSelect,
  onDragStateChange,
  onCommitPosition,
}: MagicGridCanvasProps) {
  const templateRows = `repeat(${layout.rows}, minmax(32px, 1fr))`;
  const templateCols = `repeat(${layout.columns}, minmax(32px, 1fr))`;
  const gridRef = useRef<HTMLDivElement | null>(null);
  const interactionRef = useRef<InteractionSession | null>(null);
  const snapToGrid = layout.viewport?.snapToGrid !== false;

  const elementsById = useMemo(
    () => new Map(elements.map((element) => [element.id, element])),
    [elements],
  );

  useEffect(() => {
    return () => {
      detachPointerListeners();
    };
  }, []);

  function detachPointerListeners() {
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
    window.removeEventListener('pointercancel', handlePointerUp);
  }

  function startInteraction(event: ReactPointerEvent, element: GridElement, mode: DragState['mode']) {
    if (element.locked) return;
    const grid = gridRef.current;
    if (!grid) return;
    const metrics = getGridMetrics(grid, layout);
    if (!metrics) return;

    event.preventDefault();
    event.stopPropagation();

    const origin: GridDraft = {
      row: element.row,
      column: element.column,
      rowSpan: element.rowSpan,
      columnSpan: element.columnSpan,
    };
    const normalized = normalizeDraft(origin, layout);

    interactionRef.current = {
      pointerId: event.pointerId,
      id: element.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      origin: normalized,
      metrics,
      lastDraft: normalized,
      collision: false,
    };

    onSelect(element.id);
    onDragStateChange({
      id: element.id,
      mode,
      origin: normalized,
      draft: normalized,
      collision: false,
      snapping: snapToGrid,
    });

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);
  }

  function handlePointerMove(event: PointerEvent) {
    const session = interactionRef.current;
    if (!session || event.pointerId !== session.pointerId) return;
    const deltaX = event.clientX - session.startX;
    const deltaY = event.clientY - session.startY;

    const columnStep = session.metrics.columnSize + layout.columnGap;
    const rowStep = session.metrics.rowSize + layout.rowGap;
    const deltaColumns = deltaX / (columnStep || 1);
    const deltaRows = deltaY / (rowStep || 1);

    const nextDraft =
      session.mode === 'move'
        ? {
            ...session.origin,
            column: session.origin.column + (snapToGrid ? Math.round(deltaColumns) : Math.floor(deltaColumns)),
            row: session.origin.row + (snapToGrid ? Math.round(deltaRows) : Math.floor(deltaRows)),
          }
        : {
            ...session.origin,
            columnSpan: session.origin.columnSpan + (snapToGrid ? Math.round(deltaColumns) : Math.floor(deltaColumns)),
            rowSpan: session.origin.rowSpan + (snapToGrid ? Math.round(deltaRows) : Math.floor(deltaRows)),
          };

    const normalized = normalizeDraft(nextDraft, layout);
    const collision = hasCollision(normalized, elements, session.id);
    session.lastDraft = normalized;
    session.collision = collision;

    onDragStateChange({
      id: session.id,
      mode: session.mode,
      origin: session.origin,
      draft: normalized,
      collision,
      snapping: snapToGrid,
    });
  }

  function handlePointerUp(event: PointerEvent) {
    const session = interactionRef.current;
    if (!session || event.pointerId !== session.pointerId) return;
    const draft = session.lastDraft ?? session.origin;
    const collision = session.collision ?? hasCollision(draft, elements, session.id);

    detachPointerListeners();
    interactionRef.current = null;

    if (!collision && hasChanged(session.origin, draft)) {
      onCommitPosition(session.id, normalizeDraft(draft, layout));
    }

    onDragStateChange(null);
  }

  function hasChanged(origin: GridDraft, draft: GridDraft) {
    return (
      origin.row !== draft.row ||
      origin.column !== draft.column ||
      origin.rowSpan !== draft.rowSpan ||
      origin.columnSpan !== draft.columnSpan
    );
  }

  function getGridMetrics(grid: HTMLDivElement, metadata: LayoutMetadata): GridMetrics | null {
    const rect = grid.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const computed = window.getComputedStyle(grid);
    const paddingLeft = Number.parseFloat(computed.paddingLeft || '0');
    const paddingRight = Number.parseFloat(computed.paddingRight || '0');
    const paddingTop = Number.parseFloat(computed.paddingTop || '0');
    const paddingBottom = Number.parseFloat(computed.paddingBottom || '0');

    const width = rect.width - paddingLeft - paddingRight;
    const height = rect.height - paddingTop - paddingBottom;
    const columnSize = (width - (metadata.columns - 1) * metadata.columnGap) / metadata.columns;
    const rowSize = (height - (metadata.rows - 1) * metadata.rowGap) / metadata.rows;

    return {
      originX: rect.left + paddingLeft,
      originY: rect.top + paddingTop,
      columnSize: columnSize || 1,
      rowSize: rowSize || 1,
    };
  }

  function handleKeyboardAdjust(event: KeyboardEvent, element: GridElement) {
    const direction = getDirection(event.key);
    if (!direction) return;
    event.preventDefault();

    const current = elementsById.get(element.id);
    if (!current) return;

    const draft: GridDraft = {
      row: current.row,
      column: current.column,
      rowSpan: current.rowSpan,
      columnSpan: current.columnSpan,
    };

    if (event.shiftKey) {
      if (direction.axis === 'column') {
        draft.columnSpan = Math.max(1, draft.columnSpan + direction.delta);
      } else {
        draft.rowSpan = Math.max(1, draft.rowSpan + direction.delta);
      }
    } else {
      if (direction.axis === 'column') {
        draft.column = draft.column + direction.delta;
      } else {
        draft.row = draft.row + direction.delta;
      }
    }

    const normalized = normalizeDraft(draft, layout);
    const collision = hasCollision(normalized, elements, element.id);
    if (!collision) {
      onCommitPosition(element.id, normalized);
    } else {
      const origin = normalizeDraft(
        {
          row: current.row,
          column: current.column,
          rowSpan: current.rowSpan,
          columnSpan: current.columnSpan,
        },
        layout,
      );
      onDragStateChange({
        id: element.id,
        mode: event.shiftKey ? 'resize' : 'move',
        origin,
        draft: normalized,
        collision: true,
        snapping: snapToGrid,
      });
      window.setTimeout(() => onDragStateChange(null), 300);
    }
  }

  function getDirection(key: string) {
    if (key === 'ArrowRight') return { axis: 'column' as const, delta: 1 };
    if (key === 'ArrowLeft') return { axis: 'column' as const, delta: -1 };
    if (key === 'ArrowDown') return { axis: 'row' as const, delta: 1 };
    if (key === 'ArrowUp') return { axis: 'row' as const, delta: -1 };
    return null;
  }

  const ghostElement = dragState ? elementsById.get(dragState.id) : null;

  return (
    <div className="magicgrid-canvas">
      <div className="magicgrid-canvas__header">
        <div>
          <h2>Grid workspace</h2>
          <p>
            {layout.rows} rows · {layout.columns} columns · {constraints.length} constraints
          </p>
        </div>
        <div className="magicgrid-canvas__legend" aria-hidden="true">
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
        ref={gridRef}
        className={`magicgrid-canvas__grid${dragState ? ' magicgrid-canvas__grid--dragging' : ''}`}
        style={{
          gridTemplateRows: templateRows,
          gridTemplateColumns: templateCols,
          gap: `${layout.rowGap}px ${layout.columnGap}px`,
          background: layout.background.color,
        }}
        role="grid"
        aria-label="MagicGrid workspace"
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
            data-row={element.row}
            data-column={element.column}
            data-row-span={element.rowSpan}
            data-column-span={element.columnSpan}
            data-testid={`tile-${element.id}`}
            onClick={() => onSelect(element.id)}
            onPointerDown={(event) => startInteraction(event, element, 'move')}
            onKeyDown={(event) => handleKeyboardAdjust(event, element)}
            type="button"
            title={element.notes || element.title}
            aria-pressed={selectedId === element.id}
            aria-selected={selectedId === element.id}
            aria-grabbed={dragState?.id === element.id || undefined}
          >
            <span className="magicgrid-canvas__title">{element.title}</span>
            <span className="magicgrid-canvas__meta">
              r{element.row} c{element.column} · {element.rowSpan}×{element.columnSpan}
            </span>
            <span
              className="magicgrid-canvas__resize"
              role="presentation"
              aria-hidden="true"
              onPointerDown={(event) => startInteraction(event, element, 'resize')}
            />
          </button>
        ))}
        {dragState && ghostElement ? (
          <div
            className="magicgrid-canvas__ghost"
            data-colliding={dragState.collision}
            data-snapping={dragState.snapping}
            style={{
              gridRow: `${dragState.draft.row + 1} / span ${dragState.draft.rowSpan}`,
              gridColumn: `${dragState.draft.column + 1} / span ${dragState.draft.columnSpan}`,
            }}
            aria-label={`${ghostElement.title} preview`}
          >
            <span>{ghostElement.title}</span>
            <span className="magicgrid-canvas__meta">
              r{dragState.draft.row} c{dragState.draft.column} · {dragState.draft.rowSpan}×{dragState.draft.columnSpan}
            </span>
          </div>
        ) : null}
        <div className="magicgrid-canvas__background" />
      </div>
    </div>
  );
}
