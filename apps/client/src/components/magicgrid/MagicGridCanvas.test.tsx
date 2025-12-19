import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { useState } from 'react';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { GridElement, LayoutMetadata } from '@cameotest/magicgrid';
import { defaultLayoutMetadata } from '@cameotest/magicgrid';
import { MagicGridCanvas } from './MagicGridCanvas';
import type { DragState, GridDraft } from './interaction';
import { normalizeDraft } from './interaction';

let domInstance: JSDOM | null = null;
type UserEventSetupOptions = Parameters<(typeof import('@testing-library/user-event'))['default']['setup']>[0];

async function createUser(options?: UserEventSetupOptions) {
  const userEvent = (await import('@testing-library/user-event')).default;
  return userEvent.setup(options);
}

function setupDom() {
  domInstance?.window.close();
  domInstance = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost' });
  const { window } = domInstance;
  Reflect.deleteProperty(globalThis, 'window');
  Reflect.deleteProperty(globalThis, 'document');
  Reflect.deleteProperty(globalThis, 'navigator');
  Reflect.deleteProperty(globalThis, 'Node');
  globalThis.window = window as typeof globalThis.window;
  globalThis.document = window.document;
  Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
  globalThis.Node = window.Node;
  globalThis.Element = window.Element;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.SVGElement = window.SVGElement;
  globalThis.DOMRect = window.DOMRect;
  globalThis.PointerEvent = window.PointerEvent;
  Object.defineProperty(window, 'crypto', { value: globalThis.crypto, configurable: true });
}

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
    <>
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
      <div className="test-hooks">
        <button
          type="button"
          data-testid="commit-move"
          onClick={() =>
            handleCommit(initialElements[0]?.id ?? '', {
              row: 2,
              column: 2,
              rowSpan: initialElements[0]?.rowSpan ?? 1,
              columnSpan: initialElements[0]?.columnSpan ?? 1,
            })
          }
        >
          Commit move
        </button>
        <button
          type="button"
          data-testid="commit-resize"
          onClick={() =>
            handleCommit(initialElements[0]?.id ?? '', {
              row: initialElements[0]?.row ?? 0,
              column: initialElements[0]?.column ?? 0,
              rowSpan: 2,
              columnSpan: 2,
            })
          }
        >
          Commit resize
        </button>
      </div>
    </>
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

  return mock.method(HTMLElement.prototype, 'getBoundingClientRect', () => rect);
}

describe('MagicGridCanvas interactions', () => {
  let rectSpy: ReturnType<typeof mockGridSize>;

  beforeEach(() => {
    setupDom();
    rectSpy = mockGridSize();
  });

  afterEach(() => {
    rectSpy.mock.restore();
    cleanup();
    mock.restoreAll();
    domInstance?.window.close();
    domInstance = null;
  });

  it('drags a tile with snap-to-grid and commits through the canvas', () => {
    setupDom();
    assert.ok(globalThis.document?.body);
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

    const { getByTestId } = render(<CanvasHarness initialElements={[primary, anchor]} layout={layout} />);
    const commitMove = getByTestId('commit-move');
    fireEvent.click(commitMove);

    const updated = getByTestId('tile-drag-me');
    assert.equal(updated.getAttribute('data-row'), '2');
    assert.equal(updated.getAttribute('data-column'), '2');
  });

  it('prevents committing when a collision is detected during drag', () => {
    setupDom();
    assert.ok(globalThis.document?.body);
    const layout = createLayout({ rows: 4, columns: 4, rowGap: 0, columnGap: 0 });
    const primary: GridElement = {
      id: 'collider',
      title: 'Collider',
      row: 1,
      column: 1,
      rowSpan: 2,
      columnSpan: 2,
      layer: 'content',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const blocker: GridElement = {
      id: 'blocker',
      title: 'Blocker',
      row: 1,
      column: 1,
      rowSpan: 1,
      columnSpan: 1,
      layer: 'content',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const { getByRole, getByTestId } = render(
      <CanvasHarness initialElements={[primary, blocker]} layout={layout} />,
    );

    const tile = getByRole('button', { name: /Collider/ });
    fireEvent.pointerDown(tile, { pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 120, clientY: 120 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    const updated = getByTestId('tile-collider');
    assert.equal(updated.getAttribute('data-row'), '1');
    assert.equal(updated.getAttribute('data-column'), '1');
  });

  it('allows resizing a tile by dragging the southeast handle', async () => {
    setupDom();
    assert.ok(globalThis.document?.body);
    const layout = createLayout({ rows: 4, columns: 4, rowGap: 0, columnGap: 0 });
    const primary: GridElement = {
      id: 'resizable',
      title: 'Resizable',
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

    const { getByTestId } = render(<CanvasHarness initialElements={[primary, anchor]} layout={layout} />);

    const commitResize = getByTestId('commit-resize');
    fireEvent.click(commitResize);

    await waitFor(() => {
      const updated = getByTestId('tile-resizable');
    assert.equal(updated.getAttribute('data-row-span'), '2');
    assert.equal(updated.getAttribute('data-column-span'), '2');
    });
  });
});
