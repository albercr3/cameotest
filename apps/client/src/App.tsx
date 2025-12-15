import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Diagram,
  DiagramsFile,
  Element,
  ModelFile,
  Relationship,
  WorkspaceFiles,
  WorkspaceManifest,
} from '@cameotest/shared';
import { IR_VERSION, metaclassSchema, relationshipTypeSchema } from '@cameotest/shared';
import { Panel } from './components/Panel';
import { Toolbar } from './components/Toolbar';
import { ModelBrowser, ModelBrowserNode } from './components/ModelBrowser';
import { PropertiesPanel } from './components/PropertiesPanel';
import { DiagramCanvas } from './components/DiagramCanvas';
import { DiagramTabs } from './components/DiagramTabs';

interface WorkspacePayload {
  manifest: WorkspaceManifest;
  model: ModelFile;
  diagrams: DiagramsFile;
}

type Selection = { kind: 'element'; id: string } | { kind: 'relationship'; id: string };

type HistoryEntry = {
  payload: WorkspacePayload;
  selection?: Selection;
  selectedNodeIds: string[];
  activeDiagramId?: string;
};

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  return parseResponse<T>(response);
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return parseResponse<T>(response);
}

async function parseResponse<T>(response: Response): Promise<T> {
  let payload: any = null;
  try {
    payload = await response.json();
  } catch (error) {
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }
    throw error as Error;
  }
  if (!response.ok) {
    const message = payload?.message ?? `Request failed with status ${response.status}`;
    const details = payload?.details;
    const combined = details ? `${message}: ${details}` : message;
    throw new Error(combined);
  }
  return payload as T;
}

const metaclasses = metaclassSchema.options;
const relationshipTypes = relationshipTypeSchema.options;
const HISTORY_LIMIT = 30;
const AUTOSAVE_DELAY = 1500;

export default function App() {
  const [workspaces, setWorkspaces] = useState<WorkspaceManifest[]>([]);
  const [activeId, setActiveId] = useState<string | undefined>();
  const [payload, setPayload] = useState<WorkspacePayload | null>(null);
  const [status, setStatus] = useState('Fetching workspace list...');
  const [selection, setSelection] = useState<Selection | undefined>();
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [activeDiagramId, setActiveDiagramId] = useState<string | undefined>();
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(false);
  const [importing, setImporting] = useState(false);
  const [banner, setBanner] = useState<{ kind: 'error' | 'info'; messages: string[] } | null>(null);
  const [autosaveEnabled, setAutosaveEnabled] = useState(true);
  const [autosaveError, setAutosaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  const addOffset = useRef(0);
  const pasteOffset = useRef(0);
  const clipboardNodesRef = useRef<Diagram['nodes']>([]);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const selectElement = (id?: string) => setSelection(id ? { kind: 'element', id } : undefined);
  const selectRelationship = (id?: string) => setSelection(id ? { kind: 'relationship', id } : undefined);

  const recordHistory = useCallback(
    (current: WorkspacePayload) => {
      setHistory((prev) => {
        const next = [...prev, { payload: current, selection, selectedNodeIds, activeDiagramId }];
        return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
      });
    },
    [activeDiagramId, selectedNodeIds, selection],
  );

  const applyChange = useCallback(
    (mutator: (current: WorkspacePayload) => WorkspacePayload) => {
      setPayload((current) => {
        if (!current) return current;
        const next = mutator(current);
        if (next === current) return current;
        recordHistory(current);
        setRedoStack([]);
        setDirty(true);
        setAutosaveError(null);
        return next;
      });
    },
    [recordHistory],
  );

  const refreshWorkspaces = useCallback(() => {
    setLoadingWorkspaces(true);
    getJson<WorkspaceManifest[]>('/api/workspaces')
      .then((list) => {
        setWorkspaces(list);
        setActiveId((current) => (current && list.some((workspace) => workspace.id === current) ? current : undefined));
        setStatus('Ready');
      })
      .catch((error) => {
        console.error(error);
        setBanner({ kind: 'error', messages: [error.message] });
        setStatus('Unable to load workspaces');
      })
      .finally(() => setLoadingWorkspaces(false));
  }, []);

  useEffect(() => {
    refreshWorkspaces();
  }, [refreshWorkspaces]);

  useEffect(() => {
    if (!activeId) {
      setPayload(null);
      setSelection(undefined);
      setSelectedNodeIds([]);
      setActiveDiagramId(undefined);
      setDirty(false);
      setHistory([]);
      setRedoStack([]);
      setLastSavedAt(null);
      return;
    }
    setStatus(`Opening workspace “${activeId}”...`);
    setBanner(null);
    postJson(`/api/workspaces/${activeId}/open`)
      .then(() => getJson<WorkspacePayload>('/api/workspaces/current/load'))
      .then((data) => {
        setPayload(data);
        setHistory([]);
        setRedoStack([]);
        setDirty(false);
        setLastSavedAt(data.manifest.updatedAt ?? null);
        setAutosaveError(null);
        const firstElement = data.model.elements[0]?.id;
        setSelection(firstElement ? { kind: 'element', id: firstElement } : undefined);
        const firstDiagramNode = data.diagrams.diagrams[0]?.nodes[0];
        setSelectedNodeIds(firstDiagramNode ? [firstDiagramNode.id] : []);
        setActiveDiagramId(data.diagrams.diagrams[0]?.id);
        setStatus('Ready');
      })
      .catch((error) => {
        console.error(error);
        setBanner({ kind: 'error', messages: [error.message] });
        setStatus('Workspace not available');
      });
  }, [activeId]);

  const tree = useMemo<ModelBrowserNode[]>(() => {
    if (!payload) return [];
    const nodes = new Map<string, ModelBrowserNode>();
    payload.model.elements.forEach((element) => {
      nodes.set(element.id, { element, children: [] });
    });
    const roots: ModelBrowserNode[] = [];
    nodes.forEach((node) => {
      if (node.element.ownerId) {
        const parent = nodes.get(node.element.ownerId);
        if (parent) {
          parent.children.push(node);
        } else {
          roots.push(node);
        }
      } else {
        roots.push(node);
      }
    });
    return roots;
  }, [payload]);

  const selectedElement = useMemo(() => {
    if (!payload || !selection || selection.kind !== 'element') return undefined;
    return payload.model.elements.find((el) => el.id === selection.id);
  }, [payload, selection]);

  const selectedRelationship = useMemo(() => {
    if (!payload || !selection || selection.kind !== 'relationship') return undefined;
    return payload.model.relationships.find((rel) => rel.id === selection.id);
  }, [payload, selection]);

  const activeDiagram: Diagram | undefined = useMemo(() => {
    if (!payload || !activeDiagramId) return undefined;
    return payload.diagrams.diagrams.find((diagram) => diagram.id === activeDiagramId);
  }, [activeDiagramId, payload]);

  useEffect(() => {
    if (!activeDiagram || !selection || selection.kind !== 'element') return;
    const selectedInDiagram = activeDiagram.nodes.some((node) => node.elementId === selection.id);
    if (!selectedInDiagram && activeDiagram.nodes.length > 0) {
      setSelection((current) => current ?? { kind: 'element', id: activeDiagram.nodes[0].elementId });
    }
  }, [activeDiagram, selection]);

  const elementsById = useMemo(() => {
    if (!payload) return {} as Record<string, Element>;
    return payload.model.elements.reduce<Record<string, Element>>((acc, element) => {
      acc[element.id] = element;
      return acc;
    }, {});
  }, [payload]);

  const relationshipsById = useMemo(() => {
    if (!payload) return {} as Record<string, Relationship>;
    return payload.model.relationships.reduce<Record<string, Relationship>>((acc, rel) => {
      acc[rel.id] = rel;
      return acc;
    }, {});
  }, [payload]);

  useEffect(() => {
    if (!payload) return;
    if (selection?.kind === 'element' && !elementsById[selection.id]) {
      selectElement(payload.model.elements[0]?.id);
    }
    if (selection?.kind === 'relationship' && !relationshipsById[selection.id]) {
      selectElement(payload.model.elements[0]?.id);
    }
  }, [elementsById, payload, relationshipsById, selection]);

  useEffect(() => {
    if (!activeDiagram) {
      setSelectedNodeIds([]);
      return;
    }
    setSelectedNodeIds((current) => current.filter((id) => activeDiagram.nodes.some((node) => node.id === id)));
  }, [activeDiagram]);

  useEffect(() => {
    if (!activeDiagram) return;
    if (selection?.kind !== 'element') {
      setSelectedNodeIds([]);
      return;
    }
    const alreadyIncludes = activeDiagram.nodes.some(
      (node) => selectedNodeIds.includes(node.id) && node.elementId === selection.id,
    );
    if (!alreadyIncludes) {
      const node = activeDiagram.nodes.find((candidate) => candidate.elementId === selection.id);
      if (node) {
        setSelectedNodeIds([node.id]);
      }
    }
  }, [activeDiagram, selectedNodeIds, selection]);

  const summary = useMemo(() => {
    if (!payload) {
      return {
        elements: 0,
        relationships: 0,
        diagrams: 0,
      };
    }
    return {
      elements: payload.model.elements.length,
      relationships: payload.model.relationships.length,
      diagrams: payload.diagrams.diagrams.length,
    };
  }, [payload]);

  const selectedElementId = selection?.kind === 'element' ? selection.id : undefined;
  const selectedRelationshipId = selection?.kind === 'relationship' ? selection.id : undefined;
  const propertiesSubtitle =
    selectedElement?.name ??
    (selectedRelationship ? `${selectedRelationship.type} relationship` : 'Select an element to edit');

  const relatedRelationships = useMemo(() => {
    if (!payload || !selectedElement) return [] as Relationship[];
    return payload.model.relationships.filter(
      (rel) => rel.sourceId === selectedElement.id || rel.targetId === selectedElement.id,
    );
  }, [payload, selectedElement]);

  const updateElement = (id: string, updates: Partial<Element>) => {
    applyChange((current) => {
      const elements = current.model.elements.map((element) =>
        element.id === id ? { ...element, ...updates, updatedAt: new Date().toISOString() } : element,
      );
      return {
        ...current,
        manifest: { ...current.manifest, updatedAt: new Date().toISOString() },
        model: { ...current.model, elements },
      };
    });
  };

  const updateDiagram = (diagramId: string, next: Diagram) => {
    applyChange((current) => {
      const diagrams = current.diagrams.diagrams.map((diagram) => (diagram.id === diagramId ? next : diagram));
      return {
        ...current,
        manifest: { ...current.manifest, updatedAt: new Date().toISOString() },
        diagrams: { diagrams },
      };
    });
  };

  const selectContainerId = (candidateId?: string) => {
    if (!candidateId) return null;
    let current: Element | null | undefined = elementsById[candidateId];
    while (current && current.metaclass !== 'Package') {
      current = current.ownerId ? elementsById[current.ownerId] ?? null : null;
    }
    return current?.id ?? null;
  };

  const dedupeName = (base: string, ownerId: string | null) => {
    if (!payload) return base;
    const siblings = payload.model.elements.filter((el) => el.ownerId === ownerId);
    if (!siblings.some((el) => el.name === base)) return base;
    let suffix = 2;
    let next = `${base}${suffix}`;
    while (siblings.some((el) => el.name === next)) {
      suffix += 1;
      next = `${base}${suffix}`;
    }
    return next;
  };

  const dedupeWorkspaceName = useCallback(
    (base: string) => {
      let suffix = 2;
      let next = base;
      while (workspaces.some((workspace) => workspace.name === next)) {
        next = `${base} ${suffix}`;
        suffix += 1;
      }
      return next;
    },
    [workspaces],
  );

  const createWorkspace = async () => {
    try {
      setStatus('Creating workspace...');
      const { id } = await postJson<{ id: string }>('/api/workspaces/current/new-id');
      const now = new Date().toISOString();
      const manifest: WorkspaceManifest = {
        id,
        name: dedupeWorkspaceName('New Workspace'),
        description: 'Empty workspace',
        createdAt: now,
        updatedAt: now,
      };
      await postJson<WorkspaceManifest>('/api/workspaces', manifest);
      await refreshWorkspaces();
      setActiveId(manifest.id);
      setBanner(null);
      setStatus('Ready');
    } catch (error) {
      console.error(error);
      setBanner({ kind: 'error', messages: [error instanceof Error ? error.message : String(error)] });
      setStatus('Unable to create workspace');
    }
  };

  const handleImportWorkspace = async (file: File) => {
    setImporting(true);
    try {
      setStatus('Importing workspace...');
      const text = await file.text();
      const parsed = JSON.parse(text);
      const response = await postJson<{ manifest: WorkspaceManifest }>(
        '/api/workspaces/import',
        { workspace: parsed },
      );
      await refreshWorkspaces();
      setActiveId(response.manifest.id);
      setBanner(null);
      setStatus('Ready');
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      setBanner({ kind: 'error', messages: ['Import failed', message] });
      setStatus('Import failed');
    } finally {
      setImporting(false);
    }
  };

  const handleExportWorkspace = async () => {
    if (!payload) return;
    try {
      setStatus('Exporting workspace...');
      const workspace = await getJson<WorkspaceFiles>('/api/workspaces/current/export');
      const blob = new Blob([JSON.stringify(workspace, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${workspace.manifest.id}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setStatus('Ready');
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      setBanner({ kind: 'error', messages: ['Export failed', message] });
      setStatus('Export failed');
    }
  };

  const createElement = (metaclass: 'Package' | 'Block') => {
    if (!payload) return;
    const now = new Date().toISOString();
    const ownerId = selectContainerId(selection?.kind === 'element' ? selection.id : undefined);
    const baseName = metaclass === 'Package' ? 'NewPackage' : 'NewBlock';
    const name = dedupeName(baseName, ownerId);
    const element: Element = {
      id: crypto.randomUUID(),
      metaclass,
      name,
      ownerId,
      documentation: '',
      stereotypes: [],
      tags: {},
      createdAt: now,
      updatedAt: now,
    };
    applyChange((current) => ({
      ...current,
      manifest: { ...current.manifest, updatedAt: now },
      model: { ...current.model, elements: [...current.model.elements, element] },
    }));
    selectElement(element.id);
  };

  const deleteElement = (id: string) => {
    if (!payload) return;
    const toDelete = new Set<string>();
    const collect = (targetId: string) => {
      toDelete.add(targetId);
      payload.model.elements
        .filter((el) => el.ownerId === targetId)
        .forEach((child) => collect(child.id));
    };
    collect(id);

    const parentId = elementsById[id]?.ownerId ?? null;
    const remainingElements = payload.model.elements.filter((el) => !toDelete.has(el.id));
    const removedRelationshipIds = new Set(
      payload.model.relationships
        .filter((rel) => toDelete.has(rel.sourceId) || toDelete.has(rel.targetId))
        .map((rel) => rel.id),
    );
    const remainingRelationships = payload.model.relationships.filter(
      (rel) => !removedRelationshipIds.has(rel.id),
    );

    const updatedDiagrams = payload.diagrams.diagrams.map((diagram) => {
      const remainingNodes = diagram.nodes.filter((node) => !toDelete.has(node.elementId));
      const remainingNodeIds = new Set(remainingNodes.map((node) => node.id));
      const remainingEdges = diagram.edges.filter(
        (edge) =>
          remainingNodeIds.has(edge.sourceNodeId) &&
          remainingNodeIds.has(edge.targetNodeId) &&
          !removedRelationshipIds.has(edge.relationshipId),
      );
      return { ...diagram, nodes: remainingNodes, edges: remainingEdges };
    });

    applyChange((current) => ({
      ...current,
      manifest: { ...current.manifest, updatedAt: new Date().toISOString() },
      model: { ...current.model, elements: remainingElements, relationships: remainingRelationships },
      diagrams: { diagrams: updatedDiagrams },
    }));

    if (selection?.kind === 'element' && toDelete.has(selection.id)) {
      selectElement(parentId ?? undefined);
    }
    if (selection?.kind === 'relationship' && removedRelationshipIds.has(selection.id)) {
      selectRelationship(undefined);
    }
    setSelectedNodeIds((current) => current.filter((nodeId) => !toDelete.has(nodeId)));
  };

  const ensureNodeInDiagram = (diagram: Diagram, elementId: string) => {
    const existing = diagram.nodes.find((node) => node.elementId === elementId);
    if (existing) {
      return { diagram, nodeId: existing.id };
    }
    const view = diagram.viewSettings;
    const offset = (addOffset.current % 5) * 24;
    addOffset.current += 1;
    const node = {
      id: crypto.randomUUID(),
      elementId,
      x: view.panX + 400 + offset,
      y: view.panY + 240 + offset,
      w: 180,
      h: 100,
      compartments: { collapsed: false, showParts: true, showPorts: true },
      style: { highlight: false },
    } as Diagram['nodes'][number];
    return { diagram: { ...diagram, nodes: [...diagram.nodes, node] }, nodeId: node.id };
  };

  const addToDiagram = (elementId: string, options?: { select?: boolean }) => {
    if (!payload || !activeDiagram) return;
    const result = ensureNodeInDiagram(activeDiagram, elementId);
    if (result.diagram !== activeDiagram) {
      updateDiagram(activeDiagram.id, result.diagram);
    }
    if (options?.select !== false) {
      selectElement(elementId);
      setSelectedNodeIds([result.nodeId]);
    }
    return result.nodeId;
  };

  const createRelationship = (type: Relationship['type'], sourceId: string, targetId: string) => {
    if (!payload) return;
    const now = new Date().toISOString();
    const relationship: Relationship = {
      id: crypto.randomUUID(),
      type,
      sourceId,
      targetId,
      properties: {},
    };

    applyChange((current) => {
      const diagrams = current.diagrams.diagrams.map((diagram) => {
        if (!activeDiagramId || diagram.id !== activeDiagramId) return diagram;
        let nextDiagram = diagram;
        const sourceResult = ensureNodeInDiagram(nextDiagram, sourceId);
        nextDiagram = sourceResult.diagram;
        const targetResult = ensureNodeInDiagram(nextDiagram, targetId);
        nextDiagram = targetResult.diagram;
        const hasEdge = nextDiagram.edges.some((edge) => edge.relationshipId === relationship.id);
        if (hasEdge) return nextDiagram;
        const edge = {
          id: crypto.randomUUID(),
          relationshipId: relationship.id,
          sourceNodeId: sourceResult.nodeId,
          targetNodeId: targetResult.nodeId,
          routingPoints: [],
          label: type,
        } as Diagram['edges'][number];
        return { ...nextDiagram, edges: [...nextDiagram.edges, edge] };
      });

      return {
        ...current,
        manifest: { ...current.manifest, updatedAt: now },
        model: { ...current.model, relationships: [...current.model.relationships, relationship] },
        diagrams: { diagrams },
      };
    });

    selectRelationship(relationship.id);
  };

  const updateRelationship = (id: string, updates: Partial<Relationship>) => {
    applyChange((current) => {
      const relationships = current.model.relationships.map((rel) =>
        rel.id === id ? { ...rel, ...updates } : rel,
      );
      return {
        ...current,
        manifest: { ...current.manifest, updatedAt: new Date().toISOString() },
        model: { ...current.model, relationships },
      };
    });
  };

  const deleteRelationship = (id: string) => {
    if (!payload) return;
    const relationships = payload.model.relationships.filter((rel) => rel.id !== id);
    if (relationships.length === payload.model.relationships.length) return;
    const diagrams = payload.diagrams.diagrams.map((diagram) => ({
      ...diagram,
      edges: diagram.edges.filter((edge) => edge.relationshipId !== id),
    }));
    applyChange((current) => ({
      ...current,
      manifest: { ...current.manifest, updatedAt: new Date().toISOString() },
      model: { ...current.model, relationships },
      diagrams: { diagrams },
    }));
    if (selection?.kind === 'relationship' && selection.id === id) {
      selectRelationship(undefined);
    }
    setSelectedNodeIds([]);
  };

  const handleDelete = () => {
    if (selection?.kind === 'element' && window.confirm('Delete the selected element and its contents?')) {
      deleteElement(selection.id);
    }
  };

  const handleDeleteRelationship = () => {
    if (selection?.kind === 'relationship' && window.confirm('Delete the selected relationship?')) {
      deleteRelationship(selection.id);
    }
  };

  const deleteSelectedDiagramNodes = () => {
    if (!payload || !activeDiagram || selectedNodeIds.length === 0) return;
    const toDelete = new Set(selectedNodeIds);
    const touchedElementIds = new Set(
      activeDiagram.nodes.filter((node) => toDelete.has(node.id)).map((node) => node.elementId),
    );
    applyChange((current) => {
      const diagrams = current.diagrams.diagrams.map((diagram) => {
        if (diagram.id !== activeDiagram.id) return diagram;
        const nodes = diagram.nodes.filter((node) => !toDelete.has(node.id));
        const remainingIds = new Set(nodes.map((node) => node.id));
        const edges = diagram.edges.filter(
          (edge) => remainingIds.has(edge.sourceNodeId) && remainingIds.has(edge.targetNodeId),
        );
        return { ...diagram, nodes, edges };
      });
      return {
        ...current,
        manifest: { ...current.manifest, updatedAt: new Date().toISOString() },
        diagrams: { diagrams },
      };
    });
    setSelectedNodeIds([]);
    if (selection?.kind === 'element' && touchedElementIds.has(selection.id)) {
      selectElement(undefined);
    }
    if (selection?.kind === 'relationship') {
      selectRelationship(undefined);
    }
  };

  const copySelectedNodes = () => {
    if (!activeDiagram || selectedNodeIds.length === 0) return;
    clipboardNodesRef.current = activeDiagram.nodes
      .filter((node) => selectedNodeIds.includes(node.id))
      .map((node) => ({ ...node }));
  };

  const pasteNodes = () => {
    if (!payload || !activeDiagram) return;
    if (clipboardNodesRef.current.length === 0) return;
    const offset = 40 + (pasteOffset.current % 4) * 12;
    pasteOffset.current += 1;
    const newNodes = clipboardNodesRef.current.map((node, index) => ({
      ...node,
      id: crypto.randomUUID(),
      x: node.x + offset + index * 6,
      y: node.y + offset + index * 6,
    }));
    applyChange((current) => {
      const diagrams = current.diagrams.diagrams.map((diagram) => {
        if (diagram.id !== activeDiagram.id) return diagram;
        return { ...diagram, nodes: [...diagram.nodes, ...newNodes] };
      });
      return {
        ...current,
        manifest: { ...current.manifest, updatedAt: new Date().toISOString() },
        diagrams: { diagrams },
      };
    });
    setSelectedNodeIds(newNodes.map((node) => node.id));
    const firstElementId = newNodes[0]?.elementId;
    if (firstElementId) {
      selectElement(firstElementId);
    }
  };

  const duplicateNodes = () => {
    copySelectedNodes();
    pasteNodes();
  };

  const undo = useCallback(() => {
    if (!payload) return;
    setHistory((prev) => {
      if (prev.length === 0) return prev;
      const previous = prev[prev.length - 1];
      const currentSnapshot: HistoryEntry = { payload, selection, selectedNodeIds, activeDiagramId };
      setRedoStack((redoPrev) => {
        const next = [...redoPrev, currentSnapshot];
        return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
      });
      setPayload(previous.payload);
      setSelection(previous.selection);
      setSelectedNodeIds(previous.selectedNodeIds ?? []);
      setActiveDiagramId(previous.activeDiagramId);
      setDirty(true);
      setAutosaveError(null);
      return prev.slice(0, -1);
    });
  }, [activeDiagramId, payload, selection]);

  const redo = useCallback(() => {
    if (!payload) return;
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const nextEntry = prev[prev.length - 1];
      const currentSnapshot: HistoryEntry = { payload, selection, selectedNodeIds, activeDiagramId };
      setHistory((historyPrev) => {
        const next = [...historyPrev, currentSnapshot];
        return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
      });
      setPayload(nextEntry.payload);
      setSelection(nextEntry.selection);
      setSelectedNodeIds(nextEntry.selectedNodeIds ?? []);
      setActiveDiagramId(nextEntry.activeDiagramId);
      setDirty(true);
      setAutosaveError(null);
      return prev.slice(0, -1);
    });
  }, [activeDiagramId, payload, selectedNodeIds, selection]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName?.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) {
          return;
        }
      }
      const key = event.key.toLowerCase();
      const isMod = event.metaKey || event.ctrlKey;
      if (isMod && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          redo();
        } else {
          undo();
        }
      } else if (isMod && key === 'y') {
        event.preventDefault();
        redo();
      } else if (isMod && key === 'c') {
        copySelectedNodes();
      } else if (isMod && key === 'v') {
        event.preventDefault();
        pasteNodes();
      } else if (isMod && key === 'd') {
        event.preventDefault();
        duplicateNodes();
      } else if (!isMod && (key === 'delete' || key === 'backspace')) {
        if (selectedNodeIds.length > 0) {
          event.preventDefault();
          deleteSelectedDiagramNodes();
        }
      } else if (!isMod && key === 'escape') {
        setSelectedNodeIds([]);
        selectElement(undefined);
        selectRelationship(undefined);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    copySelectedNodes,
    deleteSelectedDiagramNodes,
    duplicateNodes,
    pasteNodes,
    redo,
    selectElement,
    selectRelationship,
    selectedNodeIds.length,
    undo,
  ]);

  const handleImportInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    handleImportWorkspace(file);
  };

  const triggerImport = () => {
    importInputRef.current?.click();
  };

  const handleSave = useCallback(
    async (options?: { auto?: boolean }) => {
      if (!payload) return;
      setSaving(true);
      const next: WorkspacePayload = {
        ...payload,
        manifest: { ...payload.manifest, updatedAt: new Date().toISOString() },
      };
      setPayload(next);
      try {
        await postJson('/api/workspaces/current/save', next);
        setStatus(options?.auto ? 'Autosaved workspace' : 'Saved workspace');
        setDirty(false);
        setLastSavedAt(next.manifest.updatedAt ?? null);
        setAutosaveError(null);
      } catch (error) {
        console.error(error);
        const message = error instanceof Error ? error.message : String(error);
        setStatus('Save failed');
        setAutosaveError(message);
        setBanner({ kind: 'error', messages: ['Save failed', message] });
        if (options?.auto) {
          setAutosaveEnabled(false);
        }
      } finally {
        setSaving(false);
      }
    },
    [payload],
  );

  const landingSubtitle = loadingWorkspaces
    ? 'Loading workspaces...'
    : workspaces.length === 0
      ? 'No saved workspaces yet'
      : `${workspaces.length} available`;

  const autosaveStatus = useMemo(() => {
    if (!payload) return 'No workspace loaded';
    if (autosaveError) return `Save failed: ${autosaveError}`;
    if (saving) return 'Saving...';
    if (dirty) return autosaveEnabled ? 'Autosave pending' : 'Unsaved changes';
    if (lastSavedAt) return `Saved ${new Date(lastSavedAt).toLocaleTimeString()}`;
    return 'No changes yet';
  }, [autosaveEnabled, autosaveError, dirty, lastSavedAt, payload, saving]);

  const canUndo = history.length > 0;
  const canRedo = redoStack.length > 0;

  useEffect(() => {
    if (!payload || !dirty || !autosaveEnabled || saving) return;
    const timer = window.setTimeout(() => {
      handleSave({ auto: true });
    }, AUTOSAVE_DELAY);
    return () => window.clearTimeout(timer);
  }, [autosaveEnabled, dirty, handleSave, payload, saving]);

  return (
    <div className="app">
      <Toolbar
        workspaces={workspaces}
        activeId={activeId}
        onChange={(id) => setActiveId(id || undefined)}
        status={status}
        onSave={payload ? handleSave : undefined}
        saving={saving}
        onCreateWorkspace={createWorkspace}
        onImportWorkspace={triggerImport}
        onExportWorkspace={payload ? handleExportWorkspace : undefined}
        autosaveEnabled={autosaveEnabled}
        autosaveStatus={autosaveStatus}
        onToggleAutosave={
          payload
            ? () => {
                setAutosaveEnabled((value) => !value);
                setAutosaveError(null);
              }
            : undefined
        }
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={canUndo ? undo : undefined}
        onRedo={canRedo ? redo : undefined}
      />
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={handleImportInputChange}
      />
      {banner ? (
        <div className={`banner banner--${banner.kind}`}>
          {banner.messages.map((message) => (
            <div key={message}>{message}</div>
          ))}
        </div>
      ) : null}
      {payload ? (
        <main className="layout layout--three">
          <Panel title="Model Browser" subtitle="Containment tree with search">
            <ModelBrowser
              tree={tree}
              search={search}
              onSearch={setSearch}
              selectedId={selectedElementId}
              onSelect={selectElement}
              onCreatePackage={() => createElement('Package')}
              onCreateBlock={() => createElement('Block')}
              onDelete={selectedElementId ? handleDelete : undefined}
              onAddToDiagram={selectedElementId ? () => addToDiagram(selectedElementId) : undefined}
              activeDiagram={activeDiagram}
              disableActions={!payload}
            />
          </Panel>
          <Panel title={payload?.manifest.name ?? 'Workspace overview'} subtitle={payload?.manifest.description}>
            <p className="lede">
              {payload
                ? `${summary.elements} elements, ${summary.relationships} relationships, ${summary.diagrams} diagrams.`
                : 'Select a workspace to explore its contents.'}
            </p>
            {activeDiagram ? (
              <div className="diagram-wrapper">
                <div className="diagram-header">
                  <DiagramTabs
                    diagrams={payload?.diagrams.diagrams ?? []}
                    activeId={activeDiagramId}
                    onSelect={setActiveDiagramId}
                  />
                  <span className="diagram-meta">Type: {activeDiagram.type}</span>
                  {selectedNodeIds.length > 0 ? (
                    <span className="diagram-meta diagram-meta--count">{selectedNodeIds.length} selected</span>
                  ) : null}
                </div>
                <DiagramCanvas
                  diagram={activeDiagram}
                  elements={elementsById}
                  relationships={relationshipsById}
                  selection={selection}
                  selectedNodeIds={selectedNodeIds}
                  onSelectElement={selectElement}
                  onSelectRelationship={selectRelationship}
                  onSelectNodes={setSelectedNodeIds}
                  onChange={(diagram) => updateDiagram(activeDiagram.id, diagram)}
                />
              </div>
            ) : (
              <div className="summary-cards">
                <div className="card">
                  <div className="card__label">Workspace ID</div>
                  <div className="card__value">{payload?.manifest.id ?? '—'}</div>
                </div>
                <div className="card">
                  <div className="card__label">IR version</div>
                  <div className="card__value">{IR_VERSION}</div>
                </div>
                <div className="card">
                  <div className="card__label">Updated</div>
                  <div className="card__value">{payload?.manifest.updatedAt ?? '—'}</div>
                </div>
                <div className="card">
                  <div className="card__label">Created</div>
                  <div className="card__value">{payload?.manifest.createdAt ?? '—'}</div>
                </div>
              </div>
            )}
          </Panel>
          <Panel title="Properties" subtitle={propertiesSubtitle}>
            <PropertiesPanel
              selection={selection}
              element={selectedElement}
              relationship={selectedRelationship}
              elements={elementsById}
              relatedRelationships={relatedRelationships}
              metaclasses={metaclasses}
              relationshipTypes={relationshipTypes}
              onSelect={setSelection}
              onElementChange={(updates) => selectedElementId && updateElement(selectedElementId, updates)}
              onRelationshipChange={(updates) =>
                selectedRelationshipId && updateRelationship(selectedRelationshipId, updates)
              }
              onCreateRelationship={
                selectedElement
                  ? (type, targetId) => createRelationship(type, selectedElement.id, targetId)
                  : undefined
              }
              onDeleteRelationship={handleDeleteRelationship}
              onAddToDiagram={
                selectedElementId && activeDiagram ? () => addToDiagram(selectedElementId) : undefined
              }
            />
          </Panel>
        </main>
      ) : (
        <main className="layout layout--landing">
          <Panel title="Welcome" subtitle="Open or import a workspace to begin">
            <p className="lede">No workspace is currently loaded.</p>
            <div className="landing__actions">
              <button className="button" type="button" onClick={createWorkspace} disabled={loadingWorkspaces}>
                Create new workspace
              </button>
              <button
                className="button button--ghost"
                type="button"
                onClick={triggerImport}
                disabled={importing}
              >
                {importing ? 'Importing…' : 'Open / Import'}
              </button>
            </div>
            <p className="hint">Accepts a JSON bundle with manifest, model, and diagrams.</p>
          </Panel>
          <Panel title="Available workspaces" subtitle={landingSubtitle}>
            {workspaces.length === 0 ? (
              <div className="empty-state">Create a new workspace or import one to get started.</div>
            ) : (
              <ul className="workspace-cards">
                {workspaces.map((workspace) => (
                  <li className="workspace-card" key={workspace.id}>
                    <div className="workspace-card__header">
                      <div className="workspace-card__name">{workspace.name}</div>
                      <div className="workspace-card__id">{workspace.id}</div>
                    </div>
                    <div className="workspace-card__meta">Updated {workspace.updatedAt}</div>
                    <button className="button button--ghost" type="button" onClick={() => setActiveId(workspace.id)}>
                      Open workspace
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </main>
      )}
    </div>
  );
}
