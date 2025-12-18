import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Diagram, Element } from '@cameotest/shared';
import { DraggedElementPayload, ELEMENT_DRAG_MIME } from '../dragTypes';
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
  onDropOnOwner?: (payload: DraggedElementPayload, ownerId: string | null) => void;
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
  onDropOnOwner,
}: ModelBrowserProps) {
  const normalizedSearch = search.trim().toLowerCase();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const collectIds = (nodes: ModelBrowserNode[], acc: Set<string>) => {
      nodes.forEach((node) => {
        const nodeId = node.kind === 'element' ? node.element.id : node.diagram.id;
        acc.add(nodeId);
        collectIds(node.children, acc);
      });
    };

    const next = new Set(expandedIds);
    collectIds(tree, next);
    if (next.size !== expandedIds.size) {
      setExpandedIds(next);
    }
  }, [expandedIds, tree]);

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

  const visibleCount = useMemo(() => {
    const countNodes = (nodes: ModelBrowserNode[]): number =>
      nodes.reduce((acc, node) => acc + 1 + countNodes(node.children), 0);
    return countNodes(filtered);
  }, [filtered]);

  const highlight = (text: string) => {
    if (!normalizedSearch) return text;
    const index = text.toLowerCase().indexOf(normalizedSearch);
    if (index === -1) return text;
    const before = text.slice(0, index);
    const match = text.slice(index, index + normalizedSearch.length);
    const after = text.slice(index + normalizedSearch.length);
    return (
      <>
        {before}
        <mark className="tree__highlight">{match}</mark>
        {after}
      </>
    );
  };

  const handleDrop = (event: React.DragEvent, ownerId: string | null) => {
    if (!event.dataTransfer.types.includes(ELEMENT_DRAG_MIME)) return;
    event.preventDefault();
    const payloadText = event.dataTransfer.getData(ELEMENT_DRAG_MIME);
    try {
      const payload = JSON.parse(payloadText) as DraggedElementPayload;
      onDropOnOwner?.(payload, ownerId);
    } catch {
      /* ignore malformed payloads */
    }
  };

  const handleDragOver = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes(ELEMENT_DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const renderNodes = (nodes: ModelBrowserNode[]) => {
    return (
      <ul className="tree">
        {nodes.map((node) => {
          const isElement = node.kind === 'element';
          const nodeId = isElement ? node.element.id : node.diagram.id;
          const isSelected = isElement ? node.element.id === selectedId : node.diagram.id === selectedDiagramId;
          const isRenaming = isElement && node.element.id === renamingId;
          const isExpanded = expandedIds.has(nodeId);
          const accent = accentForMetaclass(isElement ? node.element.metaclass : 'Diagram');
          const accentStyle = { '--accent-color': accent } as CSSProperties;
          const glyph = glyphForMetaclass(isElement ? node.element.metaclass : 'Diagram');
          const metaLabel = isElement
            ? node.element.stereotypes?.length
              ? node.element.stereotypes.map((item) => `«${item}»`).join(', ')
              : `<${node.element.metaclass}>`
            : `${node.diagram.kind} diagram`;
          const title = isElement ? node.element.name : node.diagram.name;
          const highlightedTitle = highlight(title);
          const highlightedMeta = highlight(metaLabel);
          const handleDragStart = (event: React.DragEvent) => {
            const payload: DraggedElementPayload = isElement
              ? {
                  elementId: node.element.id,
                  elementType: node.element.metaclass,
                  nodeKind: 'element',
                  source: 'tree',
                }
              : {
                  elementId: node.diagram.id,
                  elementType: 'Diagram',
                  nodeKind: 'diagram',
                  source: 'tree',
                };
            event.dataTransfer.effectAllowed = 'copyMove';
            event.dataTransfer.setData(ELEMENT_DRAG_MIME, JSON.stringify(payload));
          };
          const toggleExpanded = () => {
            if (node.children.length === 0) return;
            setExpandedIds((current) => {
              const next = new Set(current);
              if (next.has(nodeId)) {
                next.delete(nodeId);
              } else {
                next.add(nodeId);
              }
              return next;
            });
          };

          return (
            <li key={nodeId}>
              {isRenaming ? (
                <div className={`tree__item${isSelected ? ' tree__item--selected' : ''}`} style={accentStyle}>
                  <span className="tree__rail" aria-hidden="true" />
                  <button
                    type="button"
                    className="tree__icon"
                    aria-label={isExpanded ? 'Collapse children' : 'Expand children'}
                    onClick={toggleExpanded}
                    disabled={node.children.length === 0}
                  >
                    {node.children.length ? (isExpanded ? '▾' : '▸') : '•'}
                  </button>
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
                  draggable
                  onDragStart={handleDragStart}
                  onDragOver={(event) => handleDragOver(event)}
                  onDrop={(event) => handleDrop(event, isElement ? node.element.id : node.diagram.ownerId ?? null)}
                  onContextMenu={(event) => {
                    if (!isElement) return;
                    event.preventDefault();
                    onContextMenu?.(node.element, { x: event.clientX, y: event.clientY });
                  }}
                >
                  <span className="tree__rail" aria-hidden="true" />
                  <button
                    type="button"
                    className="tree__icon"
                    aria-label={isExpanded ? 'Collapse children' : 'Expand children'}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleExpanded();
                    }}
                    disabled={node.children.length === 0}
                  >
                    {node.children.length ? (isExpanded ? '▾' : '▸') : '•'}
                  </button>
                  <span className="tree__glyph" aria-hidden="true">{glyph}</span>
                  <div className="tree__text">
                    <div className="tree__line">
                      <span className="tree__title">{highlightedTitle}</span>
                      <span className="tree__separator" aria-hidden="true">
                        ::
                      </span>
                      <span className="tree__meta">{highlightedMeta}</span>
                    </div>
                  </div>
                </button>
              )}
              {node.children.length > 0 && isExpanded ? renderNodes(node.children) : null}
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
          {search ? (
            <button
              type="button"
              className="chip-toggle chip-toggle--ghost"
              onClick={() => onSearch('')}
              aria-label="Clear search"
            >
              Clear
            </button>
          ) : null}
        </div>
        <div className="model-browser__hint" aria-live="polite">
          {visibleCount} match{visibleCount === 1 ? '' : 'es'} · Right-click anywhere in the tree to create or manage
          elements.
        </div>
      </div>
      <div
        className="tree-container"
        data-search-active={normalizedSearch.length > 0}
        onDragOver={(event) => handleDragOver(event)}
        onDrop={(event) => handleDrop(event, null)}
      >
        {renderNodes(filtered)}
      </div>
    </div>
  );
}
