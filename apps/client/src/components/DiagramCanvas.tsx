import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Diagram, Element, Relationship } from '@cameotest/shared';

type Selection = { kind: 'element' | 'relationship'; id: string };

interface DiagramCanvasProps {
  diagram: Diagram;
  elements: Record<string, Element>;
  relationships: Record<string, Relationship>;
  selection?: Selection;
  selectedNodeIds: string[];
  onSelectElement?: (elementId?: string) => void;
  onSelectRelationship?: (relationshipId?: string) => void;
  onSelectNodes?: (nodeIds: string[]) => void;
  connectMode?: boolean;
  onPortSelect?: (portId: string, nodeId: string) => void;
  onChange: (diagram: Diagram) => void;
}

const GRID_SIZE = 20;

export function DiagramCanvas({
  diagram,
  elements,
  relationships,
  selection,
  selectedNodeIds,
  onSelectElement,
  onSelectRelationship,
  onSelectNodes,
  connectMode,
  onPortSelect,
  onChange,
}: DiagramCanvasProps) {
  const dragStart = useRef<
    | {
        x: number;
        y: number;
        nodes: { id: string; x: number; y: number }[];
      }
    | null
  >(null);
  const panStart = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const marqueeStart = useRef<{ x: number; y: number } | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const nodesById = useMemo(() => {
    const map = new Map(diagram.nodes.map((node) => [node.id, node]));
    return map;
  }, [diagram.nodes]);

  const isIbd = (diagram.kind ?? diagram.type) === 'IBD';

  const view = diagram.viewSettings;

  const toDiagramPoint = (event: React.PointerEvent | PointerEvent) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const x = (event.clientX - rect.left) / view.zoom - view.panX;
    const y = (event.clientY - rect.top) / view.zoom - view.panY;
    return { x, y };
  };

  const updateNodePositions = (
    nodes: { id: string; x: number; y: number }[],
    dx: number,
    dy: number,
  ) => {
    const snap = view.snapEnabled ? GRID_SIZE : 1;
    const nextNodes = diagram.nodes.map((node) => {
      const match = nodes.find((candidate) => candidate.id === node.id);
      if (!match) return node;
      const snappedX = Math.round((match.x + dx) / snap) * snap;
      const snappedY = Math.round((match.y + dy) / snap) * snap;
      return { ...node, x: snappedX, y: snappedY };
    });
    onChange({ ...diagram, nodes: nextNodes });
  };

  const handlePointerDown = (event: React.PointerEvent, nodeId: string) => {
    event.preventDefault();
    event.stopPropagation();
    const node = nodesById.get(nodeId);
    if (!node) return;
    const alreadySelected = selectedNodeIds.includes(nodeId);
    const nextSelection = event.shiftKey
      ? alreadySelected
        ? selectedNodeIds.filter((id) => id !== nodeId)
        : [...selectedNodeIds, nodeId]
      : [nodeId];
    onSelectNodes?.(nextSelection);
    if (onSelectElement) {
      onSelectElement(node.elementId);
    }
    dragStart.current = {
      x: event.clientX,
      y: event.clientY,
      nodes: (nextSelection.length > 0 ? nextSelection : [nodeId]).map((id) => {
        const currentNode = nodesById.get(id) ?? node;
        return { id, x: currentNode.x, y: currentNode.y };
      }),
    };
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (!dragStart.current || dragStart.current.nodes.length === 0) return;
    const dx = (event.clientX - dragStart.current.x) / view.zoom;
    const dy = (event.clientY - dragStart.current.y) / view.zoom;
    updateNodePositions(dragStart.current.nodes, dx, dy);
  };

  const handlePointerUp = () => {
    dragStart.current = null;
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
  };

  const handleCanvasPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if ((event.target as globalThis.Element | null)?.closest('.diagram-node')) return;
    event.preventDefault();
    onSelectNodes?.([]);
    onSelectElement?.(undefined);
    onSelectRelationship?.(undefined);
    const isPan = event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey;
    if (isPan) {
      panStart.current = { x: event.clientX, y: event.clientY, panX: view.panX, panY: view.panY };
      window.addEventListener('pointermove', handleCanvasPointerMove);
      window.addEventListener('pointerup', handleCanvasPointerUp);
      return;
    }
    const startPoint = toDiagramPoint(event);
    marqueeStart.current = startPoint;
    setMarquee({ x: startPoint.x, y: startPoint.y, w: 0, h: 0 });
    window.addEventListener('pointermove', handleMarqueePointerMove);
    window.addEventListener('pointerup', handleMarqueePointerUp);
  };

  const handleCanvasPointerMove = (event: PointerEvent) => {
    if (!panStart.current) return;
    const dx = (event.clientX - panStart.current.x) / view.zoom;
    const dy = (event.clientY - panStart.current.y) / view.zoom;
    onChange({
      ...diagram,
      viewSettings: { ...view, panX: panStart.current.panX + dx, panY: panStart.current.panY + dy },
    });
  };

  const handleCanvasPointerUp = () => {
    panStart.current = null;
    window.removeEventListener('pointermove', handleCanvasPointerMove);
    window.removeEventListener('pointerup', handleCanvasPointerUp);
  };

  const handleMarqueePointerMove = (event: PointerEvent) => {
    if (!marqueeStart.current) return;
    const point = toDiagramPoint(event);
    const x = Math.min(point.x, marqueeStart.current.x);
    const y = Math.min(point.y, marqueeStart.current.y);
    const w = Math.abs(point.x - marqueeStart.current.x);
    const h = Math.abs(point.y - marqueeStart.current.y);
    setMarquee({ x, y, w, h });
  };

  const handleMarqueePointerUp = () => {
    if (marquee) {
      const selected = diagram.nodes
        .filter((node) =>
          node.x >= marquee.x &&
          node.y >= marquee.y &&
          node.x + node.w <= marquee.x + marquee.w &&
          node.y + node.h <= marquee.y + marquee.h,
        )
        .map((node) => node.id);
      onSelectNodes?.(selected);
      const firstElement = diagram.nodes.find((node) => selected.includes(node.id))?.elementId;
      if (firstElement && onSelectElement) {
        onSelectElement(firstElement);
      }
    }
    marqueeStart.current = null;
    setMarquee(null);
    window.removeEventListener('pointermove', handleMarqueePointerMove);
    window.removeEventListener('pointerup', handleMarqueePointerUp);
  };

  const toggleView = (key: 'gridEnabled' | 'snapEnabled') => {
    onChange({ ...diagram, viewSettings: { ...view, [key]: !view[key] } });
  };

  const zoomBy = (factor: number) => {
    const nextZoom = Math.min(3, Math.max(0.25, view.zoom * factor));
    onChange({ ...diagram, viewSettings: { ...view, zoom: nextZoom } });
  };

  const panBy = (dx: number, dy: number) => {
    onChange({ ...diagram, viewSettings: { ...view, panX: view.panX + dx, panY: view.panY + dy } });
  };

  const handleWheel = (event: React.WheelEvent) => {
    event.preventDefault();
    const factor = event.deltaY > 0 ? 0.9 : 1.1;
    zoomBy(factor);
  };

  useEffect(() => {
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointermove', handleCanvasPointerMove);
      window.removeEventListener('pointerup', handleCanvasPointerUp);
      window.removeEventListener('pointermove', handleMarqueePointerMove);
      window.removeEventListener('pointerup', handleMarqueePointerUp);
    };
  }, [handleCanvasPointerMove, handleCanvasPointerUp, handleMarqueePointerMove, handleMarqueePointerUp, handlePointerMove, handlePointerUp]);

  const pointsForEdge = (sourceId: string, targetId: string, routing: { x: number; y: number }[]) => {
    const source = nodesById.get(sourceId);
    const target = nodesById.get(targetId);
    if (!source || !target) return '';
    const sourcePoint = { x: source.x + source.w / 2, y: source.y + source.h / 2 };
    const targetPoint = { x: target.x + target.w / 2, y: target.y + target.h / 2 };
    return [sourcePoint, ...routing, targetPoint].map((pt) => `${pt.x},${pt.y}`).join(' ');
  };

  if (isIbd) {
    const frame = { x: 240, y: 140, w: 640, h: 420 };
    const contextBlock = diagram.contextBlockId ? elements[diagram.contextBlockId] : undefined;
    const portPositions = new Map<string, { x: number; y: number }>();
    diagram.nodes.forEach((node) => {
      const placement = node.placement ?? { side: 'N', offset: 0.5 };
      const clampedOffset = Math.min(1, Math.max(0, placement.offset));
      let x = frame.x;
      let y = frame.y;
      switch (placement.side) {
        case 'N':
          x = frame.x + frame.w * clampedOffset;
          y = frame.y;
          break;
        case 'S':
          x = frame.x + frame.w * clampedOffset;
          y = frame.y + frame.h;
          break;
        case 'E':
          x = frame.x + frame.w;
          y = frame.y + frame.h * clampedOffset;
          break;
        case 'W':
        default:
          x = frame.x;
          y = frame.y + frame.h * clampedOffset;
          break;
      }
      portPositions.set(node.id, { x, y });
    });

    const pointsForConnector = (sourceId: string, targetId: string) => {
      const source = portPositions.get(sourceId);
      const target = portPositions.get(targetId);
      if (!source || !target) return '';
      return `${source.x},${source.y} ${target.x},${target.y}`;
    };

    const handlePortPointerDown = (event: React.PointerEvent, nodeId: string) => {
      event.preventDefault();
      event.stopPropagation();
      const node = nodesById.get(nodeId);
      if (!node) return;
      onSelectNodes?.([nodeId]);
      onPortSelect?.(node.elementId, nodeId);
    };

    const handleIbdCanvasPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
      if ((event.target as globalThis.Element | null)?.closest('.diagram-node')) return;
      event.preventDefault();
      onSelectNodes?.([]);
      onSelectElement?.(undefined);
      onSelectRelationship?.(undefined);
      const isPan = event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey;
      if (isPan) {
        panStart.current = { x: event.clientX, y: event.clientY, panX: view.panX, panY: view.panY };
        window.addEventListener('pointermove', handleCanvasPointerMove);
        window.addEventListener('pointerup', handleCanvasPointerUp);
      }
    };

    const frameSelected = selection?.kind === 'element' && selection.id === diagram.contextBlockId;

    return (
      <div className="diagram-shell">
        <div className="diagram-controls">
          <button type="button" className="button" onClick={() => toggleView('gridEnabled')}>
            {view.gridEnabled ? 'Hide Grid' : 'Show Grid'}
          </button>
          <button type="button" className="button" onClick={() => toggleView('snapEnabled')}>
            {view.snapEnabled ? 'Disable Snap' : 'Enable Snap'}
          </button>
          <div className="zoom-group">
            <button type="button" className="button" onClick={() => zoomBy(0.9)}>
              −
            </button>
            <span className="zoom-value">{Math.round(view.zoom * 100)}%</span>
            <button type="button" className="button" onClick={() => zoomBy(1.1)}>
              +
            </button>
          </div>
          <div className="pan-group">
            <button type="button" className="button" onClick={() => panBy(-40, 0)}>
              ←
            </button>
            <button type="button" className="button" onClick={() => panBy(40, 0)}>
              →
            </button>
            <button type="button" className="button" onClick={() => panBy(0, -40)}>
              ↑
            </button>
            <button type="button" className="button" onClick={() => panBy(0, 40)}>
              ↓
            </button>
          </div>
          {connectMode ? <span className="pill">Connect mode: pick two ports</span> : null}
        </div>
        <div
          className={`diagram-canvas${view.gridEnabled ? ' diagram-canvas--grid' : ''}`}
          style={{ backgroundSize: `${GRID_SIZE * view.zoom}px ${GRID_SIZE * view.zoom}px` }}
          onWheel={handleWheel}
        >
          <svg
            ref={svgRef}
            width="100%"
            height="100%"
            viewBox="0 0 1200 800"
            onPointerDown={handleIbdCanvasPointerDown}
          >
            <g transform={`translate(${view.panX} ${view.panY}) scale(${view.zoom})`}>
              <rect
                x={frame.x}
                y={frame.y}
                width={frame.w}
                height={frame.h}
                className={`ibd-frame${frameSelected ? ' diagram-node--selected' : ''}`}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onSelectElement?.(diagram.contextBlockId);
                  onSelectNodes?.([]);
                }}
              />
              <text x={frame.x + 12} y={frame.y + 24} className="diagram-node__title">
                {contextBlock?.name ?? 'Block'}
              </text>
              {diagram.edges.map((edge) => {
                const points = pointsForConnector(edge.sourceNodeId, edge.targetNodeId);
                const relationship = relationships[edge.relationshipId];
                if (!points) return null;
                const isSelected = selection?.kind === 'relationship' && selection.id === edge.relationshipId;
                const isDangling = !relationship;
                return (
                  <polyline
                    key={edge.id}
                    className={`diagram-edge${isSelected ? ' diagram-edge--selected' : ''}${
                      isDangling ? ' diagram-edge--dangling' : ''
                    }`}
                    points={points}
                    fill="none"
                    strokeWidth={2}
                    markerEnd="url(#arrow)"
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      if (relationship && onSelectRelationship) {
                        onSelectRelationship(relationship.id);
                      }
                    }}
                  />
                );
              })}
              {diagram.nodes.map((node) => {
                const element = elements[node.elementId];
                const position = portPositions.get(node.id);
                if (!position) return null;
                const isSelected =
                  selectedNodeIds.includes(node.id) || (selection?.kind === 'element' && element?.id === selection.id);
                return (
                  <g
                    key={node.id}
                    className={`diagram-node diagram-node--port${isSelected ? ' diagram-node--selected' : ''}`}
                    onPointerDown={(event) => handlePortPointerDown(event, node.id)}
                  >
                    <circle cx={position.x} cy={position.y} r={8} />
                    <text x={position.x + 12} y={position.y + 4} className="diagram-node__title">
                      {element?.name ?? 'Port'}
                    </text>
                  </g>
                );
              })}
            </g>
            <defs>
              <marker id="arrow" markerWidth="10" markerHeight="10" refX="6" refY="3" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L0,6 L9,3 z" fill="#4f46e5" />
              </marker>
            </defs>
          </svg>
        </div>
      </div>
    );
  }

  return (
    <div className="diagram-shell">
      <div className="diagram-controls">
        <button type="button" className="button" onClick={() => toggleView('gridEnabled')}>
          {view.gridEnabled ? 'Hide Grid' : 'Show Grid'}
        </button>
        <button type="button" className="button" onClick={() => toggleView('snapEnabled')}>
          {view.snapEnabled ? 'Disable Snap' : 'Enable Snap'}
        </button>
        <div className="zoom-group">
          <button type="button" className="button" onClick={() => zoomBy(0.9)}>
            −
          </button>
          <span className="zoom-value">{Math.round(view.zoom * 100)}%</span>
          <button type="button" className="button" onClick={() => zoomBy(1.1)}>
            +
          </button>
        </div>
        <div className="pan-group">
          <button type="button" className="button" onClick={() => panBy(-40, 0)}>
            ←
          </button>
          <button type="button" className="button" onClick={() => panBy(40, 0)}>
            →
          </button>
          <button type="button" className="button" onClick={() => panBy(0, -40)}>
            ↑
          </button>
          <button type="button" className="button" onClick={() => panBy(0, 40)}>
            ↓
          </button>
        </div>
      </div>
      <div
        className={`diagram-canvas${view.gridEnabled ? ' diagram-canvas--grid' : ''}`}
        style={{ backgroundSize: `${GRID_SIZE * view.zoom}px ${GRID_SIZE * view.zoom}px` }}
        onWheel={handleWheel}
      >
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox="0 0 1200 800"
          onPointerDown={handleCanvasPointerDown}
        >
          <g transform={`translate(${view.panX} ${view.panY}) scale(${view.zoom})`}>
            {diagram.edges.map((edge) => {
              const points = pointsForEdge(edge.sourceNodeId, edge.targetNodeId, edge.routingPoints);
              const relationship = relationships[edge.relationshipId];
              if (!points) return null;
              const isSelected = selection?.kind === 'relationship' && selection.id === edge.relationshipId;
              const isDangling = !relationship;
              return (
                <polyline
                  key={edge.id}
                  className={`diagram-edge${isSelected ? ' diagram-edge--selected' : ''}${
                    isDangling ? ' diagram-edge--dangling' : ''
                  }`}
                  points={points}
                  fill="none"
                  strokeWidth={2}
                  markerEnd="url(#arrow)"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    if (relationship && onSelectRelationship) {
                      onSelectRelationship(relationship.id);
                    }
                  }}
                />
              );
            })}
            {diagram.nodes.map((node) => {
              const element = elements[node.elementId];
              const missing = !element;
              const isSelected = selectedNodeIds.includes(node.id) || (selection?.kind === 'element' && element?.id === selection.id);
              const selectedRelationship =
                selection?.kind === 'relationship' ? relationships[selection.id] : undefined;
              const isRelated =
                !!selectedRelationship &&
                selectedRelationship.type !== 'Connector' &&
                (selectedRelationship.sourceId === node.elementId ||
                  selectedRelationship.targetId === node.elementId);
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x} ${node.y})`}
                  className={`diagram-node${isSelected ? ' diagram-node--selected' : ''}${
                    missing ? ' diagram-node--missing' : ''
                  }${isRelated ? ' diagram-node--related' : ''}`}
                  onPointerDown={(event) => handlePointerDown(event, node.id)}
                >
                  <rect width={node.w} height={node.h} rx={8} ry={8} />
                  <text x={12} y={24} className="diagram-node__title">
                    {element?.name ?? 'Missing element'}
                  </text>
                  <text x={12} y={42} className="diagram-node__meta">
                    {element?.metaclass ?? 'Not found'}
                  </text>
                </g>
              );
            })}
          </g>
          <defs>
            <marker id="arrow" markerWidth="10" markerHeight="10" refX="6" refY="3" orient="auto" markerUnits="strokeWidth">
              <path d="M0,0 L0,6 L9,3 z" fill="#4f46e5" />
            </marker>
          </defs>
          {marquee && (
            <rect
              className="diagram-marquee"
              x={marquee.x * view.zoom + view.panX * view.zoom}
              y={marquee.y * view.zoom + view.panY * view.zoom}
              width={marquee.w * view.zoom}
              height={marquee.h * view.zoom}
            />
          )}
        </svg>
      </div>
    </div>
  );
}
