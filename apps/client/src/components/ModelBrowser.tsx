import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { Diagram, Element } from '@cameotest/shared';
import { ELEMENT_DRAG_MIME } from '../dragTypes';
import { accentForMetaclass } from '../styles/accents';

export interface ModelBrowserNode {
  element: Element;
  children: ModelBrowserNode[];
}

interface ModelBrowserProps {
  tree: ModelBrowserNode[];
  search: string;
  onSearch: (value: string) => void;
  selectedId?: string;
  renamingId?: string;
  renameDraft?: string;
  onRenameChange?: (value: string) => void;
  onRenameSubmit?: (value: string) => void;
  onRenameCancel?: () => void;
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
  renamingId,
  renameDraft,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
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
          const isRenaming = node.element.id === renamingId;
          const accent = accentForMetaclass(node.element.metaclass);
          const accentStyle = { '--accent-color': accent } as CSSProperties;
          const handleDragStart = (event: React.DragEvent) => {
            event.dataTransfer.effectAllowed = 'copy';
            event.dataTransfer.setData(
              ELEMENT_DRAG_MIME,
              JSON.stringify({ elementId: node.element.id, elementType: node.element.metaclass }),
            );
          };
          return (
            <li key={node.element.id}>
              {isRenaming ? (
                <div className={`tree__item${isSelected ? ' tree__item--selected' : ''}`} style={accentStyle}>
                  <span className="tree__accent" aria-hidden="true" />
                  <div className="tree__text">
                    <input
                      className="tree__rename"
                      value={renameDraft ?? ''}
                      onChange={(event) => onRenameChange?.(event.target.value)}
                      onBlur={() => onRenameCancel?.()}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          onRenameSubmit?.(renameDraft ?? '');
                        }
                        if (event.key === 'Escape') {
                          event.preventDefault();
                          onRenameCancel?.();
                        }
                      }}
                      autoFocus
                    />
                    <span className="tree__meta">{node.element.metaclass}</span>
                  </div>
                </div>
              ) : (
                <button
                  className={`tree__item${isSelected ? ' tree__item--selected' : ''}`}
                  style={accentStyle}
                  onClick={() => onSelect(node.element.id)}
                  draggable
                  onDragStart={handleDragStart}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    onContextMenu?.(node.element, { x: event.clientX, y: event.clientY });
                  }}
                >
                  <span className="tree__accent" aria-hidden="true" />
                  <div className="tree__text">
                    <span className="tree__title">{node.element.name}</span>
                    <span className="tree__meta">{node.element.metaclass}</span>
                  </div>
                </button>
              )}
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
