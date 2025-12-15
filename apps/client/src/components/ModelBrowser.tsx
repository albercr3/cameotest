import { useMemo } from 'react';
import type { Diagram, Element } from '@cameotest/shared';
import { ELEMENT_DRAG_MIME } from '../dragTypes';

export interface ModelBrowserNode {
  element: Element;
  children: ModelBrowserNode[];
}

interface ModelBrowserProps {
  tree: ModelBrowserNode[];
  search: string;
  onSearch: (value: string) => void;
  selectedId?: string;
  onSelect: (id: string) => void;
  onCreatePackage: () => void;
  onCreateBlock: () => void;
  onDelete?: () => void;
  onAddToDiagram?: () => void;
  activeDiagram?: Diagram;
  disableActions?: boolean;
  onContextMenu?: (element: Element, clientPosition: { x: number; y: number }) => void;
}

export function ModelBrowser({
  tree,
  search,
  onSearch,
  selectedId,
  onSelect,
  onCreatePackage,
  onCreateBlock,
  onDelete,
  onAddToDiagram,
  activeDiagram,
  disableActions,
  onContextMenu,
}: ModelBrowserProps) {
  const normalizedSearch = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    const filterNodes = (nodes: ModelBrowserNode[]): ModelBrowserNode[] => {
      return nodes
        .map((node) => ({ ...node, children: filterNodes(node.children) }))
        .filter((node) => {
          const matches = node.element.name.toLowerCase().includes(normalizedSearch);
          return matches || node.children.length > 0 || normalizedSearch.length === 0;
        });
    };
    return filterNodes(tree);
  }, [tree, normalizedSearch]);

  const renderNodes = (nodes: ModelBrowserNode[]) => {
    return (
      <ul className="tree">
        {nodes.map((node) => {
          const isSelected = node.element.id === selectedId;
          const handleDragStart = (event: React.DragEvent) => {
            event.dataTransfer.effectAllowed = 'copy';
            event.dataTransfer.setData(
              ELEMENT_DRAG_MIME,
              JSON.stringify({ elementId: node.element.id, elementType: node.element.metaclass }),
            );
          };
          return (
            <li key={node.element.id}>
              <button
                className={`tree__item${isSelected ? ' tree__item--selected' : ''}`}
                onClick={() => onSelect(node.element.id)}
                draggable
                onDragStart={handleDragStart}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onContextMenu?.(node.element, { x: event.clientX, y: event.clientY });
                }}
              >
                <span className="tree__title">{node.element.name}</span>
                <span className="tree__meta">{node.element.metaclass}</span>
              </button>
              {node.children.length > 0 ? renderNodes(node.children) : null}
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className="model-browser">
      <div className="model-browser__actions">
        <button type="button" className="button" onClick={onCreatePackage} disabled={disableActions}>
          New Package
        </button>
        <button type="button" className="button" onClick={onCreateBlock} disabled={disableActions}>
          New Block
        </button>
        <button type="button" className="button button--ghost" onClick={onDelete} disabled={!onDelete || disableActions}>
          Delete
        </button>
        <button
          type="button"
          className="button button--ghost"
          onClick={onAddToDiagram}
          disabled={!onAddToDiagram || !activeDiagram || disableActions}
        >
          Add to diagram
        </button>
      </div>
      <label className="label" htmlFor="model-search">
        Search
      </label>
      <input
        id="model-search"
        type="search"
        value={search}
        onChange={(event) => onSearch(event.target.value)}
        placeholder="Filter by name"
      />
      <div className="tree-container">{renderNodes(filtered)}</div>
    </div>
  );
}
