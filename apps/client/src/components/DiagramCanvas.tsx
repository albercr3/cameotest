import React, { useMemo, useRef, useState } from 'react';
import type { Diagram, Element } from '@cameotest/shared';

interface DiagramCanvasProps {
  diagram: Diagram;
  elements: Record<string, Element>;
  onChange: (diagram: Diagram) => void;
}

const GRID_SIZE = 20;

export function DiagramCanvas({ diagram, elements, onChange }: DiagramCanvasProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const dragStart = useRef<{ x: number; y: number; nodeX: number; nodeY: number } | null>(null);

  const nodesById = useMemo(() => {
    const map = new Map(diagram.nodes.map((node) => [node.id, node]));
    return map;
  }, [diagram.nodes]);

  const view = diagram.viewSettings;

  const updateNodePosition = (id: string, x: number, y: number) => {
    const snap = view.snapEnabled ? GRID_SIZE : 1;
    const snappedX = Math.round(x / snap) * snap;
    const snappedY = Math.round(y / snap) * snap;
    const nextNodes = diagram.nodes.map((node) => (node.id === id ? { ...node, x: snappedX, y: snappedY } : node));
    onChange({ ...diagram, nodes: nextNodes });
  };

  const handlePointerDown = (event: React.PointerEvent, nodeId: string) => {
    event.preventDefault();
    const node = nodesById.get(nodeId);
    if (!node) return;
    dragStart.current = { x: event.clientX, y: event.clientY, nodeX: node.x, nodeY: node.y };
    setDraggingId(nodeId);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  const handlePointerMove = (event: PointerEvent) => {
    if (!dragStart.current || !draggingId) return;
    const dx = (event.clientX - dragStart.current.x) / view.zoom;
    const dy = (event.clientY - dragStart.current.y) / view.zoom;
    updateNodePosition(draggingId, dragStart.current.nodeX + dx, dragStart.current.nodeY + dy);
  };

  const handlePointerUp = () => {
    setDraggingId(null);
    dragStart.current = null;
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
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

  const pointsForEdge = (sourceId: string, targetId: string, routing: { x: number; y: number }[]) => {
    const source = nodesById.get(sourceId);
    const target = nodesById.get(targetId);
    if (!source || !target) return '';
    const sourcePoint = { x: source.x + source.w / 2, y: source.y + source.h / 2 };
    const targetPoint = { x: target.x + target.w / 2, y: target.y + target.h / 2 };
    return [sourcePoint, ...routing, targetPoint].map((pt) => `${pt.x},${pt.y}`).join(' ');
  };

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
      >
        <svg width="100%" height="100%" viewBox="0 0 1200 800">
          <g transform={`translate(${view.panX} ${view.panY}) scale(${view.zoom})`}>
            {diagram.edges.map((edge) => (
              <polyline
                key={edge.id}
                points={pointsForEdge(edge.sourceNodeId, edge.targetNodeId, edge.routingPoints)}
                fill="none"
                stroke="#4f46e5"
                strokeWidth={2}
                markerEnd="url(#arrow)"
              />
            ))}
            {diagram.nodes.map((node) => {
              const element = elements[node.elementId];
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x} ${node.y})`}
                  className="diagram-node"
                  onPointerDown={(event) => handlePointerDown(event, node.id)}
                >
                  <rect width={node.w} height={node.h} rx={8} ry={8} />
                  <text x={12} y={24} className="diagram-node__title">
                    {element?.name ?? 'Unnamed'}
                  </text>
                  <text x={12} y={42} className="diagram-node__meta">
                    {element?.metaclass ?? ''}
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
