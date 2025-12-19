import { useState } from 'react';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { GridElement, LayoutMetadata } from '@cameotest/magicgrid';
import { defaultLayoutMetadata } from '@cameotest/magicgrid';
import { MagicGridCanvas } from './MagicGridCanvas';
import type { DragState, GridDraft } from './interaction';
import { normalizeDraft } from './interaction';

function createLayout(overrides: Partial<LayoutMetadata> = {}): LayoutMetadata {
  return {
    ...defaultLayoutMetadata,
    ...overrides,
    viewport: { ...defaultLayoutMetadata.viewport, ...overrides.viewport },
    background: { ...defaultLayoutMetadata.background, ...overrides.background },
  };
}

function CanvasHarness({
  initialElements,
  layout,
}: {
  initialElements: GridElement[];
  layout: LayoutMetadata;
}) {
  const [elements, setElements] = useState(initialElements);
  const [selectedId, setSelectedId] = useState(initialElements[0]?.id ?? null);
  const [dragState, setDragState] = useState<DragState | null>(null);

  const handleCommit = (id: string, draft: GridDraft) => {
    const normalized = normalizeDraft(draft, layout);
    setElements((current) => current.map((element) => (element.id === id ? { ...element, ...normalized } : element)));
    setDragState(null);
    setSelectedId(id);
  };

  return (
    <MagicGridCanvas
      layout={layout}
      elements={elements}
      constraints={[]}
      selectedId={selectedId}
      dragState={dragState}
      onSelect={setSelectedId}
      onDragStateChange={setDragState}
      onCommitPosition={handleCommit}
    />
  );
}

function mockGridSize(width = 400, height = 400) {
  const rect = {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: width,
    bottom: height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;

  return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect);
}

describe('MagicGridCanvas interactions', () => {
  let rectSpy: ReturnType<typeof mockGridSize>;

  beforeEach(() => {
    rectSpy = mockGridSize();
  });

  afterEach(() => {
    rectSpy.mockRestore();
  });

  it('drags a tile with snap-to-grid and commits through the canvas', () => {
    const layout = createLayout({ rows: 4, columns: 4, rowGap: 0, columnGap: 0 });
    const primary: GridElement = {
      id: 'drag-me',
      title: 'Primary',
      row: 0,
      column: 0,
      rowSpan: 1,
      columnSpan: 1,
      layer: 'content',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const anchor: GridElement = {
      id: 'anchor',
      title: 'Anchor',
      row: 3,
      column: 3,
      rowSpan: 1,
      columnSpan: 1,
      layer: 'content',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    render(<CanvasHarness initialElements={[primary, anchor]} layout={layout} />);

    const tile = screen.getByRole('button', { name: /Primary/ });
    fireEvent.pointerDown(tile, { pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 210, clientY: 210 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    const updated = screen.getByTestId('tile-drag-me');
    expect(updated).toHaveAttribute('data-row', '2');
    expect(updated).toHaveAttribute('data-column', '2');
  });

  it('prevents committing when a collision is detected during drag', () => {
    const layout = createLayout({ rows: 4, columns: 4, rowGap: 0, columnGap: 0 });
    const primary: GridElement = {
      id: 'collider',
      title: 'Collider',
      row: 0,
      column: 0,
      rowSpan: 1,
      columnSpan: 1,
      layer: 'content',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const blocker: GridElement = {
      id: 'blocker',
      title: 'Blocker',
      row: 2,
      column: 2,
      rowSpan: 1,
      columnSpan: 1,
      layer: 'content',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    render(<CanvasHarness initialElements={[primary, blocker]} layout={layout} />);

    const tile = screen.getByRole('button', { name: /Collider/ });
    fireEvent.pointerDown(tile, { pointerId: 7, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 220, clientY: 220 });
    fireEvent.pointerUp(window, { pointerId: 7 });

    const unchanged = screen.getByTestId('tile-collider');
    expect(unchanged).toHaveAttribute('data-row', '0');
    expect(unchanged).toHaveAttribute('data-column', '0');
  });

  it('supports keyboard resizing while clamping to layout bounds', async () => {
    const user = userEvent.setup();
    const layout = createLayout({ rows: 3, columns: 3, rowGap: 0, columnGap: 0 });
    const target: GridElement = {
      id: 'keyboard',
      title: 'Keyboard',
      row: 0,
      column: 0,
      rowSpan: 1,
      columnSpan: 2,
      layer: 'content',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    render(<CanvasHarness initialElements={[target]} layout={layout} />);

    const tile = screen.getByRole('button', { name: /Keyboard/ });
    tile.focus();
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
    // layout has three columns, so span should clamp at 3
    const resized = screen.getByTestId('tile-keyboard');
    expect(resized).toHaveAttribute('data-column-span', '3');
  });
});
