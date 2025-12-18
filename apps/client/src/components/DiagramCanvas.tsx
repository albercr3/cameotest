import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Diagram, Element, Relationship, ValidationIssue } from '@cameotest/shared';
import { DraggedElementPayload, ELEMENT_DRAG_MIME } from '../dragTypes';
import { accentForMetaclass } from '../styles/accents';

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
  onPortContextMenu?: (payload: { elementId: string; clientX: number; clientY: number }) => void;
  onDropElement?: (payload: DraggedElementPayload, position: { x: number; y: number }) => void;
  onCanvasContextMenu?: (
    payload: { clientX: number; clientY: number; position: { x: number; y: number } },
  ) => void;
  onNodeContextMenu?: (payload: { elementId: string; clientX: number; clientY: number }) => void;
  onPartContextMenu?: (
    payload: { elementId: string; clientX: number; clientY: number; position: { x: number; y: number } },
  ) => void;
  onChange: (diagram: Diagram, options?: { transient?: boolean; historyKey?: string }) => void;
  issues?: ValidationIssue[];
}

const GRID_SIZE = 20;
const VIEWBOX_WIDTH = 1200;
const VIEWBOX_HEIGHT = 800;
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
  onPortContextMenu,
  onDropElement,
  onCanvasContextMenu,
  onNodeContextMenu,
  onPartContextMenu,
  onChange,
  issues,
}: DiagramCanvasProps) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
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
    | {
        portId: string;
        historyKey: string;
        initialPlacement?: { side: 'N' | 'E' | 'S' | 'W'; offset: number };
      }
    | null
  >(null);
  const portDragMoved = useRef(false);
  const cancelPortDragRef = useRef<(pointerId?: number) => void>(() => {});
  const pointerCapture = useRef<{ id: number; target: globalThis.Element | null } | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [draggingPortId, setDraggingPortId] = useState<string | null>(null);
  const [isDropActive, setIsDropActive] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const spacePanActive = useRef(false);

  const nodesById = useMemo(() => {
    const map = new Map(diagram.nodes.map((node) => [node.id, node]));
    return map;
  }, [diagram.nodes]);

  const elementNodeIds = useMemo(() => {
    const map = new Map<string, string[]>();
    diagram.nodes.forEach((node) => {
      const list = map.get(node.elementId) ?? [];
      list.push(node.id);
      map.set(node.elementId, list);
    });
    return map;
  }, [diagram.nodes]);

  const relationshipEdgeIds = useMemo(() => {
    const map = new Map<string, string[]>();
    diagram.edges.forEach((edge) => {
      const list = map.get(edge.relationshipId) ?? [];
      list.push(edge.id);
      map.set(edge.relationshipId, list);
    });
    return map;
  }, [diagram.edges]);

  const issueNodeIds = useMemo(() => {
    const ids = new Set<string>();
    if (!issues) return ids;
    issues.forEach((issue) => {
      if (issue.diagramId && issue.diagramId !== diagram.id) return;
      if (issue.nodeId && nodesById.has(issue.nodeId)) {
        ids.add(issue.nodeId);
      }
      if (issue.elementId) {
        const relatedNodes = elementNodeIds.get(issue.elementId) ?? [];
        relatedNodes.forEach((nodeId) => ids.add(nodeId));
      }
    });
    return ids;
  }, [diagram.id, elementNodeIds, issues, nodesById]);

  const issueEdgeIds = useMemo(() => {
    const ids = new Set<string>();
    if (!issues) return ids;
    issues.forEach((issue) => {
      if (issue.diagramId && issue.diagramId !== diagram.id) return;
      if (issue.edgeId) {
        ids.add(issue.edgeId);
      }
      if (issue.relationshipId) {
        const relatedEdges = relationshipEdgeIds.get(issue.relationshipId) ?? [];
        relatedEdges.forEach((edgeId) => ids.add(edgeId));
      }
    });
    return ids;
  }, [diagram.id, issues, relationshipEdgeIds]);

  const isIbd = (diagram.kind ?? diagram.type) === 'IBD';

  const view = diagram.viewSettings;
  const canvasMenuDisabled = !onCanvasContextMenu;
  const diagramRef = useRef(diagram);
  const viewRef = useRef(view);

  useEffect(() => {
    diagramRef.current = diagram;
    viewRef.current = diagram.viewSettings;
  }, [diagram]);

  const releasePointerCapture = useCallback((pointerId?: number) => {
    const capture = pointerCapture.current;
    const releaseTarget = capture?.target;
    if (releaseTarget && 'releasePointerCapture' in releaseTarget && typeof releaseTarget.releasePointerCapture === 'function') {
      try {
        releaseTarget.releasePointerCapture(pointerId ?? capture.id);
      } catch {
        /* ignore */
      }
    }
    pointerCapture.current = null;
  }, []);

  const clearNodeDrag = () => {
    nodeDragKey.current = null;
    nodeDragMoved.current = false;
    dragStart.current = null;
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
  };

  const clearPan = () => {
    panStart.current = null;
    window.removeEventListener('pointermove', handleCanvasPointerMove);
    window.removeEventListener('pointerup', handleCanvasPointerUp);
  };

  const clearMarquee = () => {
    marqueeStart.current = null;
    setMarquee(null);
    window.removeEventListener('pointermove', handleMarqueePointerMove);
    window.removeEventListener('pointerup', handleMarqueePointerUp);
  };

  const cancelPortDrag = useCallback(
    (pointerId?: number) => {
    portDragRef.current = null;
    portDragMoved.current = false;
    setDraggingPortId(null);
    if (pointerId !== undefined) {
      releasePointerCapture(pointerId);
    } else {
      releasePointerCapture();
    }
    window.removeEventListener('pointermove', handlePortPointerMove);
    window.removeEventListener('pointerup', handlePortPointerUp);
    },
    [releasePointerCapture],
  );

  useEffect(() => {
    const onPointerCancel = (event: PointerEvent) => {
      clearNodeDrag();
      clearPan();
      clearMarquee();
      releasePointerCapture(event.pointerId);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        spacePanActive.current = true;
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        spacePanActive.current = false;
      }
    };
    const onBlur = () => {
      clearNodeDrag();
      clearPan();
      clearMarquee();
      releasePointerCapture();
      spacePanActive.current = false;
    };
    window.addEventListener('pointercancel', onPointerCancel);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('pointercancel', onPointerCancel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  useEffect(() => {
    if (!isIbd) return;
    const onCancel = (event: PointerEvent) => cancelPortDrag(event.pointerId);
    const onBlur = () => cancelPortDrag();
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onBlur);
    };
  }, [cancelPortDrag, isIbd]);

  const getSvgMetrics = () => {
    const rect = svgRef.current?.getBoundingClientRect();
    const safeRect = rect ?? new DOMRect(0, 0, VIEWBOX_WIDTH, VIEWBOX_HEIGHT);
    const scaleX = VIEWBOX_WIDTH / safeRect.width;
    const scaleY = VIEWBOX_HEIGHT / safeRect.height;
    return { rect: safeRect, scaleX, scaleY };
  };

  const toDiagramPoint = (
    event: React.PointerEvent | PointerEvent | React.DragEvent | React.MouseEvent,
  ) => {
    const { rect, scaleX, scaleY } = getSvgMetrics();
    const currentView = viewRef.current;
    const x = ((event.clientX - rect.left) * scaleX) / currentView.zoom - currentView.panX;
    const y = ((event.clientY - rect.top) * scaleY) / currentView.zoom - currentView.panY;
    return { x, y };
  };

  const pointerDeltaToDiagram = (event: PointerEvent, start: { x: number; y: number }) => {
    const { scaleX, scaleY } = getSvgMetrics();
    const currentView = viewRef.current;
    const dx = ((event.clientX - start.x) * scaleX) / currentView.zoom;
    const dy = ((event.clientY - start.y) * scaleY) / currentView.zoom;
    return { dx, dy };
  };

  const ownerRectForPort = useCallback(
    (portElement?: Element) => {
      if (!isIbd) return null;
      const frame = IBD_FRAME;
      const owner = portElement?.ownerId ? elements[portElement.ownerId] : undefined;
      if (owner?.metaclass === 'Block' && owner.id === diagram.contextBlockId) {
        return { rect: frame, ownerKind: 'block' as const };
      }
      if (owner?.metaclass === 'Part') {
        const partNode = diagram.nodes.find((node) => {
          const nodeKind = node.kind ?? (node.placement ? 'Port' : 'Element');
          return nodeKind === 'Part' && node.elementId === owner.id;
        });
        if (partNode) {
          return { rect: { x: partNode.x, y: partNode.y, w: partNode.w, h: partNode.h }, ownerKind: 'part' as const };
        }
      }
      return null;
    },
    [diagram, elements, isIbd],
  );

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
    pointerCapture.current = { id: event.pointerId, target: target ?? null };
    window.addEventListener('pointermove', handleCanvasPointerMove);
    window.addEventListener('pointerup', handleCanvasPointerUp);
  };

  const handlePointerDown = (event: React.PointerEvent, nodeId: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0) return;

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
    pointerCapture.current = { id: event.pointerId, target };
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
    const { dx, dy } = pointerDeltaToDiagram(event, dragStart.current);
    nodeDragMoved.current = nodeDragMoved.current || dx !== 0 || dy !== 0;
    updateNodePositions(dragStart.current.nodes, dx, dy, {
      transient: true,
      historyKey: nodeDragKey.current ?? undefined,
    });
  };

  const handlePointerUp = (event: PointerEvent) => {
    if (nodeDragMoved.current && nodeDragKey.current) {
      const latestDiagram = diagramRef.current ?? diagram;
      onChange(latestDiagram, { historyKey: nodeDragKey.current });
    }
    nodeDragKey.current = null;
    nodeDragMoved.current = false;
    dragStart.current = null;
    releasePointerCapture(event.pointerId);
    window.removeEventListener('pointermove', handlePointerMove);
    window.removeEventListener('pointerup', handlePointerUp);
  };

  const handleCanvasPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if ((event.target as globalThis.Element | null)?.closest('.diagram-node')) return;
    event.preventDefault();
    onSelectNodes?.([]);
    onSelectElement?.(undefined);
    onSelectRelationship?.(undefined);
    const isPan =
      event.button === 1 ||
      event.button !== 0 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      spacePanActive.current;
    if (isPan) {
      startPan(event);
      return;
    }
    const startPoint = toDiagramPoint(event);
    const target = event.currentTarget;
    target?.setPointerCapture(event.pointerId);
    pointerCapture.current = { id: event.pointerId, target };
    marqueeStart.current = startPoint;
    setMarquee({ x: startPoint.x, y: startPoint.y, w: 0, h: 0 });
    window.addEventListener('pointermove', handleMarqueePointerMove);
    window.addEventListener('pointerup', handleMarqueePointerUp);
  };

  const handleCanvasPointerMove = (event: PointerEvent) => {
    if (!panStart.current) return;
    const currentView = viewRef.current;
    const currentDiagram = diagramRef.current ?? diagram;
    const { scaleX, scaleY } = getSvgMetrics();
    const dx = ((event.clientX - panStart.current.x) * scaleX) / currentView.zoom;
    const dy = ((event.clientY - panStart.current.y) * scaleY) / currentView.zoom;
    onChange({
      ...currentDiagram,
      viewSettings: {
        ...currentView,
        panX: panStart.current.panX + dx,
        panY: panStart.current.panY + dy,
      },
    });
  };

  const handleCanvasPointerUp = (event: PointerEvent) => {
    panStart.current = null;
    releasePointerCapture(event.pointerId);
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

  const handleMarqueePointerUp = (event: PointerEvent) => {
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
    releasePointerCapture(event.pointerId);
    window.removeEventListener('pointermove', handleMarqueePointerMove);
    window.removeEventListener('pointerup', handleMarqueePointerUp);
  };
  function handlePortPointerMove(event: PointerEvent) {
    if (!portDragRef.current) return;
    const node = nodesById.get(portDragRef.current.portId);
    if (!node || !isIbd) return;
    const element = elements[node.elementId];
    const ownerInfo = ownerRectForPort(element);
    if (!ownerInfo) return;
    const placement = placementFromPoint(toDiagramPoint(event), ownerInfo.rect);
    const currentPlacement = node.placement ?? { side: 'N', offset: 0.5 };
    if (currentPlacement.side === placement.side && currentPlacement.offset === placement.offset) return;
    portDragMoved.current = true;
    const nextNodes = diagram.nodes.map((candidate) =>
      candidate.id === portDragRef.current?.portId ? { ...candidate, placement } : candidate,
    );
    onChange({ ...diagram, nodes: nextNodes }, { transient: true, historyKey: portDragRef.current.historyKey });
  }

  function handlePortPointerUp(event: PointerEvent) {
    if (portDragMoved.current && portDragRef.current) {
      const { historyKey } = portDragRef.current;
      const latestDiagram = diagramRef.current ?? diagram;
      onChange(latestDiagram, { historyKey });
    }
    cancelPortDrag(event.pointerId);
  }

  const handlePortPointerDown = (event: React.PointerEvent, nodeId: string) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.button !== 0) return;
    const node = nodesById.get(nodeId);
    if (!node) return;
    onSelectNodes?.([nodeId]);
    onPortSelect?.(node.elementId, nodeId);
    portDragMoved.current = false;
    portDragRef.current = {
      portId: nodeId,
      historyKey: crypto.randomUUID(),
      initialPlacement: node.placement,
    };
    setDraggingPortId(nodeId);
    const target = event.currentTarget as SVGGElement | null;
    target?.setPointerCapture(event.pointerId);
    pointerCapture.current = { id: event.pointerId, target };
    window.addEventListener('pointermove', handlePortPointerMove);
    window.addEventListener('pointerup', handlePortPointerUp);
  };

  const toggleView = (key: 'gridEnabled' | 'snapEnabled') => {
    onChange({ ...diagram, viewSettings: { ...view, [key]: !view[key] } });
  };

  const zoomBy = useCallback(
    (factor: number) => {
      const nextZoom = Math.min(3, Math.max(0.25, view.zoom * factor));
      onChange({ ...diagram, viewSettings: { ...view, zoom: nextZoom } });
    },
    [diagram, onChange, view],
  );

  const panBy = (dx: number, dy: number) => {
    onChange({ ...diagram, viewSettings: { ...view, panX: view.panX + dx, panY: view.panY + dy } });
  };

  const handleWheel = useCallback(
    (event: WheelEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const factor = event.deltaY > 0 ? 0.9 : 1.1;
      zoomBy(factor);
    },
    [zoomBy],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const handleDragOver = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes(ELEMENT_DRAG_MIME)) {
      setIsDropActive(false);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsDropActive(true);
  };

  const handleDragLeave = () => setIsDropActive(false);

  const handleDrop = (event: React.DragEvent) => {
    if (!event.dataTransfer.types.includes(ELEMENT_DRAG_MIME)) return;
    event.preventDefault();
    setIsDropActive(false);
    const payloadText = event.dataTransfer.getData(ELEMENT_DRAG_MIME);
    if (!payloadText) return;
    try {
      const payload = JSON.parse(payloadText) as DraggedElementPayload;
      if (payload.nodeKind === 'diagram') return;
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

  const openCanvasMenu = () => {
    if (!onCanvasContextMenu) return;
    const { rect, scaleX, scaleY } = getSvgMetrics();
    const currentView = viewRef.current;
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const x = ((clientX - rect.left) * scaleX) / currentView.zoom - currentView.panX;
    const y = ((clientY - rect.top) * scaleY) / currentView.zoom - currentView.panY;
    onCanvasContextMenu({ clientX, clientY, position: { x, y } });
  };

  useEffect(() => {
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointermove', handleCanvasPointerMove);
      window.removeEventListener('pointerup', handleCanvasPointerUp);
      window.removeEventListener('pointermove', handleMarqueePointerMove);
      window.removeEventListener('pointerup', handleMarqueePointerUp);
      window.removeEventListener('pointermove', handlePortPointerMove);
      window.removeEventListener('pointerup', handlePortPointerUp);
    };
  }, []);

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

    const handleIbdCanvasPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
      if ((event.target as globalThis.Element | null)?.closest('.diagram-node')) return;
      event.preventDefault();
      onSelectNodes?.([]);
      onSelectElement?.(undefined);
      onSelectRelationship?.(undefined);
      const isPan =
        event.button === 1 ||
        event.button !== 0 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        spacePanActive.current;
      if (isPan) {
        startPan(event);
        return;
      }
      const startPoint = toDiagramPoint(event);
      const target = event.currentTarget;
      target?.setPointerCapture(event.pointerId);
      pointerCapture.current = { id: event.pointerId, target };
      marqueeStart.current = startPoint;
      setMarquee({ x: startPoint.x, y: startPoint.y, w: 0, h: 0 });
      window.addEventListener('pointermove', handleMarqueePointerMove);
      window.addEventListener('pointerup', handleMarqueePointerUp);
    };

    const frameSelected = selection?.kind === 'element' && selection.id === diagram.contextBlockId;

    return (
      <div className="diagram-shell">
        <div className="diagram-controls">
          <div className="zoom-group">
            <button type="button" className="button" onClick={() => zoomBy(0.9)}>
              −
            </button>
            <span className="zoom-value">{Math.round(view.zoom * 100)}%</span>
            <button type="button" className="button" onClick={() => zoomBy(1.1)}>
              +
            </button>
          </div>
          <button type="button" className="button button--ghost" onClick={openCanvasMenu} disabled={canvasMenuDisabled}>
            Canvas menu ▾
          </button>
          {connectMode ? <span className="pill">Connect mode: pick two ports</span> : null}
        </div>
        <div
          className={`diagram-canvas${view.gridEnabled ? ' diagram-canvas--grid' : ''}${
            isDropActive ? ' diagram-canvas--dropping' : ''
          }${connectMode ? ' diagram-canvas--connect' : ''}`}
          style={{ backgroundSize: `${GRID_SIZE * view.zoom}px ${GRID_SIZE * view.zoom}px` }}
          ref={canvasRef}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
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
                    if (event.button === 0 && !event.shiftKey) {
                      startPan(event);
                    }
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
                  const accent = accentForMetaclass(element?.metaclass ?? 'Part');
                  const accentStyle = { '--node-accent': accent } as React.CSSProperties;
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
                      style={accentStyle}
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
                      <rect className="diagram-node__accent" width={node.w} height={6} rx={6} ry={6} />
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
                  const accent = accentForMetaclass(element?.metaclass ?? 'Port');
                  const owner = element?.ownerId ? elements[element.ownerId] : undefined;
                  const isSelected =
                    selectedNodeIds.includes(node.id) || (selection?.kind === 'element' && element?.id === selection.id);
                  const isPartPort = owner?.metaclass === 'Part';
                  const hasIssue = issueNodeIds.has(node.id);
                  const portClass = `diagram-node diagram-node--port${isSelected ? ' diagram-node--selected' : ''}${
                    isPartPort ? ' diagram-node--part-port' : ' diagram-node--block-port'
                  }${hasIssue ? ' diagram-node--invalid' : ''}`;
                  const portStyle = {
                    '--node-accent': accent,
                    cursor: draggingPortId === node.id ? 'grabbing' : 'grab',
                  } as React.CSSProperties;
                  return (
                  <g
                    key={node.id}
                    className={portClass}
                    onPointerDown={(event) => handlePortPointerDown(event, node.id)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      onPortContextMenu?.({ elementId: node.elementId, clientX: event.clientX, clientY: event.clientY });
                    }}
                    style={portStyle}
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
        <div className="zoom-group">
          <button type="button" className="button" onClick={() => zoomBy(0.9)}>
            −
          </button>
          <span className="zoom-value">{Math.round(view.zoom * 100)}%</span>
          <button type="button" className="button" onClick={() => zoomBy(1.1)}>
            +
          </button>
        </div>
        <button type="button" className="button button--ghost" onClick={openCanvasMenu} disabled={canvasMenuDisabled}>
          Canvas menu ▾
        </button>
      </div>
        <div
          className={`diagram-canvas${view.gridEnabled ? ' diagram-canvas--grid' : ''}${
            isDropActive ? ' diagram-canvas--dropping' : ''
          }`}
          style={{ backgroundSize: `${GRID_SIZE * view.zoom}px ${GRID_SIZE * view.zoom}px` }}
          ref={canvasRef}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
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
              const hasIssue = issueEdgeIds.has(edge.id);
              return (
                <polyline
                  key={edge.id}
                  className={`diagram-edge${isSelected ? ' diagram-edge--selected' : ''}${
                    isDangling ? ' diagram-edge--dangling' : ''
                  }${hasIssue ? ' diagram-edge--invalid' : ''}`}
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
              const accent = accentForMetaclass(element?.metaclass);
              const accentStyle = { '--node-accent': accent } as React.CSSProperties;
              const missing = !element;
              const metaclassClass = element?.metaclass
                ? ` diagram-node--${element.metaclass.toLowerCase()}`
                : '';
              const isSelected = selectedNodeIds.includes(node.id) || (selection?.kind === 'element' && element?.id === selection.id);
              const selectedRelationship =
                selection?.kind === 'relationship' ? relationships[selection.id] : undefined;
              const isRelated =
                !!selectedRelationship &&
                selectedRelationship.type !== 'Connector' &&
                (selectedRelationship.sourceId === node.elementId ||
                  selectedRelationship.targetId === node.elementId);
              const hasIssue = issueNodeIds.has(node.id);
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x} ${node.y})`}
                  className={`diagram-node${isSelected ? ' diagram-node--selected' : ''}${
                    missing ? ' diagram-node--missing' : ''
                  }${isRelated ? ' diagram-node--related' : ''}${metaclassClass}${hasIssue ? ' diagram-node--invalid' : ''}`}
                  style={accentStyle}
                  onPointerDown={(event) => handlePointerDown(event, node.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    onNodeContextMenu?.({ elementId: node.elementId, clientX: event.clientX, clientY: event.clientY });
                  }}
                >
                  <rect width={node.w} height={node.h} rx={8} ry={8} />
                  <rect className="diagram-node__accent" width={node.w} height={6} rx={6} ry={6} />
                  <text x={12} y={24} className="diagram-node__title">
                    {element?.name ?? 'Missing element'}
                  </text>
                  <text x={12} y={42} className="diagram-node__meta">
                    {element?.metaclass ?? 'Not found'}
                  </text>
                </g>
              );
            })}
            {marquee ? (
              <rect
                className="diagram-marquee"
                x={marquee.x}
                y={marquee.y}
                width={marquee.w}
                height={marquee.h}
              />
            ) : null}
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
