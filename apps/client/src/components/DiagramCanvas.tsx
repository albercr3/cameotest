import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { Diagram, Element, Relationship } from '@cameotest/shared';
import { DraggedElementPayload, ELEMENT_DRAG_MIME } from '../dragTypes';

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
  onDropElement?: (payload: DraggedElementPayload, position: { x: number; y: number }) => void;
  onCanvasContextMenu?: (
    payload: { clientX: number; clientY: number; position: { x: number; y: number } },
  ) => void;
  onPartContextMenu?: (
    payload: { elementId: string; clientX: number; clientY: number; position: { x: number; y: number } },
  ) => void;
  onChange: (diagram: Diagram, options?: { transient?: boolean; historyKey?: string }) => void;
}

const GRID_SIZE = 20;
const IBD_FRAME = { x: 240, y: 140, w: 640, h: 420 } as const;

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
  onDropElement,
  onCanvasContextMenu,
  onPartContextMenu,
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
  const nodeDragKey = useRef<string | null>(null);
  const nodeDragMoved = useRef(false);
  const portDragRef = useRef<
    | { portId: string; historyKey: string; initialPlacement?: { side: 'N' | 'E' | 'S' | 'W'; offset: number } }
    | null
  >(null);
  const portDragMoved = useRef(false);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [draggingPortId, setDraggingPortId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const nodesById = useMemo(() => {
    const map = new Map(diagram.nodes.map((node) => [node.id, node]));
    return map;
  }, [diagram.nodes]);

  const isIbd = (diagram.kind ?? diagram.type) === 'IBD';

  const view = diagram.viewSettings;
  const diagramRef = useRef(diagram);
  const viewRef = useRef(view);

  useEffect(() => {
    diagramRef.current = diagram;
    viewRef.current = diagram.viewSettings;
  }, [diagram]);

  const toDiagramPoint = (
    event: React.PointerEvent | PointerEvent | React.DragEvent | React.MouseEvent,
  ) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    const currentView = viewRef.current;
    const x = (event.clientX - rect.left) / currentView.zoom - currentView.panX;
    const y = (event.clientY - rect.top) / currentView.zoom - currentView.panY;
    return { x, y };
  };

  const updateNodePositions = (
    nodes: { id: string; x: number; y: number }[],
    dx: number,
    dy: number,
    options?: { transient?: boolean; historyKey?: string },
  ) => {
    const snap = viewRef.current.snapEnabled ? GRID_SIZE : 1;
    const baseDiagram = diagramRef.current ?? diagram;
    const nextNodes = baseDiagram.nodes.map((node) => {
      const match = nodes.find((candidate) => candidate.id === node.id);
      if (!match) return node;
      const snappedX = Math.round((match.x + dx) / snap) * snap;
      const snappedY = Math.round((match.y + dy) / snap) * snap;
      let nextX = snappedX;
      let nextY = snappedY;
      const nodeKind = node.kind ?? (node.placement ? 'Port' : 'Element');
      if (isIbd && nodeKind === 'Part') {
        const maxX = IBD_FRAME.x + IBD_FRAME.w - node.w;
        const maxY = IBD_FRAME.y + IBD_FRAME.h - node.h;
        nextX = Math.min(Math.max(nextX, IBD_FRAME.x), maxX);
        nextY = Math.min(Math.max(nextY, IBD_FRAME.y), maxY);
      }
      return { ...node, x: nextX, y: nextY };
    });
    onChange({ ...diagram, nodes: nextNodes }, options);
  };

  const startPan = (event: React.PointerEvent | PointerEvent) => {
    const currentView = viewRef.current;
    panStart.current = { x: event.clientX, y: event.clientY, panX: currentView.panX, panY: currentView.panY };
    const target = svgRef.current;
    target?.setPointerCapture(event.pointerId);
    window.addEventListener('pointermove', handleCanvasPointerMove);
    window.addEventListener('pointerup', handleCanvasPointerUp);
  };

  const handlePointerDown = (event: React.PointerEvent, nodeId: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0) return;

    if (event.altKey || event.ctrlKey || event.metaKey) {
      startPan(event);
      return;
    }

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
    const target = event.currentTarget as SVGGElement | null;
    target?.setPointerCapture(event.pointerId);
    nodeDragKey.current = crypto.randomUUID();
    nodeDragMoved.current = false;
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
    const currentView = viewRef.current;
    const dx = (event.clientX - dragStart.current.x) / currentView.zoom;
    const dy = (event.clientY - dragStart.current.y) / currentView.zoom;
    nodeDragMoved.current = nodeDragMoved.current || dx !== 0 || dy !== 0;
    updateNodePositions(dragStart.current.nodes, dx, dy, {
      transient: true,
      historyKey: nodeDragKey.current ?? undefined,
    });
  };

  const handlePointerUp = () => {
    if (nodeDragMoved.current && nodeDragKey.current) {
      const latestDiagram = diagramRef.current ?? diagram;
      onChange(latestDiagram, { historyKey: nodeDragKey.current });
    }
    nodeDragKey.current = null;
    nodeDragMoved.current = false;
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
      startPan(event);
      return;
    }
    const startPoint = toDiagramPoint(event);
    const target = event.currentTarget;
    target?.setPointerCapture(event.pointerId);
    marqueeStart.current = startPoint;
    setMarquee({ x: startPoint.x, y: startPoint.y, w: 0, h: 0 });
    window.addEventListener('pointermove', handleMarqueePointerMove);
    window.addEventListener('pointerup', handleMarqueePointerUp);
  };

  const handleCanvasPointerMove = (event: PointerEvent) => {
    if (!panStart.current) return;
    const currentView = viewRef.current;
    const currentDiagram = diagramRef.current ?? diagram;
    const dx = (event.clientX - panStart.current.x) / currentView.zoom;
    const dy = (event.clientY - panStart.current.y) / currentView.zoom;
    onChange({
      ...currentDiagram,
      viewSettings: {
        ...currentView,
        panX: panStart.current.panX + dx,
        panY: panStart.current.panY + dy,
      },
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

  const handleDragOver = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes(ELEMENT_DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes(ELEMENT_DRAG_MIME)) return;
    event.preventDefault();
    const payloadText = event.dataTransfer.getData(ELEMENT_DRAG_MIME);
    if (!payloadText) return;
    try {
      const payload = JSON.parse(payloadText) as DraggedElementPayload;
      onDropElement?.(payload, toDiagramPoint(event));
    } catch {
      /* ignore malformed payloads */
    }
  };

  const handleContextMenu = (event: React.MouseEvent<SVGSVGElement>) => {
    if ((event.target as globalThis.Element | null)?.closest('.diagram-node')) return;
    event.preventDefault();
    const position = toDiagramPoint(event);
    onCanvasContextMenu?.({ clientX: event.clientX, clientY: event.clientY, position });
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
    const frame = IBD_FRAME;
    const contextBlock = diagram.contextBlockId ? elements[diagram.contextBlockId] : undefined;
    const findPartNode = (partId: string) =>
      diagram.nodes.find((node) => {
        const nodeKind = node.kind ?? (node.placement ? 'Port' : 'Element');
        return nodeKind === 'Part' && node.elementId === partId;
      });
    const ownerRectForPort = (portElement?: Element) => {
      const owner = portElement?.ownerId ? elements[portElement.ownerId] : undefined;
      if (owner?.metaclass === 'Block' && owner.id === diagram.contextBlockId) {
        return { rect: frame, ownerKind: 'block' as const };
      }
      if (owner?.metaclass === 'Part') {
        const partNode = findPartNode(owner.id);
        if (partNode) {
          return {
            rect: { x: partNode.x, y: partNode.y, w: partNode.w, h: partNode.h },
            ownerKind: 'part' as const,
          };
        }
      }
      return null;
    };
    const placementFromPoint = (
      point: { x: number; y: number },
      rect: { x: number; y: number; w: number; h: number },
    ): { side: 'N' | 'E' | 'S' | 'W'; offset: number } => {
      const distances = [
        { side: 'N' as const, value: Math.abs(point.y - rect.y) },
        { side: 'S' as const, value: Math.abs(point.y - (rect.y + rect.h)) },
        { side: 'W' as const, value: Math.abs(point.x - rect.x) },
        { side: 'E' as const, value: Math.abs(point.x - (rect.x + rect.w)) },
      ];
      const closest = distances.reduce((best, candidate) => (candidate.value < best.value ? candidate : best));
      let offset = 0;
      switch (closest.side) {
        case 'N':
        case 'S':
          offset = (point.x - rect.x) / rect.w;
          break;
        case 'E':
        case 'W':
        default:
          offset = (point.y - rect.y) / rect.h;
          break;
      }
      return { side: closest.side, offset: Math.min(1, Math.max(0, offset)) };
    };
    const portPositions = new Map<string, { x: number; y: number; ownerKind: 'block' | 'part' }>();
    diagram.nodes.forEach((node) => {
      const nodeKind = node.kind ?? (node.placement ? 'Port' : 'Element');
      if (nodeKind !== 'Port') return;
      const element = elements[node.elementId];
      const placement = node.placement ?? { side: 'N', offset: 0.5 };
      const clampedOffset = Math.min(1, Math.max(0, placement.offset));
      const ownerInfo = ownerRectForPort(element);
      if (!ownerInfo) return;
      const { rect, ownerKind } = ownerInfo;
      let x = rect.x;
      let y = rect.y;
      switch (placement.side) {
        case 'N':
          x = rect.x + rect.w * clampedOffset;
          y = rect.y;
          break;
        case 'S':
          x = rect.x + rect.w * clampedOffset;
          y = rect.y + rect.h;
          break;
        case 'E':
          x = rect.x + rect.w;
          y = rect.y + rect.h * clampedOffset;
          break;
        case 'W':
        default:
          x = rect.x;
          y = rect.y + rect.h * clampedOffset;
          break;
      }
      portPositions.set(node.id, { x, y, ownerKind });
    });

    const midpointOfPolyline = (points: { x: number; y: number }[]) => {
      if (points.length < 2) return null;
      const segments = [] as { start: { x: number; y: number }; end: { x: number; y: number }; length: number }[];
      let totalLength = 0;
      for (let i = 0; i < points.length - 1; i += 1) {
        const start = points[i];
        const end = points[i + 1];
        const length = Math.hypot(end.x - start.x, end.y - start.y);
        totalLength += length;
        segments.push({ start, end, length });
      }
      if (totalLength === 0) return points[0];
      const halfway = totalLength / 2;
      let traversed = 0;
      for (const segment of segments) {
        if (traversed + segment.length >= halfway) {
          const remainder = halfway - traversed;
          const ratio = segment.length === 0 ? 0 : remainder / segment.length;
          return {
            x: segment.start.x + (segment.end.x - segment.start.x) * ratio,
            y: segment.start.y + (segment.end.y - segment.start.y) * ratio,
          };
        }
        traversed += segment.length;
      }
      return points[points.length - 1];
    };

    const connectorGeometry = (edge: Diagram['edges'][number]) => {
      const source = portPositions.get(edge.sourceNodeId);
      const target = portPositions.get(edge.targetNodeId);
      if (!source || !target) return null;
      const routedPoints = edge.routingPoints?.map(({ x, y }) => ({ x, y })) ?? [];
      const points = [{ x: source.x, y: source.y }, ...routedPoints, { x: target.x, y: target.y }];
      const pointString = points.map((point) => `${point.x},${point.y}`).join(' ');
      const midpoint = midpointOfPolyline(points);
      return { pointString, midpoint } as const;
    };

    const resetRouting = () => {
      const edges = diagram.edges.map((edge) => ({ ...edge, routingPoints: [] }));
      onChange({ ...diagram, edges });
    };

    const handlePortPointerMove = (event: PointerEvent) => {
      const active = portDragRef.current;
      if (!active) return;
      const node = nodesById.get(active.portId);
      if (!node) return;
      const element = elements[node.elementId];
      const ownerInfo = ownerRectForPort(element);
      if (!ownerInfo) return;
      const placement = placementFromPoint(toDiagramPoint(event), ownerInfo.rect);
      const currentPlacement = node.placement ?? { side: 'N', offset: 0.5 };
      if (currentPlacement.side === placement.side && currentPlacement.offset === placement.offset) return;
      portDragMoved.current = true;
      const nextNodes = diagram.nodes.map((candidate) =>
        candidate.id === active.portId ? { ...candidate, placement } : candidate,
      );
      onChange({ ...diagram, nodes: nextNodes }, { transient: true, historyKey: active.historyKey });
    };

    const handlePortPointerUp = () => {
      if (portDragRef.current) {
        if (portDragMoved.current) {
          const latestDiagram = diagramRef.current ?? diagram;
          onChange(latestDiagram, { historyKey: portDragRef.current.historyKey });
        }
        portDragRef.current = null;
      }
      portDragMoved.current = false;
      setDraggingPortId(null);
      window.removeEventListener('pointermove', handlePortPointerMove);
      window.removeEventListener('pointerup', handlePortPointerUp);
    };

    const handlePortPointerDown = (event: React.PointerEvent, nodeId: string) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.button !== 0) return;
      const node = nodesById.get(nodeId);
      if (!node) return;
      onSelectNodes?.([nodeId]);
      onPortSelect?.(node.elementId, nodeId);
      portDragMoved.current = false;
      portDragRef.current = { portId: nodeId, historyKey: crypto.randomUUID(), initialPlacement: node.placement };
      setDraggingPortId(nodeId);
      const target = event.currentTarget as SVGGElement | null;
      target?.setPointerCapture(event.pointerId);
      window.addEventListener('pointermove', handlePortPointerMove);
      window.addEventListener('pointerup', handlePortPointerUp);
    };

    const handleIbdCanvasPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
      if ((event.target as globalThis.Element | null)?.closest('.diagram-node')) return;
      event.preventDefault();
      onSelectNodes?.([]);
      onSelectElement?.(undefined);
      onSelectRelationship?.(undefined);
      const isPan = event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey;
      if (isPan) {
        startPan(event);
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
          <button type="button" className="button" onClick={resetRouting}>
            Reset Routing
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
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          <svg
            ref={svgRef}
            width="100%"
            height="100%"
            viewBox="0 0 1200 800"
            onContextMenu={handleContextMenu}
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
                const relationship = relationships[edge.relationshipId];
                const label =
                  relationship?.type === 'Connector'
                    ? relationship.itemFlowLabel?.trim() || undefined
                    : undefined;
                const geometry = connectorGeometry(edge);
                if (!geometry) return null;
                const isSelected = selection?.kind === 'relationship' && selection.id === edge.relationshipId;
                const isDangling = !relationship;
                const labelWidth = label ? Math.max(24, label.length * 7 + 8) : 0;
                const labelHeight = label ? 18 : 0;
                return (
                  <g key={edge.id}>
                    <polyline
                      className={`diagram-edge${isSelected ? ' diagram-edge--selected' : ''}${
                        isDangling ? ' diagram-edge--dangling' : ''
                      }`}
                      points={geometry.pointString}
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
                    {label && geometry.midpoint ? (
                      <g
                        className="diagram-edge__label"
                        transform={`translate(${geometry.midpoint.x} ${geometry.midpoint.y})`}
                      >
                        <rect
                          x={-labelWidth / 2}
                          y={-labelHeight / 2}
                          width={labelWidth}
                          height={labelHeight}
                          rx={4}
                          ry={4}
                        />
                        <text x={0} y={0} textAnchor="middle" dominantBaseline="middle">
                          {label}
                        </text>
                      </g>
                    ) : null}
                  </g>
                );
              })}
              {diagram.nodes
                .filter((node) => (node.kind ?? (node.placement ? 'Port' : 'Element')) === 'Part')
                .map((node) => {
                  const element = elements[node.elementId];
                  const typeName = element?.typeId
                    ? elements[element.typeId]?.name ?? 'Unknown type'
                    : 'Unspecified type';
                  const label = `${element?.name ?? 'Missing part'}: ${typeName}`;
                  const missing = !element;
                  const isSelected =
                    selectedNodeIds.includes(node.id) || (selection?.kind === 'element' && element?.id === selection.id);
                  return (
                    <g
                      key={node.id}
                      transform={`translate(${node.x} ${node.y})`}
                      className={`diagram-node diagram-node--part${isSelected ? ' diagram-node--selected' : ''}${
                        missing ? ' diagram-node--missing' : ''
                      }`}
                      onPointerDown={(event) => handlePointerDown(event, node.id)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        const position = toDiagramPoint(event);
                        onPartContextMenu?.({
                          elementId: node.elementId,
                          clientX: event.clientX,
                          clientY: event.clientY,
                          position,
                        });
                      }}
                    >
                      <rect width={node.w} height={node.h} rx={8} ry={8} />
                      <text x={12} y={24} className="diagram-node__title">
                        {label}
                      </text>
                      <text x={12} y={42} className="diagram-node__meta">
                        {typeName}
                      </text>
                    </g>
                  );
                })}
              {diagram.nodes
                .filter((node) => (node.kind ?? (node.placement ? 'Port' : 'Element')) === 'Port')
                .map((node) => {
                  const element = elements[node.elementId];
                  const position = portPositions.get(node.id);
                  if (!position) return null;
                  const owner = element?.ownerId ? elements[element.ownerId] : undefined;
                  const isSelected =
                    selectedNodeIds.includes(node.id) || (selection?.kind === 'element' && element?.id === selection.id);
                  const isPartPort = owner?.metaclass === 'Part';
                  const portClass = `diagram-node diagram-node--port${isSelected ? ' diagram-node--selected' : ''}${
                    isPartPort ? ' diagram-node--part-port' : ' diagram-node--block-port'
                  }`;
                  return (
                    <g
                      key={node.id}
                      className={portClass}
                      onPointerDown={(event) => handlePortPointerDown(event, node.id)}
                      style={{ cursor: draggingPortId === node.id ? 'grabbing' : 'grab' }}
                    >
                      {isPartPort ? (
                        <rect x={position.x - 7} y={position.y - 7} width={14} height={14} rx={3} ry={3} />
                      ) : (
                        <circle cx={position.x} cy={position.y} r={8} />
                      )}
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
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox="0 0 1200 800"
          onContextMenu={handleContextMenu}
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
