import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { Diagram, Element } from '@cameotest/shared';
import { ELEMENT_DRAG_MIME } from '../dragTypes';
import { accentForMetaclass } from '../styles/accents';

const glyphForMetaclass = (metaclass: Element['metaclass'] | string) => {
  switch (metaclass) {
    case 'Package':
      return '📂';
    case 'Block':
      return '▭';
    case 'Part':
      return '◇';
    case 'Port':
      return '◎';
    case 'Requirement':
      return '📝';
    case 'Signal':
      return '📡';
    case 'Diagram':
      return '🗺️';
    case 'InterfaceBlock':
      return '⧉';
    case 'Actor':
      return '👤';
    case 'Enumeration':
      return '≡';
    default:
      return '⬚';
  }
};

export type ModelBrowserNode =
  | { kind: 'element'; element: Element; children: ModelBrowserNode[] }
  | { kind: 'diagram'; diagram: Diagram; children: ModelBrowserNode[] };

interface ModelBrowserProps {
  tree: ModelBrowserNode[];
  search: string;
  onSearch: (value: string) => void;
  selectedId?: string;
  selectedDiagramId?: string;
  renamingId?: string;
  renameDraft?: string;
  onRenameChange?: (value: string) => void;
  onRenameSubmit?: (value: string) => void;
  onRenameCancel?: () => void;
  onSelect: (id: string) => void;
  onSelectDiagram?: (id: string) => void;
  disableActions?: boolean;
  onContextMenu?: (element: Element, clientPosition: { x: number; y: number }) => void;
}

export function ModelBrowser({
  tree,
  search,
  onSearch,
  selectedId,
  selectedDiagramId,
  renamingId,
  renameDraft,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  onSelect,
  onSelectDiagram,
  disableActions,
  onContextMenu,
}: ModelBrowserProps) {
  const normalizedSearch = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    const filterNodes = (nodes: ModelBrowserNode[]): ModelBrowserNode[] => {
      return nodes
        .map((node) => ({ ...node, children: filterNodes(node.children) }))
        .filter((node) => {
          const name = node.kind === 'diagram' ? node.diagram.name : node.element.name;
          const matches = name.toLowerCase().includes(normalizedSearch);
          return matches || node.children.length > 0 || normalizedSearch.length === 0;
        });
    };
    return filterNodes(tree);
  }, [tree, normalizedSearch]);

  const renderNodes = (nodes: ModelBrowserNode[]) => {
    return (
      <ul className="tree">
        {nodes.map((node) => {
          const isElement = node.kind === 'element';
          const nodeId = isElement ? node.element.id : node.diagram.id;
          const isSelected = isElement ? node.element.id === selectedId : node.diagram.id === selectedDiagramId;
          const isRenaming = isElement && node.element.id === renamingId;
          const accent = accentForMetaclass(isElement ? node.element.metaclass : 'Diagram');
          const accentStyle = { '--accent-color': accent } as CSSProperties;
          const glyph = glyphForMetaclass(isElement ? node.element.metaclass : 'Diagram');
          const metaLabel = isElement
            ? node.element.stereotypes?.length
              ? node.element.stereotypes.map((item) => `«${item}»`).join(', ')
              : `<${node.element.metaclass}>`
            : `${node.diagram.kind} diagram`;
          const title = isElement ? node.element.name : node.diagram.name;
          const handleDragStart = (event: React.DragEvent) => {
            if (!isElement) return;
            event.dataTransfer.effectAllowed = 'copy';
            event.dataTransfer.setData(
              ELEMENT_DRAG_MIME,
              JSON.stringify({ elementId: node.element.id, elementType: node.element.metaclass }),
            );
          };
          return (
            <li key={nodeId}>
              {isRenaming ? (
                <div className={`tree__item${isSelected ? ' tree__item--selected' : ''}`} style={accentStyle}>
                  <span className="tree__rail" aria-hidden="true" />
                  <span className="tree__icon" aria-hidden="true">{node.children.length ? '▸' : '•'}</span>
                  <span className="tree__glyph" aria-hidden="true">{glyph}</span>
                  <div className="tree__text">
                    <div className="tree__line">
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
                      <span className="tree__separator" aria-hidden="true">
                        ::
                      </span>
                      <span className="tree__meta">{metaLabel}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <button
                  className={`tree__item${isSelected ? ' tree__item--selected' : ''}`}
                  style={accentStyle}
                  onClick={() => (isElement ? onSelect(node.element.id) : onSelectDiagram?.(node.diagram.id))}
                  draggable={isElement}
                  onDragStart={handleDragStart}
                  onContextMenu={(event) => {
                    if (!isElement) return;
                    event.preventDefault();
                    onContextMenu?.(node.element, { x: event.clientX, y: event.clientY });
                  }}
                >
                  <span className="tree__rail" aria-hidden="true" />
                  <span className="tree__icon" aria-hidden="true">{node.children.length ? '▸' : '•'}</span>
                  <span className="tree__glyph" aria-hidden="true">{glyph}</span>
                  <div className="tree__text">
                    <div className="tree__line">
                      <span className="tree__title">{title}</span>
                      <span className="tree__separator" aria-hidden="true">
                        ::
                      </span>
                      <span className="tree__meta">{metaLabel}</span>
                    </div>
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
      <div className="model-browser__search" role="search">
        <label className="label" htmlFor="model-search">
          Containment search
        </label>
        <div className="model-browser__search-input">
          <span aria-hidden="true">🔍</span>
          <input
            id="model-search"
            type="search"
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Type to filter elements"
            disabled={disableActions}
          />
        </div>
        <div className="model-browser__hint">Right-click anywhere in the tree to create or manage elements.</div>
      </div>
      <div className="tree-container">{renderNodes(filtered)}</div>
    </div>
  );
}
