import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Diagram,
  DiagramKind,
  DiagramsFile,
  Element,
  ModelFile,
  Relationship,
  SysmlV2Json,
  WorkspaceFiles,
  WorkspaceManifest,
} from '@cameotest/shared';
import { IR_VERSION, metaclassSchema, relationshipTypeSchema, validateWorkspaceFiles } from '@cameotest/shared';
import { Panel } from './components/Panel';
import { Toolbar } from './components/Toolbar';
import { ModelBrowser, ModelBrowserNode } from './components/ModelBrowser';
import { PropertiesPanel } from './components/PropertiesPanel';
import { DiagramCanvas } from './components/DiagramCanvas';
import { DiagramTabs } from './components/DiagramTabs';
import { ToastItem, ToastStack } from './components/Toast';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SysmlDrawer } from './components/SysmlDrawer';
import { DraggedElementPayload } from './dragTypes';
import exampleWorkspace from './examples/example-workspace.json';

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

type ContextMenuState =
  | { kind: 'tree'; x: number; y: number; elementId: string }
  | { kind: 'canvas'; x: number; y: number; position: { x: number; y: number } }
  | {
      kind: 'part';
      x: number;
      y: number;
      elementId: string;
      position: { x: number; y: number };
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

async function deleteJson(url: string): Promise<void> {
  const response = await fetch(url, { method: 'DELETE' });
  await parseResponse(response);
}

async function parseResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const hasBody = text.trim().length > 0;
  let payload: any = null;
  if (hasBody) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      throw error as Error;
    }
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
const IBD_FRAME = { x: 240, y: 140, w: 640, h: 420 } as const;

const diagramKindOf = (diagram?: Diagram): DiagramKind =>
  (diagram?.kind ?? diagram?.type ?? 'BDD') as DiagramKind;

const normalizeDiagram = (diagram: Diagram): Diagram => {
  const kind = diagramKindOf(diagram);
  const type = (diagram.type ?? kind) as DiagramKind;
  const nodes = diagram.nodes.map((node) => {
    const inferredKind =
      node.kind ?? (kind === 'IBD' ? (node.placement ? 'Port' : 'Part') : 'Element');
    return { ...node, kind: inferredKind } as Diagram['nodes'][number];
  });
  return { ...diagram, kind, type, nodes };
};

const isBddDiagram = (diagram?: Diagram) => diagramKindOf(diagram) === 'BDD';
const isIbdDiagram = (diagram?: Diagram) => diagramKindOf(diagram) === 'IBD';

const generateSysmlPreview = (
  element?: Element,
  relationships: Relationship[] = [],
  byId?: Record<string, Element>,
) => {
  if (!element) return 'Select an element to view generated SysML text.';
  const header = `${element.metaclass.toLowerCase()} ${element.name}`;
  const stereo = element.stereotypes?.length ? ` <<${element.stereotypes.join(', ')}>>` : '';
  const doc = element.documentation ? `  doc "${element.documentation}"` : '';
  const tagLines = Object.entries(element.tags ?? {}).map(([key, value]) => `  tag ${key} = ${value}`);
  const relLines = relationships.map((rel) => {
    if (rel.type === 'Connector') return `connector ${rel.sourcePortId} -> ${rel.targetPortId}`;
    const source = rel.sourceId ? byId?.[rel.sourceId]?.name ?? rel.sourceId : '—';
    const target = rel.targetId ? byId?.[rel.targetId]?.name ?? rel.targetId : '—';
    return `${rel.type.toLowerCase()} ${source} -> ${target}`;
  });
  return [header + stereo, doc, ...tagLines, relLines.length ? 'relations:' : null, ...relLines.map((line) => `  ${line}`)]
    .filter(Boolean)
    .join('\n');
};

export default function App() {
  const [workspaces, setWorkspaces] = useState<WorkspaceManifest[]>([]);
  const [activeId, setActiveId] = useState<string | undefined>();
  const [payload, setPayload] = useState<WorkspacePayload | null>(null);
  const [workspaceNameDraft, setWorkspaceNameDraft] = useState('');
  const [status, setStatus] = useState('Fetching workspace list...');
  const [selection, setSelection] = useState<Selection | undefined>();
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [modelRevision, setModelRevision] = useState(0);
  const [activeDiagramId, setActiveDiagramId] = useState<string | undefined>();
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(false);
  const [loadingExample, setLoadingExample] = useState(false);
  const [importingWorkspace, setImportingWorkspace] = useState(false);
  const [importingSysml, setImportingSysml] = useState(false);
  const [deletingWorkspaceId, setDeletingWorkspaceId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: 'error' | 'info'; messages: string[] } | null>(null);
  const [autosaveEnabled, setAutosaveEnabled] = useState(true);
  const [autosaveError, setAutosaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  const [connectMode, setConnectMode] = useState(false);
  const [pendingConnectorPortId, setPendingConnectorPortId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [diagramMenuOpen, setDiagramMenuOpen] = useState(false);
  const [codeDrawerOpen, setCodeDrawerOpen] = useState(false);
  const [drawerSelectedElementId, setDrawerSelectedElementId] = useState<string | null>(null);
  const [codeDrawerPinned, setCodeDrawerPinned] = useState(false);
  const [pinnedDrawerElementId, setPinnedDrawerElementId] = useState<string | null>(null);
  const [codeBaseSnippet, setCodeBaseSnippet] = useState('');
  const [codeDraft, setCodeDraft] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  const [pendingDrawerSwitchId, setPendingDrawerSwitchId] = useState<string | null | undefined>(undefined);
  const [externalModelChange, setExternalModelChange] = useState(false);
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(false);
  const [showContainment, setShowContainment] = useState(true);
  const [showPropertiesPanel, setShowPropertiesPanel] = useState(true);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [renameState, setRenameState] = useState<
    | { targetId: string; source: 'tree'; draft: string }
    | { targetId: string; source: 'canvas'; draft: string; position: { x: number; y: number } }
    | null
  >(null);
  const pendingHistory = useRef(new Map<string, HistoryEntry>());
  const addOffset = useRef(0);
  const ibdPartOffset = useRef(0);
  const pasteOffset = useRef(0);
  const clipboardNodesRef = useRef<Diagram['nodes']>([]);
  const lastDiagramPositionRef = useRef<{ x: number; y: number } | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const sysmlImportInputRef = useRef<HTMLInputElement | null>(null);
  const diagramMenuRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  const showToast = useCallback((message: string, kind: ToastItem['kind'] = 'info') => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, message, kind }]);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const runSafely = useCallback(
    (label: string, action: () => void) => {
      try {
        action();
      } catch (error) {
        console.error(label, error);
        showToast(`${label} failed`, 'error');
      }
    },
    [showToast],
  );

  useEffect(() => {
    if (!contextMenu) return;
    const close = (event?: Event) => {
      if (event && contextMenuRef.current && event.target instanceof Node) {
        if (contextMenuRef.current.contains(event.target)) {
          return;
        }
      }
      setContextMenu(null);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close();
      }
    };
    const handleBlur = () => close();
    window.addEventListener('pointerdown', close, { capture: true });
    window.addEventListener('keydown', handleKey);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('pointerdown', close, { capture: true } as EventListenerOptions);
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('blur', handleBlur);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!shortcutsOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShortcutsOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shortcutsOpen]);

  useEffect(() => {
    if (!diagramMenuOpen) return;
    const close = (event: MouseEvent) => {
      if (diagramMenuRef.current && event.target instanceof Node && diagramMenuRef.current.contains(event.target)) return;
      setDiagramMenuOpen(false);
    };
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [diagramMenuOpen]);

  const selectElement = (id?: string) => setSelection(id ? { kind: 'element', id } : undefined);
  const selectRelationship = (id?: string) => setSelection(id ? { kind: 'relationship', id } : undefined);

  const pushHistoryEntry = useCallback((entry: HistoryEntry) => {
    setHistory((prev) => {
      const next = [...prev, entry];
      return next.length > HISTORY_LIMIT ? next.slice(next.length - HISTORY_LIMIT) : next;
    });
  }, []);

  const recordHistory = useCallback(
    (current: WorkspacePayload) => {
      pushHistoryEntry({ payload: current, selection, selectedNodeIds, activeDiagramId });
    },
    [activeDiagramId, pushHistoryEntry, selectedNodeIds, selection],
  );

  const applyChange = useCallback(
    (
      mutator: (current: WorkspacePayload) => WorkspacePayload,
      options?: { transient?: boolean; historyKey?: string },
    ) => {
      setPayload((current) => {
        if (!current) return current;
        const historyKey = options?.historyKey;
        const isTransient = options?.transient;

        if (isTransient && historyKey && !pendingHistory.current.has(historyKey)) {
          pendingHistory.current.set(historyKey, {
            payload: current,
            selection,
            selectedNodeIds,
            activeDiagramId,
          });
        }

        const next = mutator(current);
        if (next === current) {
          if (!isTransient && historyKey) {
            pendingHistory.current.delete(historyKey);
          }
          return current;
        }

        if (isTransient) {
          return next;
        }

        const historyEntry = historyKey ? pendingHistory.current.get(historyKey) : undefined;
        if (historyEntry && historyKey) {
          pushHistoryEntry(historyEntry);
          pendingHistory.current.delete(historyKey);
        } else {
          recordHistory(current);
        }
        setRedoStack([]);
        setDirty(true);
        setAutosaveError(null);
        setModelRevision((revision) => revision + 1);
        return next;
      });
    },
    [activeDiagramId, pushHistoryEntry, recordHistory, selectedNodeIds, selection],
  );

  const refreshWorkspaces = useCallback(async () => {
    setLoadingWorkspaces(true);
    try {
      const list = await getJson<WorkspaceManifest[]>('/api/workspaces');
      setWorkspaces(list);
      setActiveId((current) => (current && list.some((workspace) => workspace.id === current) ? current : undefined));
      setStatus('Ready');
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      setBanner({ kind: 'error', messages: ['Unable to load workspaces', message] });
      setStatus('Unable to load workspaces');
    } finally {
      setLoadingWorkspaces(false);
    }
  }, []);

  useEffect(() => {
    refreshWorkspaces();
  }, [refreshWorkspaces]);

  const resetToLanding = useCallback(() => {
    setActiveId(undefined);
    setPayload(null);
    setSelection(undefined);
    setSelectedNodeIds([]);
    setActiveDiagramId(undefined);
    setDirty(false);
    setModelRevision(0);
    setHistory([]);
    setRedoStack([]);
    setAutosaveError(null);
    setBanner(null);
    setStatus('Ready');
    setCodeDrawerOpen(false);
    setDrawerSelectedElementId(null);
    setPendingDrawerSwitchId(undefined);
    setExternalModelChange(false);
    setCodeBaseSnippet('');
    setCodeDraft('');
    setCodeError(null);
    setPropertiesCollapsed(false);
    setDiagramMenuOpen(false);
  }, []);

  const selectWorkspace = useCallback(
    (id?: string) => {
      if (!id) {
        resetToLanding();
        return;
      }
      setBanner(null);
      setStatus(`Opening workspace “${id}”...`);
      setActiveId(id);
    },
    [resetToLanding],
  );

  useEffect(() => {
    if (!activeId) {
      resetToLanding();
      return;
    }
    let cancelled = false;
    const loadWorkspace = async () => {
      setStatus(`Opening workspace “${activeId}”...`);
      setBanner(null);
      try {
        await postJson(`/api/workspaces/${activeId}/open`);
        const data = await getJson<WorkspacePayload>('/api/workspaces/current/load');
        const validated = validateWorkspaceFiles(data);
        const normalizedDiagrams = validated.diagrams.diagrams.map(normalizeDiagram);
        const normalizedPayload: WorkspacePayload = { ...validated, diagrams: { diagrams: normalizedDiagrams } };
        if (cancelled) return;
        setPayload(normalizedPayload);
        setHistory([]);
        setRedoStack([]);
        setDirty(false);
        setModelRevision(0);
        setLastSavedAt(validated.manifest.updatedAt ?? null);
        setAutosaveError(null);
        setExternalModelChange(false);
        const firstElement = validated.model.elements[0]?.id;
        setSelection(firstElement ? { kind: 'element', id: firstElement } : undefined);
        const firstDiagramNode = normalizedDiagrams[0]?.nodes[0];
        setSelectedNodeIds(firstDiagramNode ? [firstDiagramNode.id] : []);
        setActiveDiagramId(normalizedDiagrams[0]?.id);
        setStatus('Ready');
      } catch (error) {
        if (cancelled) return;
        console.error('Failed to open workspace', error);
        const message = error instanceof Error ? error.message : String(error);
        resetToLanding();
        await refreshWorkspaces();
        setBanner({
          kind: 'error',
          messages: ['Workspace failed to load', message],
        });
        setStatus('Workspace not available');
      }
    };
    loadWorkspace();
    return () => {
      cancelled = true;
    };
  }, [activeId, refreshWorkspaces, resetToLanding]);

  useEffect(() => {
    setWorkspaceNameDraft(payload?.manifest.name ?? '');
  }, [payload?.manifest.name]);

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

  const clampMenuPosition = useCallback((kind: ContextMenuState['kind'], x: number, y: number) => {
    if (typeof window === 'undefined') return { x, y };
    const margin = 8;
    const width = kind === 'tree' ? 320 : 240;
    const height = kind === 'tree' ? 420 : kind === 'canvas' ? 280 : 220;
    const viewportWidth = document.documentElement?.clientWidth ?? window.innerWidth;
    const viewportHeight = document.documentElement?.clientHeight ?? window.innerHeight;
    const clampedX = Math.min(Math.max(x, margin), Math.max(margin, viewportWidth - width - margin));
    const clampedY = Math.min(Math.max(y, margin), Math.max(margin, viewportHeight - height - margin));
    return { x: clampedX, y: clampedY };
  }, []);

  const handleTreeContextMenu = (element: Element, clientPosition: { x: number; y: number }) => {
    const position = clampMenuPosition('tree', clientPosition.x, clientPosition.y);
    selectElement(element.id);
    setSelectedNodeIds([]);
    setContextMenu({ kind: 'tree', x: position.x, y: position.y, elementId: element.id });
  };

  const elementsById = useMemo(() => {
    if (!payload) return {} as Record<string, Element>;
    return payload.model.elements.reduce<Record<string, Element>>((acc, element) => {
      acc[element.id] = element;
      return acc;
    }, {});
  }, [payload]);

  const selectedElement = useMemo(() => {
    if (!payload || !selection || selection.kind !== 'element') return undefined;
    return elementsById[selection.id];
  }, [elementsById, payload, selection]);

  const selectedRelationship = useMemo(() => {
    if (!payload || !selection || selection.kind !== 'relationship') return undefined;
    return payload.model.relationships.find((rel) => rel.id === selection.id);
  }, [payload, selection]);

  const selectedElementId = selection?.kind === 'element' ? selection.id : undefined;
  const drawerSelectedElement = drawerSelectedElementId ? elementsById[drawerSelectedElementId] : undefined;
  const pendingDrawerSelection =
    pendingDrawerSwitchId === undefined
      ? undefined
      : pendingDrawerSwitchId === null
        ? null
        : elementsById[pendingDrawerSwitchId];
  const isCodeDirty = codeDraft !== codeBaseSnippet;

  const syncDrawerFromElement = useCallback(
    (element?: Element | null) => {
      const snippet = element ? editableSnippetForElement(element) : '';
      setCodeBaseSnippet(snippet);
      setCodeDraft(snippet);
      setCodeError(null);
      setExternalModelChange(false);
    },
    [],
  );

  const openCodeDrawerForElement = useCallback(
    (elementId?: string | null) => {
      const targetElement = elementId ? elementsById[elementId] : undefined;
      setDrawerSelectedElementId(targetElement?.id ?? null);
      syncDrawerFromElement(targetElement);
      setPendingDrawerSwitchId(undefined);
      setCodeDrawerOpen(true);
      if (elementId) {
        selectElement(elementId);
      }
    },
    [elementsById, selectElement, syncDrawerFromElement],
  );

  const openCodeDrawer = useCallback(() => {
    openCodeDrawerForElement(selectedElementId);
  }, [openCodeDrawerForElement, selectedElementId]);

  const closeCodeDrawer = useCallback(() => {
    setCodeDrawerOpen(false);
    setPendingDrawerSwitchId(undefined);
    setCodeDrawerPinned(false);
    setPinnedDrawerElementId(null);
    setDrawerSelectedElementId(null);
    setCodeError(null);
    setExternalModelChange(false);
  }, []);

  useEffect(() => {
    if (!codeDrawerOpen) return;
    if (codeDrawerPinned) {
      const pinnedExists = pinnedDrawerElementId && elementsById[pinnedDrawerElementId];
      if (!pinnedExists) {
        setCodeDrawerPinned(false);
        setPinnedDrawerElementId(null);
        setDrawerSelectedElementId(null);
      }
      return;
    }
    const nextSelectionId = selectedElementId ?? null;
    if (nextSelectionId === drawerSelectedElementId) {
      setPendingDrawerSwitchId(undefined);
      return;
    }
    if (!isCodeDirty) {
      const nextElement = nextSelectionId ? elementsById[nextSelectionId] : undefined;
      setDrawerSelectedElementId(nextSelectionId);
      syncDrawerFromElement(nextElement);
      setPendingDrawerSwitchId(undefined);
    } else {
      setPendingDrawerSwitchId(nextSelectionId);
    }
  }, [codeDrawerOpen, drawerSelectedElementId, elementsById, isCodeDirty, selectedElementId, syncDrawerFromElement]);

  useEffect(() => setCodeError(null), [codeDraft]);

  const activeDiagram: Diagram | undefined = useMemo(() => {
    if (!payload || !activeDiagramId) return undefined;
    const found = payload.diagrams.diagrams.find((diagram) => diagram.id === activeDiagramId);
    return found ? normalizeDiagram(found) : undefined;
  }, [activeDiagramId, payload]);

  const diagramBreadcrumb = useMemo(() => {
    if (!activeDiagram) return null;
    const ownerName = activeDiagram.ownerId ? elementsById[activeDiagram.ownerId]?.name ?? 'Package' : 'Root';
    const contextName =
      isIbdDiagram(activeDiagram) && activeDiagram.contextBlockId
        ? elementsById[activeDiagram.contextBlockId]?.name
        : undefined;
    return [ownerName, activeDiagram.name, contextName].filter(Boolean).join(' / ');
  }, [activeDiagram, elementsById]);

  useEffect(() => {
    if (!activeDiagram || !selection || selection.kind !== 'element') return;
    const selectedInDiagram = activeDiagram.nodes.some((node) => node.elementId === selection.id);
    if (!selectedInDiagram && activeDiagram.nodes.length > 0) {
      setSelection((current) => current ?? { kind: 'element', id: activeDiagram.nodes[0].elementId });
    }
  }, [activeDiagram, selection]);

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
    setConnectMode(false);
    setPendingConnectorPortId(null);
  }, [activeDiagramId]);

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

  const layoutColumns = useMemo(() => {
    if (showContainment && showPropertiesPanel) return '1fr 3fr 1fr';
    if (showContainment && !showPropertiesPanel) return '1fr 4fr';
    if (!showContainment && showPropertiesPanel) return '4fr 1fr';
    return '1fr';
  }, [showContainment, showPropertiesPanel]);

  const canvasFocused = !showContainment && !showPropertiesPanel;

  const selectedRelationshipId = selection?.kind === 'relationship' ? selection.id : undefined;
  const propertiesSubtitle =
    selectedElement?.name ??
    (selectedRelationship ? `${selectedRelationship.type} relationship` : 'Select an element to edit');
  const selectedIsBlock = selectedElement?.metaclass === 'Block';
  const selectedIsPort = selectedElement?.metaclass === 'Port';
  const selectedIsPart = selectedElement?.metaclass === 'Part';
  const belongsToContextBlock = (element?: Element, contextBlockId?: string | null) => {
    if (!element || !contextBlockId) return false;
    let current: Element | undefined = element;
    while (current?.ownerId) {
      const owner: Element | undefined = elementsById[current.ownerId];
      if (!owner) return false;
      if (owner.metaclass === 'Block') return owner.id === contextBlockId;
      current = owner;
    }
    return current?.metaclass === 'Block' && current.id === contextBlockId;
  };
  const activeDiagramKind = diagramKindOf(activeDiagram);
  const canUseConnectMode = !!(activeDiagram && isIbdDiagram(activeDiagram));
  const canAddPortToIbd = !!(
    selectedIsPort &&
    activeDiagram &&
    isIbdDiagram(activeDiagram) &&
    belongsToContextBlock(selectedElement, activeDiagram.contextBlockId)
  );
  const canAddPartToIbd = !!(
    selectedIsPart &&
    activeDiagram &&
    isIbdDiagram(activeDiagram) &&
    belongsToContextBlock(selectedElement, activeDiagram.contextBlockId)
  );
  const canAddElementToDiagram = !!(
    activeDiagram &&
    ((isIbdDiagram(activeDiagram) && (canAddPortToIbd || canAddPartToIbd)) || isBddDiagram(activeDiagram))
  );

  const relationshipTouchesElements = useCallback((rel: Relationship, ids: Set<string>) => {
    if (rel.type === 'Connector') {
      return ids.has(rel.sourcePortId) || ids.has(rel.targetPortId);
    }
    return ids.has(rel.sourceId) || ids.has(rel.targetId);
  }, []);

  const relationshipsForElement = useCallback(
    (element?: Element | null) => {
      if (!payload || !element) return [] as Relationship[];
      const target = new Set([element.id]);
      return payload.model.relationships.filter((rel) => relationshipTouchesElements(rel, target));
    },
    [payload, relationshipTouchesElements],
  );

  const relatedRelationships = useMemo(
    () => relationshipsForElement(selectedElement),
    [relationshipsForElement, selectedElement],
  );

  const drawerRelatedRelationships = useMemo(
    () => relationshipsForElement(drawerSelectedElement),
    [drawerSelectedElement, relationshipsForElement],
  );

  const sysmlPreview = useMemo(
    () => generateSysmlPreview(drawerSelectedElement, drawerRelatedRelationships, elementsById),
    [drawerRelatedRelationships, drawerSelectedElement, elementsById],
  );

  const relationshipCreationTypes = useMemo(
    () => relationshipTypes.filter((type) => type !== 'Connector'),
    [],
  );

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

  const beginRename = useCallback(
    (targetId: string, source: 'tree' | 'canvas', position?: { x: number; y: number }) => {
      const target = elementsById[targetId];
      if (!target) return;
      if (source === 'tree') {
        setRenameState({ targetId, source, draft: target.name });
      } else {
        setRenameState({ targetId, source, draft: target.name, position: position ?? { x: 12, y: 12 } });
      }
    },
    [elementsById],
  );

  const handleRenameChange = useCallback((value: string) => {
    setRenameState((current) => (current ? { ...current, draft: value } : current));
  }, []);

  const handleRenameSubmit = useCallback(
    (value?: string) => {
      setRenameState((current) => {
        if (!current) return current;
        const nextName = (value ?? current.draft).trim();
        if (nextName.length > 0) {
          updateElement(current.targetId, { name: nextName });
        }
        return null;
      });
    },
    [updateElement],
  );

  const handleRenameCancel = useCallback(() => setRenameState(null), []);

  const applyCodeDraft = () => {
    if (drawerSelectedElementId && !elementsById[drawerSelectedElementId]) {
      setCodeError('Element was removed. Discard edits or switch selection.');
      return;
    }
    if (!drawerSelectedElement) {
      setCodeError('Select an element to apply changes.');
      return;
    }
    if (!draftParsed) {
      setCodeError(draftParseError ?? 'Unable to parse snippet.');
      return;
    }

    const updates: Partial<Element> = {
      name: draftParsed.name,
      documentation: draftParsed.doc,
      stereotypes: draftParsed.stereotypes,
      tags: draftParsed.tags,
    };
    const nextSnippet = editableSnippetForElement({ ...drawerSelectedElement, ...updates });
    updateElement(drawerSelectedElement.id, updates);
    setCodeBaseSnippet(nextSnippet);
    setCodeDraft(nextSnippet);
    setCodeError(null);
    setExternalModelChange(false);
    setPendingDrawerSwitchId(undefined);
    showToast('Applied code edits to model', 'info');
  };

  const requestCloseCodeDrawer = useCallback(() => {
    if (isCodeDirty && !window.confirm('Discard unsaved code edits?')) {
      return;
    }
    closeCodeDrawer();
  }, [closeCodeDrawer, isCodeDirty]);

  const pinCodeDrawer = () => {
    if (!drawerSelectedElementId) return;
    setPinnedDrawerElementId(drawerSelectedElementId);
    setCodeDrawerPinned(true);
    setPendingDrawerSwitchId(undefined);
  };

  const unpinCodeDrawer = () => {
    setCodeDrawerPinned(false);
    const pendingId = pendingDrawerSwitchId ?? selectedElementId ?? null;
    if (pendingDrawerSelection !== undefined) {
      const nextElement = pendingDrawerSelection ?? (pendingId ? elementsById[pendingId] : undefined);
      setDrawerSelectedElementId(nextElement?.id ?? null);
      syncDrawerFromElement(nextElement);
      setPendingDrawerSwitchId(undefined);
    }
    setPinnedDrawerElementId(null);
  };

  const toggleCodeDrawer = () => {
    if (codeDrawerOpen) {
      requestCloseCodeDrawer();
    } else {
      openCodeDrawer();
    }
  };

  const discardAndSwitchDrawer = () => {
    const nextSelectionId = pendingDrawerSwitchId ?? null;
    const nextElement = nextSelectionId ? elementsById[nextSelectionId] : undefined;
    setDrawerSelectedElementId(nextSelectionId);
    syncDrawerFromElement(nextElement);
    setPendingDrawerSwitchId(undefined);
  };

  const keepEditingDrawer = () => setPendingDrawerSwitchId(undefined);

  const reloadDraftFromModel = () => {
    if (!drawerSelectedElement) return;
    syncDrawerFromElement(drawerSelectedElement);
  };

  const updateDiagram = (
    diagramId: string,
    next: Diagram,
    options?: { transient?: boolean; historyKey?: string },
  ) => {
    applyChange((current) => {
      const normalized = normalizeDiagram(next);
      const diagrams = current.diagrams.diagrams.map((diagram) =>
        diagram.id === diagramId ? normalized : normalizeDiagram(diagram),
      );
      return {
        ...current,
        manifest: { ...current.manifest, updatedAt: new Date().toISOString() },
        diagrams: { diagrams },
      };
    }, options);
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

  const renameWorkspace = (nextName: string) => {
    if (!payload) return;
    const trimmed = nextName.trim();
    if (!trimmed) {
      setWorkspaceNameDraft(payload.manifest.name);
      return;
    }
    if (trimmed === payload.manifest.name) {
      setWorkspaceNameDraft(trimmed);
      return;
    }
    const timestamp = new Date().toISOString();
    setWorkspaceNameDraft(trimmed);
    applyChange((current) => ({
      ...current,
      manifest: { ...current.manifest, name: trimmed, updatedAt: timestamp },
    }));
    setWorkspaces((list) =>
      list.map((workspace) =>
        workspace.id === payload.manifest.id ? { ...workspace, name: trimmed, updatedAt: timestamp } : workspace,
      ),
    );
    void refreshWorkspaces();
  };

  const editableSnippetForElement = (element: Element) => {
    const stereotypes = element.stereotypes?.join(', ') ?? '';
    const tags = Object.entries(element.tags ?? {})
      .map(([key, value]) => `${key}=${value}`)
      .join(', ');
    return `name: ${element.name}\ndoc: ${element.documentation ?? ''}\nstereotypes: ${stereotypes}\ntags: ${tags}`;
  };

  const parseEditableSnippet = (snippet: string) => {
    const result: { name: string; doc: string; stereotypes: string[]; tags: Record<string, string> } = {
      name: '',
      doc: '',
      stereotypes: [],
      tags: {},
    };
    snippet
      .split('\n')
      .map((line) => line.trim())
      .forEach((line) => {
        if (!line) return;
        const [rawKey, ...rawValue] = line.split(':');
        if (!rawKey || rawValue.length === 0) return;
        const key = rawKey.trim().toLowerCase();
        const value = rawValue.join(':').trim();
        if (key === 'name') {
          result.name = value;
        } else if (key === 'doc') {
          result.doc = value;
        } else if (key === 'stereotypes') {
          result.stereotypes = value ? value.split(',').map((item) => item.trim()).filter(Boolean) : [];
        } else if (key === 'tags') {
          if (!value) {
            result.tags = {};
            return;
          }
          value.split(',').forEach((pair) => {
            const [rawTagKey, rawTagValue] = pair.split('=');
            const tagKey = rawTagKey?.trim();
            const tagValue = rawTagValue?.trim();
            if (tagKey && tagValue !== undefined) {
              result.tags[tagKey] = tagValue;
            } else {
              throw new Error(`Malformed tag entry: ${pair}`);
            }
          });
        }
      });
    if (!result.name) {
      throw new Error('name is required in the editable block');
    }
    return result;
  };

  const drawerCanonicalSnippet = useMemo(
    () => (drawerSelectedElement ? editableSnippetForElement(drawerSelectedElement) : ''),
    [drawerSelectedElement],
  );

  const draftParse = useMemo(() => {
    if (!drawerSelectedElement) {
      return { parsed: null, error: null } as const;
    }
    try {
      return { parsed: parseEditableSnippet(codeDraft), error: null } as const;
    } catch (error) {
      return { parsed: null, error: error instanceof Error ? error.message : String(error) } as const;
    }
  }, [codeDraft, drawerSelectedElement]);

  const draftParsed = draftParse.parsed;
  const draftParseError = draftParse.error;
  const drawerError = codeError ?? draftParseError;
  const canApplyCodeDraft = !!(drawerSelectedElement && isCodeDirty && !draftParseError && !codeError);

  useEffect(() => {
    if (!codeDrawerOpen) return;
    if (!drawerSelectedElement) {
      setExternalModelChange(false);
      return;
    }

    if (isCodeDirty) {
      setExternalModelChange(drawerCanonicalSnippet !== codeBaseSnippet);
    } else if (drawerCanonicalSnippet !== codeBaseSnippet) {
      syncDrawerFromElement(drawerSelectedElement);
    } else {
      setExternalModelChange(false);
    }
  }, [
    codeBaseSnippet,
    codeDrawerOpen,
    drawerCanonicalSnippet,
    drawerSelectedElement,
    isCodeDirty,
    modelRevision,
    syncDrawerFromElement,
  ]);

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
      selectWorkspace(manifest.id);
      setBanner(null);
      setStatus('Ready');
    } catch (error) {
      console.error(error);
      setBanner({ kind: 'error', messages: [error instanceof Error ? error.message : String(error)] });
      setStatus('Unable to create workspace');
    }
  };

  const removeWorkspace = async (id: string, name: string) => {
    if (!window.confirm(`Delete workspace "${name}"? This cannot be undone.`)) return;
    setDeletingWorkspaceId(id);
    try {
      setStatus(`Deleting workspace "${name}"...`);
      await deleteJson(`/api/workspaces/${id}`);
      if (activeId === id) {
        resetToLanding();
      }
      await refreshWorkspaces();
      showToast(`Deleted workspace "${name}"`, 'info');
      setStatus('Ready');
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      setBanner({ kind: 'error', messages: ['Unable to delete workspace', message] });
      setStatus('Unable to delete workspace');
    } finally {
      setDeletingWorkspaceId(null);
    }
  };

  const loadExampleWorkspace = async () => {
    setLoadingExample(true);
    try {
      setStatus('Loading example workspace...');
      const validated = validateWorkspaceFiles(exampleWorkspace as WorkspaceFiles);
      const response = await postJson<{ manifest: WorkspaceManifest }>('/api/workspaces/import', {
        workspace: validated,
      });
      await refreshWorkspaces();
      selectWorkspace(response.manifest.id);
      setBanner(null);
      setStatus('Ready');
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      setBanner({ kind: 'error', messages: ['Unable to load example workspace', message] });
      setStatus('Example load failed');
    } finally {
      setLoadingExample(false);
    }
  };

  const openSampleWorkspace = async () => {
    setStatus('Opening sample BDD workspace...');
    setBanner(null);
    await refreshWorkspaces();
    selectWorkspace('bdd-sample');
  };

  const handleImportWorkspace = async (file: File) => {
    setImportingWorkspace(true);
    try {
      setStatus('Importing workspace...');
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (parsed?.type === 'sysmlv2-json') {
        throw new Error('This file is a SysML v2 bundle. Use the SysML import option instead.');
      }
      const candidate = (parsed as { workspace?: WorkspaceFiles }).workspace ?? parsed;
      const validated = validateWorkspaceFiles(candidate as WorkspaceFiles);
      const response = await postJson<{ manifest: WorkspaceManifest }>(
        '/api/workspaces/import',
        { workspace: validated },
      );
      await refreshWorkspaces();
      selectWorkspace(response.manifest.id);
      setBanner(null);
      setStatus('Ready');
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      setBanner({ kind: 'error', messages: ['Import failed', message] });
      setStatus('Import failed');
    } finally {
      setImportingWorkspace(false);
    }
  };

  const handleImportSysml = async (file: File) => {
    setImportingSysml(true);
    try {
      setStatus('Importing SysML v2 JSON...');
      const text = await file.text();
      const parsed = JSON.parse(text);
      const payload = parsed?.type === 'sysmlv2-json' ? parsed : { ...parsed, type: 'sysmlv2-json' };
      const response = await postJson<{ manifest: WorkspaceManifest }>('/api/workspaces/import', payload);
      await refreshWorkspaces();
      selectWorkspace(response.manifest.id);
      setBanner(null);
      setStatus('Ready');
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      setBanner({ kind: 'error', messages: ['SysML import failed', message] });
      setStatus('SysML import failed');
    } finally {
      setImportingSysml(false);
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

  const handleExportSysml = async () => {
    if (!payload) return;
    try {
      setStatus('Exporting SysML v2 JSON...');
      const sysmlBundle = await getJson<SysmlV2Json & WorkspaceFiles>(
        '/api/workspaces/current/export?type=sysmlv2-json',
      );
      const blob = new Blob([JSON.stringify(sysmlBundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${sysmlBundle.manifest.id}-sysmlv2.json`;
      link.click();
      URL.revokeObjectURL(url);
      setStatus('Ready');
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      setBanner({ kind: 'error', messages: ['SysML export failed', message] });
      setStatus('SysML export failed');
    }
  };

  const createElement = (metaclass: 'Package' | 'Block', ownerOverride?: string | null) => {
    if (!payload) return;
    const now = new Date().toISOString();
    const ownerId = ownerOverride ?? selectContainerId(selection?.kind === 'element' ? selection.id : undefined);
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
    return element.id;
  };

  const createPort = (ownerId: string) => {
    if (!payload) return;
    const now = new Date().toISOString();
    const name = dedupeName('Port', ownerId);
    const element: Element = {
      id: crypto.randomUUID(),
      metaclass: 'Port',
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
    return element.id;
  };

  const createPart = (ownerBlockId: string, typeBlockId?: string) => {
    if (!payload) return;
    const owner = elementsById[ownerBlockId];
    if (!owner || owner.metaclass !== 'Block') return;
    const now = new Date().toISOString();
    const type = typeBlockId ? elementsById[typeBlockId] : owner;
    const safeTypeId = type?.metaclass === 'Block' ? type.id : ownerBlockId;
    const baseName = type?.metaclass === 'Block' ? `${type.name}Part` : 'Part';
    const name = dedupeName(baseName, ownerBlockId);
    const element: Element = {
      id: crypto.randomUUID(),
      metaclass: 'Part',
      name,
      ownerId: ownerBlockId,
      typeId: safeTypeId,
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
    return element;
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
      payload.model.relationships.filter((rel) => relationshipTouchesElements(rel, toDelete)).map((rel) => rel.id),
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
      return normalizeDiagram({ ...diagram, nodes: remainingNodes, edges: remainingEdges });
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

  const ensureNodeInDiagram = (
    diagram: Diagram,
    elementId: string,
    position?: { x: number; y: number },
  ) => {
    if (!isBddDiagram(diagram)) {
      return { diagram, nodeId: elementId };
    }
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
      kind: 'Element',
      x: position?.x ?? view.panX + 400 + offset,
      y: position?.y ?? view.panY + 240 + offset,
      w: 180,
      h: 100,
      compartments: { collapsed: false, showParts: true, showPorts: true },
      style: { highlight: false },
    } as Diagram['nodes'][number];
    return { diagram: { ...diagram, nodes: [...diagram.nodes, node] }, nodeId: node.id };
  };

  const addPortToIbdDiagram = (
    diagram: Diagram,
    portId: string,
    options?: { select?: boolean; position?: { x: number; y: number } },
  ) => {
    if (!payload || !isIbdDiagram(diagram)) return;
    const port = elementsById[portId];
    if (!port || port.metaclass !== 'Port') return;

    const anchor = (() => {
      const owner = port.ownerId ? elementsById[port.ownerId] : undefined;
      if (!owner) return null;
      if (owner.metaclass === 'Block' && owner.id === diagram.contextBlockId) {
        return { owner, rect: IBD_FRAME } as const;
      }
      if (owner.metaclass === 'Part') {
        const owningNode = diagram.nodes.find((node) => {
          const nodeKind = node.kind ?? (node.placement ? 'Port' : 'Element');
          return nodeKind === 'Part' && node.elementId === owner.id;
        });
        if (!owningNode) return null;
        return { owner, rect: { x: owningNode.x, y: owningNode.y, w: owningNode.w, h: owningNode.h } } as const;
      }
      return null;
    })();

    if (!anchor) {
      showToast('Add the owning part to this diagram before placing its port', 'error');
      return;
    }

    const existing = diagram.nodes.find((node) => node.elementId === portId);
    if (existing) {
      if (options?.select !== false) {
        selectElement(portId);
        setSelectedNodeIds([existing.id]);
      }
      return existing.id;
    }

    const sides: Array<'N' | 'E' | 'S' | 'W'> = ['N', 'E', 'S', 'W'];
    const nodesForOwner = diagram.nodes.filter((node) => {
      const nodeKind = node.kind ?? (node.placement ? 'Port' : 'Element');
      if (nodeKind !== 'Port') return false;
      const nodeElement = elementsById[node.elementId];
      return nodeElement?.ownerId === anchor.owner.id;
    });
    const counts = sides.map((side) => nodesForOwner.filter((node) => node.placement?.side === side).length);

    const defaultSide = () => {
      const minCount = Math.min(...counts);
      const sideIndex = Math.max(0, counts.indexOf(minCount));
      return sides[sideIndex];
    };

    const derivePlacementFromPosition = () => {
      if (!options?.position) return null;
      const { x, y } = options.position;
      const rect = anchor.rect;
      const clampedX = Math.min(Math.max(x, rect.x), rect.x + rect.w);
      const clampedY = Math.min(Math.max(y, rect.y), rect.y + rect.h);
      const distances = [
        { side: 'N' as const, distance: Math.abs(clampedY - rect.y) },
        { side: 'S' as const, distance: Math.abs(clampedY - (rect.y + rect.h)) },
        { side: 'W' as const, distance: Math.abs(clampedX - rect.x) },
        { side: 'E' as const, distance: Math.abs(clampedX - (rect.x + rect.w)) },
      ];
      const closest = distances.reduce((best, candidate) =>
        candidate.distance < best.distance ? candidate : best,
      );
      const offset =
        closest.side === 'N' || closest.side === 'S'
          ? (clampedX - rect.x) / rect.w
          : (clampedY - rect.y) / rect.h;
      return { side: closest.side, offset };
    };

    const placementFromPosition = derivePlacementFromPosition();
    const side = placementFromPosition?.side ?? defaultSide();
    const countForSide = counts[sides.indexOf(side)] ?? 0;
    const offset =
      placementFromPosition?.offset ?? (countForSide === 0 ? 0.25 : Math.min(0.9, (countForSide + 1) / (countForSide + 2)));
    const placement = { side, offset } as const;

    const node = {
      id: crypto.randomUUID(),
      elementId: portId,
      kind: 'Port',
      x: 0,
      y: 0,
      w: 32,
      h: 24,
      placement,
      compartments: { collapsed: true, showPorts: false, showParts: false },
      style: { highlight: false },
    } as Diagram['nodes'][number];

    const nextDiagram = { ...diagram, nodes: [...diagram.nodes, node] };
    updateDiagram(diagram.id, nextDiagram);
    if (options?.select !== false) {
      selectElement(portId);
      setSelectedNodeIds([node.id]);
    }
    return node.id;
  };

  const addPartToIbdDiagram = (
    diagram: Diagram,
    partId: string,
    options?: { select?: boolean; position?: { x: number; y: number }; partElement?: Element },
  ) => {
    if (!payload || !isIbdDiagram(diagram)) return;
    const part = options?.partElement ?? elementsById[partId];
    if (!part || part.metaclass !== 'Part' || part.ownerId !== diagram.contextBlockId) return;

    const existing = diagram.nodes.find((node) => node.elementId === partId);
    if (existing) {
      if (options?.select !== false) {
        selectElement(partId);
        setSelectedNodeIds([existing.id]);
      }
      return existing.id;
    }

    const offset = 32 + (ibdPartOffset.current % 5) * 18;
    ibdPartOffset.current += 1;
    const baseX = options?.position?.x ?? IBD_FRAME.x + IBD_FRAME.w / 2 - 90 + offset;
    const baseY = options?.position?.y ?? IBD_FRAME.y + IBD_FRAME.h / 2 - 50 + offset;
    const maxX = IBD_FRAME.x + IBD_FRAME.w - 180;
    const maxY = IBD_FRAME.y + IBD_FRAME.h - 100;
    const clampedX = Math.min(Math.max(baseX, IBD_FRAME.x), maxX);
    const clampedY = Math.min(Math.max(baseY, IBD_FRAME.y), maxY);
    const node = {
      id: crypto.randomUUID(),
      elementId: partId,
      kind: 'Part',
      x: clampedX,
      y: clampedY,
      w: 180,
      h: 100,
      compartments: { collapsed: false, showParts: true, showPorts: true },
      style: { highlight: false },
    } as Diagram['nodes'][number];

    const nextDiagram = { ...diagram, nodes: [...diagram.nodes, node] };
    updateDiagram(diagram.id, nextDiagram);
    if (options?.select !== false) {
      selectElement(partId);
      setSelectedNodeIds([node.id]);
    }
    return node.id;
  };

  const addToDiagram = (elementId: string, options?: { select?: boolean; position?: { x: number; y: number } }) => {
    if (!payload || !activeDiagram) return;
    if (isIbdDiagram(activeDiagram)) {
      const element = elementsById[elementId];
      if (!element || !belongsToContextBlock(element, activeDiagram.contextBlockId)) return;
      if (element.metaclass === 'Port') {
        return addPortToIbdDiagram(activeDiagram, elementId, options);
      }
      if (element.metaclass === 'Part') {
        return addPartToIbdDiagram(activeDiagram, elementId, options);
      }
      return;
    }
    const existingNode = activeDiagram.nodes.find((node) => node.elementId === elementId);
    if (existingNode) {
      if (options?.select !== false) {
        selectElement(elementId);
        setSelectedNodeIds([existingNode.id]);
      }
      return existingNode.id;
    }
    const targetPosition = options?.position ?? lastDiagramPositionRef.current;
    const result = ensureNodeInDiagram(activeDiagram, elementId, targetPosition ?? undefined);
    if (result.diagram !== activeDiagram) {
      updateDiagram(activeDiagram.id, result.diagram);
    }
    if (options?.select !== false) {
      selectElement(elementId);
      setSelectedNodeIds([result.nodeId]);
    }
    return result.nodeId;
  };

  const createBddDiagram = (ownerId: string | null, baseName = 'New Diagram') => {
    if (!payload) return;
    const now = new Date().toISOString();
    const name = dedupeName(baseName, ownerId);
    const diagram = normalizeDiagram({
      id: crypto.randomUUID(),
      name,
      kind: 'BDD',
      type: 'BDD',
      ownerId,
      nodes: [],
      edges: [],
      viewSettings: { gridEnabled: true, snapEnabled: true, zoom: 1, panX: 0, panY: 0 },
    } as Diagram);

    applyChange((current) => ({
      ...current,
      manifest: { ...current.manifest, updatedAt: now },
      diagrams: { diagrams: [...current.diagrams.diagrams.map(normalizeDiagram), diagram] },
    }));

    setActiveDiagramId(diagram.id);
    setSelectedNodeIds([]);
    return diagram.id;
  };

  const diagramOwnerForNewDiagram = () =>
    selectContainerId(selection?.kind === 'element' ? selection.id : activeDiagram?.ownerId ?? undefined) ?? null;

  const handleCreateBddFromMenu = () => {
    runSafely('Create BDD diagram', () => {
      const ownerId = diagramOwnerForNewDiagram();
      createBddDiagram(ownerId);
      setDiagramMenuOpen(false);
    });
  };

  const handleCreateIbdFromMenu = () => {
    runSafely('Create IBD diagram', () => {
      if (!selectedElement || selectedElement.metaclass !== 'Block') {
        setDiagramMenuOpen(false);
        return;
      }
      createIbdDiagramForBlock(selectedElement);
      setDiagramMenuOpen(false);
    });
  };

  const handleDropElement = (payload: DraggedElementPayload, position: { x: number; y: number }) => {
    runSafely('Drop onto diagram', () => {
      if (!payload?.elementId || !activeDiagram) return;
      const element = elementsById[payload.elementId];
      if (!element) {
        showToast('Dropped element not found', 'error');
        return;
      }

      if (isBddDiagram(activeDiagram)) {
        const existing = activeDiagram.nodes.find((node) => node.elementId === element.id);
        if (existing) {
          setSelectedNodeIds([existing.id]);
          selectElement(element.id);
          showToast('Element already present in diagram');
          return;
        }
        const result = ensureNodeInDiagram(activeDiagram, element.id, position);
        updateDiagram(activeDiagram.id, result.diagram);
        setSelectedNodeIds([result.nodeId]);
        selectElement(element.id);
        return;
      }

      if (isIbdDiagram(activeDiagram)) {
        if (!belongsToContextBlock(element, activeDiagram.contextBlockId)) {
          showToast('Only parts or ports owned by the context block can be dropped here', 'error');
          return;
        }
        if (element.metaclass === 'Part') {
          const id = addPartToIbdDiagram(activeDiagram, element.id, { select: true, position });
          if (!id) {
            showToast('Unable to place part on this diagram', 'error');
          }
          return;
        }
        if (element.metaclass === 'Port') {
          const id = addPortToIbdDiagram(activeDiagram, element.id, { select: true, position });
          if (!id) {
            showToast('Unable to place port on this diagram', 'error');
          }
          return;
        }
        showToast('Only parts or ports can be dropped on an IBD', 'error');
      }
    });
  };

  const handleCanvasContextMenu = (payload: {
    clientX: number;
    clientY: number;
    position: { x: number; y: number };
  }) => {
    const position = clampMenuPosition('canvas', payload.clientX, payload.clientY);
    lastDiagramPositionRef.current = payload.position;
    setContextMenu({ kind: 'canvas', x: position.x, y: position.y, position: payload.position });
  };

  const handlePartContextMenu = (payload: {
    elementId: string;
    clientX: number;
    clientY: number;
    position: { x: number; y: number };
  }) => {
    const position = clampMenuPosition('part', payload.clientX, payload.clientY);
    setContextMenu({
      kind: 'part',
      x: position.x,
      y: position.y,
      elementId: payload.elementId,
      position: payload.position,
    });
  };

  const diagramCenterPosition = useCallback(() => {
    if (!activeDiagram) return undefined;
    const view = activeDiagram.viewSettings;
    const container = document.querySelector('.diagram-wrapper') as HTMLElement | null;
    const width = container?.clientWidth ?? window.innerWidth;
    const height = container?.clientHeight ?? window.innerHeight;
    return {
      x: view.panX + width / (2 * view.zoom),
      y: view.panY + height / (2 * view.zoom),
    };
  }, [activeDiagram]);

  const findIbdForBlock = (blockId: string) =>
    payload?.diagrams.diagrams.find(
      (diagram) => diagramKindOf(diagram) === 'IBD' && diagram.contextBlockId === blockId,
    );

  const createIbdDiagramForBlock = (block: Element) => {
    if (!payload) return;
    const existing = findIbdForBlock(block.id);
    if (existing) {
      setActiveDiagramId(existing.id);
      return existing.id;
    }
    const now = new Date().toISOString();
    const baseName = `${block.name} IBD`;
    const name = dedupeName(baseName, block.ownerId ?? null);
    const diagram = normalizeDiagram({
      id: crypto.randomUUID(),
      name,
      kind: 'IBD',
      type: 'IBD',
      contextBlockId: block.id,
      ownerId: block.ownerId,
      nodes: [],
      edges: [],
      viewSettings: { gridEnabled: true, snapEnabled: true, zoom: 1, panX: 0, panY: 0 },
    } as Diagram);

    applyChange((current) => ({
      ...current,
      manifest: { ...current.manifest, updatedAt: now },
      diagrams: { diagrams: [...current.diagrams.diagrams.map(normalizeDiagram), diagram] },
    }));
    setActiveDiagramId(diagram.id);
    setSelectedNodeIds([]);
    selectElement(block.id);
    return diagram.id;
  };

  const createRelationship = (type: Relationship['type'], sourceId: string, targetId: string) => {
    if (!payload || type === 'Connector') return;
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
        const normalizedDiagram = normalizeDiagram(diagram);
        if (!activeDiagramId || normalizedDiagram.id !== activeDiagramId || !isBddDiagram(normalizedDiagram))
          return normalizedDiagram;
        let nextDiagram = diagram;
        const sourceResult = ensureNodeInDiagram(nextDiagram, sourceId);
        nextDiagram = sourceResult.diagram;
        const targetResult = ensureNodeInDiagram(nextDiagram, targetId);
        nextDiagram = targetResult.diagram;
        const hasEdge = nextDiagram.edges.some((edge) => edge.relationshipId === relationship.id);
        if (hasEdge) return normalizeDiagram(nextDiagram);
        const edge = {
          id: crypto.randomUUID(),
          relationshipId: relationship.id,
          sourceNodeId: sourceResult.nodeId,
          targetNodeId: targetResult.nodeId,
          routingPoints: [],
          label: type,
        } as Diagram['edges'][number];
        return normalizeDiagram({ ...nextDiagram, edges: [...nextDiagram.edges, edge] });
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

  const createConnector = (sourcePortId: string, targetPortId: string, diagram?: Diagram) => {
    if (!payload || !diagram || !isIbdDiagram(diagram)) return;
    const now = new Date().toISOString();
    const relationship: Relationship = {
      id: crypto.randomUUID(),
      type: 'Connector',
      sourcePortId,
      targetPortId,
    };

    const addConnector = (current: WorkspacePayload): WorkspacePayload => {
      const diagrams = current.diagrams.diagrams.map((existing) => {
        const normalizedDiagram = normalizeDiagram(existing);
        if (normalizedDiagram.id !== diagram.id || !isIbdDiagram(normalizedDiagram)) return normalizedDiagram;

        const sourceNode = normalizedDiagram.nodes.find((node) => node.elementId === sourcePortId);
        const targetNode = normalizedDiagram.nodes.find((node) => node.elementId === targetPortId);
        if (!sourceNode || !targetNode) return normalizedDiagram;
        const hasEdge = normalizedDiagram.edges.some((edge) => edge.relationshipId === relationship.id);
        if (hasEdge) return normalizedDiagram;
        const edge = {
          id: crypto.randomUUID(),
          relationshipId: relationship.id,
          sourceNodeId: sourceNode.id,
          targetNodeId: targetNode.id,
          routingPoints: [],
          label: 'Connector',
        } as Diagram['edges'][number];
        return normalizeDiagram({ ...normalizedDiagram, edges: [...normalizedDiagram.edges, edge] });
      });
      const existingRelationships = current.model.relationships as Relationship[];
      const relationships = [...existingRelationships, relationship];

      return {
        ...current,
        manifest: { ...current.manifest, updatedAt: now },
        model: { ...current.model, relationships } as ModelFile,
        diagrams: { diagrams } as DiagramsFile,
      } as WorkspacePayload;
    };

    applyChange(addConnector);

    selectRelationship(relationship.id);
    setPendingConnectorPortId(null);
  };

  const handlePortSelect = (portId: string, nodeId: string) => {
    runSafely('Connect ports', () => {
      selectElement(portId);
      setSelectedNodeIds([nodeId]);
      if (connectMode && activeDiagram && isIbdDiagram(activeDiagram)) {
        if (pendingConnectorPortId && pendingConnectorPortId !== portId) {
          createConnector(pendingConnectorPortId, portId, activeDiagram);
          setConnectMode(false);
        } else {
          setPendingConnectorPortId(portId);
        }
      } else {
        setPendingConnectorPortId(null);
      }
    });
  };

  const toggleConnectMode = () => {
    setConnectMode((current) => {
      const next = !current;
      if (!next) {
        setPendingConnectorPortId(null);
      }
      return next;
    });
  };

  const updateRelationship = (id: string, updates: Partial<Relationship>) => {
    applyChange((current: WorkspacePayload): WorkspacePayload => {
      const relationships = current.model.relationships.map((rel) =>
        rel.id === id ? ({ ...rel, ...updates } as Relationship) : rel,
      ) as Relationship[];
      return {
        ...current,
        manifest: { ...current.manifest, updatedAt: new Date().toISOString() },
        model: { ...current.model, relationships } as ModelFile,
      };
    });
  };

  const updateConnectorItemFlow = (connectorId: string, itemFlowLabel?: string) => {
    const normalized = itemFlowLabel?.trim() === '' ? undefined : itemFlowLabel?.trim();
    applyChange((current: WorkspacePayload): WorkspacePayload => {
      let changed = false;
      const relationships = current.model.relationships.map((rel) => {
        if (rel.id !== connectorId || rel.type !== 'Connector') return rel;
        if (rel.itemFlowLabel === normalized) return rel;
        changed = true;
        return { ...rel, itemFlowLabel: normalized } as Relationship;
      }) as Relationship[];
      if (!changed) return current;
      return {
        ...current,
        manifest: { ...current.manifest, updatedAt: new Date().toISOString() },
        model: { ...current.model, relationships } as ModelFile,
      };
    });
    selectRelationship(connectorId);
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
    const edgeCount = activeDiagram.edges.filter(
      (edge) => toDelete.has(edge.sourceNodeId) || toDelete.has(edge.targetNodeId),
    ).length;
    if (selectedNodeIds.length > 1 || edgeCount > 0) {
      const nodeLabel = `${selectedNodeIds.length} node${selectedNodeIds.length === 1 ? '' : 's'}`;
      const connectorLabel = edgeCount ? ` and ${edgeCount} connector${edgeCount === 1 ? '' : 's'}` : '';
      if (!window.confirm(`Delete ${nodeLabel}${connectorLabel}?`)) {
        return;
      }
    }
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
    if (!activeDiagram || !isBddDiagram(activeDiagram) || selectedNodeIds.length === 0) return;
    clipboardNodesRef.current = activeDiagram.nodes
      .filter((node) => selectedNodeIds.includes(node.id))
      .map((node) => ({ ...node }));
  };

  const pasteNodes = () => {
    if (!payload || !activeDiagram || !isBddDiagram(activeDiagram)) return;
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

  const resetActiveRouting = () => {
    if (!activeDiagram) return;
    const edges = activeDiagram.edges.map((edge) => ({ ...edge, routingPoints: [] }));
    updateDiagram(activeDiagram.id, { ...activeDiagram, edges });
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

  const handleSysmlImportChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = '';
    handleImportSysml(file);
  };

  const triggerSysmlImport = () => {
    sysmlImportInputRef.current?.click();
  };

  const handleSave = useCallback(
    async (options?: { auto?: boolean }) => {
      if (!payload) return;
      setSaving(true);
      setStatus('Saving...');
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
        setWorkspaces((list) =>
          list.map((workspace) =>
            workspace.id === next.manifest.id
              ? { ...workspace, name: next.manifest.name, updatedAt: next.manifest.updatedAt ?? workspace.updatedAt }
              : workspace,
          ),
        );
      } catch (error) {
        console.error(error);
        const message = error instanceof Error ? error.message : String(error);
        setStatus('Save failed');
        setAutosaveError(message);
        setBanner({ kind: 'error', messages: ['Save failed', message] });
        showToast(`Save failed: ${message}`, 'error');
        if (options?.auto) {
          setAutosaveEnabled(false);
        }
      } finally {
        setSaving(false);
      }
    },
    [payload, showToast],
  );

  const retrySave = useCallback(() => {
    void handleSave();
  }, [handleSave]);

  const landingSubtitle = loadingWorkspaces
    ? 'Loading workspaces...'
    : workspaces.length === 0
      ? 'No saved workspaces yet'
      : `${workspaces.length} available`;

  const lastSavedDisplay = useMemo(
    () =>
      lastSavedAt
        ? new Date(lastSavedAt).toLocaleTimeString([], {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })
        : null,
    [lastSavedAt],
  );

  const autosaveStatus = useMemo(() => {
    if (!payload) return 'No workspace loaded';
    if (autosaveError) return `Save failed: ${autosaveError}`;
    if (saving) return 'Saving...';
    if (dirty) return autosaveEnabled ? 'Autosave pending' : 'Unsaved changes';
    if (lastSavedDisplay) return `Saved at ${lastSavedDisplay}`;
    return 'No changes yet';
  }, [autosaveEnabled, autosaveError, dirty, lastSavedDisplay, payload, saving]);

  const canUndo = history.length > 0;
  const canRedo = redoStack.length > 0;

  useEffect(() => {
    if (!payload || !dirty || !autosaveEnabled || saving) return;
    const timer = window.setTimeout(() => {
      handleSave({ auto: true });
    }, AUTOSAVE_DELAY);
    return () => window.clearTimeout(timer);
  }, [autosaveEnabled, dirty, handleSave, payload, saving]);

  const contextMenuNode = (() => {
    if (!contextMenu) return null;
    if (contextMenu.kind === 'tree') {
      const target = elementsById[contextMenu.elementId];
      if (!target) return null;
      const ownerForElements =
        target.metaclass === 'Package' ? target.id : selectContainerId(target.id ?? undefined);
      const canCreatePackage = target.metaclass === 'Package';
      const canCreateBlock = target.metaclass === 'Package' || target.metaclass === 'Block';
      const canCreatePart = target.metaclass === 'Block';
      const canCreatePort = target.metaclass === 'Block' || target.metaclass === 'Part';
      const createPackage = () => {
        const id = createElement('Package', target.metaclass === 'Package' ? target.id : ownerForElements);
        if (id) {
          beginRename(id, 'tree');
        }
        setContextMenu(null);
      };
      const createBlock = () => {
        const id = createElement('Block', ownerForElements);
        if (id) {
          beginRename(id, 'tree');
        }
        setContextMenu(null);
      };
      const createPartHere = () => {
        const part = target.metaclass === 'Block' ? createPart(target.id) : undefined;
        if (part && activeDiagram && isIbdDiagram(activeDiagram) && activeDiagram.contextBlockId === target.id) {
          addPartToIbdDiagram(activeDiagram, part.id, { select: true, partElement: part });
        }
        if (part) {
          beginRename(part.id, 'tree');
        }
        setContextMenu(null);
      };
      const createPortHere = () => {
        if (target.metaclass !== 'Block' && target.metaclass !== 'Part') return;
        const portId = createPort(target.id);
        if (
          portId &&
          activeDiagram &&
          isIbdDiagram(activeDiagram) &&
          belongsToContextBlock(target, activeDiagram.contextBlockId)
        ) {
          addPortToIbdDiagram(activeDiagram, portId, { select: true });
        }
        if (portId) {
          beginRename(portId, 'tree');
        }
        setContextMenu(null);
      };
      const createTreeBdd = () => {
        createBddDiagram(ownerForElements ?? null, `${target.name} BDD`);
        setContextMenu(null);
      };
      const createTreeIbd = () => {
        if (target.metaclass !== 'Block') return;
        createIbdDiagramForBlock(target);
        setContextMenu(null);
      };
      const canAddTargetToDiagram =
        !!activeDiagram &&
        ((isIbdDiagram(activeDiagram) &&
          belongsToContextBlock(target, activeDiagram.contextBlockId) &&
          (target.metaclass === 'Part' || target.metaclass === 'Port')) ||
          isBddDiagram(activeDiagram));
      const addDisabledReason = !activeDiagram
        ? 'Open a diagram first'
        : !canAddTargetToDiagram
          ? 'Not compatible with this diagram'
          : '';
      const addTargetToDiagram = () => {
        addToDiagram(target.id, { position: diagramCenterPosition() });
        setContextMenu(null);
      };
      const openTargetProperties = () => {
        selectElement(target.id);
        setContextMenu(null);
      };
      const openTargetInDrawer = () => {
        openCodeDrawerForElement(target.id);
        setContextMenu(null);
      };
      const renameTarget = () => {
        beginRename(target.id, 'tree');
        setContextMenu(null);
      };
      const childCount = payload?.model.elements.filter((el) => el.ownerId === target.id).length ?? 0;
      const relationshipCount = relationshipsForElement(target).length;
      const deleteMessage =
        childCount || relationshipCount
          ? `Delete ${target.name}? This will remove ${childCount} child elements and ${relationshipCount} relationships.`
          : `Delete ${target.name}?`;
      const removeTarget = () => {
        if (childCount || relationshipCount) {
          if (!window.confirm(deleteMessage)) return;
        }
        deleteElement(target.id);
        setContextMenu(null);
      };
      return (
        <div
          className="context-menu"
          ref={contextMenuRef}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="context-menu__title">{target.name}</div>
          <div className="context-menu__group">
            <div className="context-menu__label">Create</div>
            {canCreatePackage ? (
              <button type="button" onClick={createPackage} className="context-menu__item">
                Package
              </button>
            ) : null}
            {canCreateBlock ? (
              <button type="button" onClick={createBlock} className="context-menu__item">
                Block
              </button>
            ) : null}
            <button
              type="button"
              onClick={createPartHere}
              className="context-menu__item"
              disabled={!canCreatePart}
              title={canCreatePart ? '' : 'Parts must belong to a Block'}
            >
              Part
            </button>
            <button
              type="button"
              onClick={createPortHere}
              className="context-menu__item"
              disabled={!canCreatePort}
              title={canCreatePort ? '' : 'Ports belong to Blocks or Parts'}
            >
              Port
            </button>
            <div className="context-menu__divider" />
            <button type="button" onClick={createTreeBdd} className="context-menu__item">
              BDD Diagram
            </button>
            <button
              type="button"
              onClick={createTreeIbd}
              className="context-menu__item"
              disabled={target.metaclass !== 'Block'}
              title={target.metaclass === 'Block' ? '' : 'IBDs require a Block context'}
            >
              IBD Diagram
            </button>
          </div>
          <div className="context-menu__group">
            <div className="context-menu__label">Diagram</div>
            <button
              type="button"
              onClick={addTargetToDiagram}
              className="context-menu__item"
              disabled={!canAddTargetToDiagram}
              title={addDisabledReason}
            >
              Add to current diagram
            </button>
            <button type="button" onClick={openTargetProperties} className="context-menu__item">
              Open in properties
            </button>
            <button type="button" onClick={openTargetInDrawer} className="context-menu__item">
              Show in code drawer
            </button>
          </div>
          <div className="context-menu__group">
            <div className="context-menu__label">Edit</div>
            <button type="button" onClick={renameTarget} className="context-menu__item">
              Rename
            </button>
            <button type="button" onClick={removeTarget} className="context-menu__item context-menu__item--danger">
              Delete
            </button>
          </div>
        </div>
      );
    }

    if (contextMenu.kind === 'part' && activeDiagram) {
      const target = elementsById[contextMenu.elementId];
      if (!target || target.metaclass !== 'Part') return null;
      const addPortHere = () => {
        if (!isIbdDiagram(activeDiagram) || activeDiagram.contextBlockId !== target.ownerId) {
          setContextMenu(null);
          return;
        }
        const portId = createPort(target.id);
        if (portId) {
          addPortToIbdDiagram(activeDiagram, portId, { select: true, position: contextMenu.position });
        }
        setContextMenu(null);
      };
      return (
        <div
          className="context-menu"
          ref={contextMenuRef}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="context-menu__title">{target.name}</div>
          <div className="context-menu__group">
            <div className="context-menu__label">Create</div>
            <button type="button" onClick={addPortHere} className="context-menu__item">
              Add port here
            </button>
          </div>
        </div>
      );
    }

    if (contextMenu.kind === 'canvas' && activeDiagram) {
      const createHere = () => {
        if (isBddDiagram(activeDiagram)) {
          const ownerId =
            selectContainerId(selection?.kind === 'element' ? selection.id : activeDiagram.ownerId ?? undefined) ??
            null;
          const elementId = createElement('Block', ownerId);
          if (elementId) {
            const result = ensureNodeInDiagram(activeDiagram, elementId, contextMenu.position);
            updateDiagram(activeDiagram.id, result.diagram);
            setSelectedNodeIds([result.nodeId]);
            selectElement(elementId);
            beginRename(elementId, 'canvas', { x: contextMenu.x, y: contextMenu.y });
          }
        } else if (isIbdDiagram(activeDiagram) && activeDiagram.contextBlockId) {
          const part = createPart(activeDiagram.contextBlockId);
          if (part) {
            addPartToIbdDiagram(activeDiagram, part.id, {
              select: true,
              position: contextMenu.position,
              partElement: part,
            });
            beginRename(part.id, 'canvas', { x: contextMenu.x, y: contextMenu.y });
          }
        }
        setContextMenu(null);
      };
      const canPasteHere = isBddDiagram(activeDiagram) && clipboardNodesRef.current.length > 0;
      const canResetRouting = activeDiagram.edges.some((edge) => edge.routingPoints?.length);
      const pasteHere = () => {
        pasteNodes();
        setContextMenu(null);
      };
      const resetHere = () => {
        resetActiveRouting();
        setContextMenu(null);
      };
      const toggleGrid = () => {
        updateDiagram(activeDiagram.id, {
          ...activeDiagram,
          viewSettings: { ...activeDiagram.viewSettings, gridEnabled: !activeDiagram.viewSettings.gridEnabled },
        });
        setContextMenu(null);
      };
      const toggleSnap = () => {
        updateDiagram(activeDiagram.id, {
          ...activeDiagram,
          viewSettings: { ...activeDiagram.viewSettings, snapEnabled: !activeDiagram.viewSettings.snapEnabled },
        });
        setContextMenu(null);
      };
      return (
        <div
          className="context-menu"
          ref={contextMenuRef}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="context-menu__group">
            <div className="context-menu__label">Create here…</div>
            <button type="button" onClick={createHere} className="context-menu__item">
              {isBddDiagram(activeDiagram) ? 'Block' : 'Part'}
            </button>
          </div>
          <div className="context-menu__group">
            <div className="context-menu__label">Clipboard</div>
            <button
              type="button"
              onClick={pasteHere}
              className="context-menu__item"
              disabled={!canPasteHere}
              title={canPasteHere ? '' : 'Copy something to paste'}
            >
              Paste
            </button>
          </div>
          <div className="context-menu__group">
            <div className="context-menu__label">View</div>
            <button
              type="button"
              onClick={resetHere}
              className="context-menu__item"
              disabled={!canResetRouting}
              title={canResetRouting ? '' : 'No routed edges to reset'}
            >
              Reset routing
            </button>
            <button type="button" onClick={toggleGrid} className="context-menu__item">
              {activeDiagram.viewSettings.gridEnabled ? 'Hide grid' : 'Show grid'}
            </button>
            <button type="button" onClick={toggleSnap} className="context-menu__item">
              {activeDiagram.viewSettings.snapEnabled ? 'Disable snap' : 'Enable snap'}
            </button>
          </div>
        </div>
      );
    }
    return null;
  })();

  const workspaceTitleNode = payload ? (
    <input
      className="workspace-title-input"
      value={workspaceNameDraft}
      aria-label="Workspace name"
      onChange={(event) => setWorkspaceNameDraft(event.target.value)}
      onBlur={() => renameWorkspace(workspaceNameDraft)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          renameWorkspace(workspaceNameDraft);
        }
        if (event.key === 'Escape') {
          setWorkspaceNameDraft(payload?.manifest.name ?? '');
        }
      }}
    />
  ) : (
    'Workspace overview'
  );

  return (
    <ErrorBoundary onReset={resetToLanding}>
      <div className="app">
        <Toolbar
          workspaces={workspaces}
          activeId={activeId}
          onChange={(id) => selectWorkspace(id || undefined)}
          status={status}
          onSave={payload ? handleSave : undefined}
          saving={saving}
          onCreateWorkspace={createWorkspace}
          onImportWorkspace={triggerImport}
          onImportSysml={triggerSysmlImport}
          onExportWorkspace={payload ? handleExportWorkspace : undefined}
          onExportSysml={payload ? handleExportSysml : undefined}
          autosaveEnabled={autosaveEnabled}
          autosaveStatus={autosaveStatus}
          autosaveStatusTitle={lastSavedDisplay ? `Last saved at ${lastSavedDisplay}` : undefined}
          autosaveError={autosaveError}
          onToggleAutosave={
            payload
              ? () => {
                  setAutosaveEnabled((value) => !value);
                  setAutosaveError(null);
                }
              : undefined
          }
          onRetrySave={retrySave}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={canUndo ? undo : undefined}
          onRedo={canRedo ? redo : undefined}
          connectMode={connectMode}
          canConnect={canUseConnectMode}
          onToggleConnectMode={canUseConnectMode ? toggleConnectMode : undefined}
          onShowShortcuts={() => setShortcutsOpen(true)}
        />
        <ToastStack toasts={toasts} onDismiss={dismissToast} />
        {shortcutsOpen ? (
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortcuts-title"
            onClick={() => setShortcutsOpen(false)}
          >
            <div className="modal__content" onClick={(event) => event.stopPropagation()}>
              <div className="modal__header">
                <h3 id="shortcuts-title">Keyboard shortcuts</h3>
                <button type="button" className="button button--ghost" onClick={() => setShortcutsOpen(false)}>
                  Close
                </button>
              </div>
              <div className="shortcuts-list" role="list">
                <div className="shortcuts-list__item" role="listitem">
                  <span>Undo</span>
                  <span>Ctrl/Cmd + Z</span>
                </div>
                <div className="shortcuts-list__item" role="listitem">
                  <span>Redo</span>
                  <span>Ctrl/Cmd + Shift + Z</span>
                </div>
                <div className="shortcuts-list__item" role="listitem">
                  <span>Delete selection</span>
                  <span>Delete / Backspace</span>
                </div>
                <div className="shortcuts-list__item" role="listitem">
                  <span>Copy / Paste</span>
                  <span>Ctrl/Cmd + C, Ctrl/Cmd + V</span>
                </div>
                <div className="shortcuts-list__item" role="listitem">
                  <span>Apply in code drawer</span>
                  <span>Ctrl/Cmd + Enter</span>
                </div>
              </div>
            </div>
          </div>
        ) : null}
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={handleImportInputChange}
        />
        <input
          ref={sysmlImportInputRef}
          type="file"
          accept="application/json,.json"
          style={{ display: 'none' }}
          onChange={handleSysmlImportChange}
        />
        {contextMenuNode}
        {renameState?.source === 'canvas' ? (
          <div className="canvas-rename" style={{ left: renameState.position.x, top: renameState.position.y }}>
            <input
              className="canvas-rename__input"
              value={renameState.draft}
              onChange={(event) => handleRenameChange(event.target.value)}
              onBlur={handleRenameCancel}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleRenameSubmit(renameState.draft);
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  handleRenameCancel();
                }
              }}
              autoFocus
            />
          </div>
        ) : null}
        {banner ? (
          <div className={`banner banner--${banner.kind}`}>
            {banner.messages.map((message) => (
              <div key={message}>{message}</div>
            ))}
            <div className="banner__actions">
              <button className="button button--ghost" type="button" onClick={resetToLanding}>
                Back to landing
              </button>
            </div>
          </div>
        ) : null}
        {payload ? (
          <>
            <div className="layout-controls" aria-label="Workspace layout controls">
              <div className="layout-controls__group">
                <span className="layout-controls__label">View</span>
                <button
                  type="button"
                  className={`chip-toggle chip-toggle--accent${canvasFocused ? ' chip-toggle--active' : ''}`}
                  onClick={() => {
                    if (canvasFocused) {
                      setShowContainment(true);
                      setShowPropertiesPanel(true);
                      return;
                    }
                    setShowContainment(false);
                    setShowPropertiesPanel(false);
                  }}
                >
                  {canvasFocused ? 'Restore panels' : 'Focus canvas'}
                </button>
              </div>
              <div className="layout-controls__hint">
                {canvasFocused
                  ? 'Canvas is expanded — use the edge chevrons to reopen containment and properties.'
                  : 'Use the < and > handles on the panel edges to collapse or reopen side panels.'}
              </div>
            </div>
            <main className="layout layout--three" style={{ gridTemplateColumns: layoutColumns }}>
              {showContainment ? (
                <div className="panel-with-toggle">
                  <Panel title="Containment" subtitle="Tree navigation inspired by Cameo">
                    <ModelBrowser
                      tree={tree}
                      search={search}
                      onSearch={setSearch}
                      selectedId={selectedElementId}
                      renamingId={renameState?.source === 'tree' ? renameState.targetId : undefined}
                      renameDraft={renameState?.source === 'tree' ? renameState.draft : undefined}
                      onRenameChange={handleRenameChange}
                      onRenameSubmit={handleRenameSubmit}
                      onRenameCancel={handleRenameCancel}
                      onSelect={selectElement}
                      disableActions={!payload}
                      onContextMenu={handleTreeContextMenu}
                    />
                  </Panel>
                  <button
                    type="button"
                    className="panel-toggle panel-toggle--right"
                    aria-label="Hide containment panel"
                    onClick={() => setShowContainment(false)}
                  >
                    ‹
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="panel-toggle panel-toggle--left panel-toggle--floating"
                  aria-label="Show containment panel"
                  onClick={() => setShowContainment(true)}
                >
                  ›
                </button>
              )}
              <Panel title={workspaceTitleNode} subtitle={payload?.manifest.description}>
                <p className="lede">
                  {payload
                    ? `${summary.elements} elements, ${summary.relationships} relationships, ${summary.diagrams} diagrams.`
                    : 'Select a workspace to explore its contents.'}
                </p>
                {activeDiagram ? (
                  <div className="diagram-wrapper">
                    <div className="diagram-header">
                      {diagramBreadcrumb ? <div className="diagram-breadcrumb">{diagramBreadcrumb}</div> : null}
                      <DiagramTabs
                        diagrams={payload?.diagrams.diagrams ?? []}
                        activeId={activeDiagramId}
                        onSelect={setActiveDiagramId}
                      />
                      <span className="diagram-meta">Type: {activeDiagramKind}</span>
                      {selectedNodeIds.length > 0 ? (
                        <span className="diagram-meta diagram-meta--count">{selectedNodeIds.length} selected</span>
                      ) : null}
                      <div className="diagram-actions" ref={diagramMenuRef}>
                        <button
                          type="button"
                          className="button button--ghost"
                          onClick={toggleCodeDrawer}
                          disabled={!payload}
                        >
                          {codeDrawerOpen ? 'Hide code' : 'Code'}
                        </button>
                        <button
                          type="button"
                          className="button button--ghost"
                          onClick={() => setDiagramMenuOpen((open) => !open)}
                        >
                          New diagram ▾
                        </button>
                        {diagramMenuOpen ? (
                          <div className="diagram-actions__menu">
                            <button type="button" className="diagram-actions__item" onClick={handleCreateBddFromMenu}>
                              Block Definition (BDD)
                            </button>
                            <button
                              type="button"
                              className="diagram-actions__item"
                              onClick={handleCreateIbdFromMenu}
                              disabled={!selectedElement || selectedElement.metaclass !== 'Block'}
                            >
                              Internal Block (IBD)
                            </button>
                          </div>
                        ) : null}
                      </div>
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
                      connectMode={connectMode}
                      onPortSelect={handlePortSelect}
                      onDropElement={handleDropElement}
                      onCanvasContextMenu={handleCanvasContextMenu}
                      onPartContextMenu={handlePartContextMenu}
                      onChange={(diagram, options) => updateDiagram(activeDiagram.id, diagram, options)}
                    />
                  </div>
                ) : (
                  <>
                    <div className="empty-state">No diagram open. Select or create a diagram to begin.</div>
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
                  </>
                )}
              </Panel>
              {showPropertiesPanel ? (
                <div className="panel-with-toggle panel-with-toggle--right">
                  <Panel
                    title="Properties"
                    subtitle={propertiesSubtitle}
                    actions={
                      <>
                        <button className="button button--ghost" type="button" onClick={toggleCodeDrawer} disabled={!selectedElement}>
                          {codeDrawerOpen ? 'Hide code' : 'Code'}
                        </button>
                        <button
                          className="button button--ghost"
                          type="button"
                          onClick={() => setPropertiesCollapsed((value) => !value)}
                        >
                          {propertiesCollapsed ? 'Show' : 'Hide'} properties
                        </button>
                      </>
                    }
                  >
                    {propertiesCollapsed ? (
                      <div className="empty-state">Properties hidden. Use the toggle above to reopen.</div>
                    ) : (
                      <PropertiesPanel
                        selection={selection}
                        element={selectedElement}
                        relationship={selectedRelationship}
                        elements={elementsById}
                        relatedRelationships={relatedRelationships}
                        metaclasses={metaclasses}
                        relationshipTypes={relationshipTypes}
                        relationshipCreationTypes={relationshipCreationTypes}
                        onSelect={setSelection}
                        onElementChange={(updates) => selectedElementId && updateElement(selectedElementId, updates)}
                        onRelationshipChange={(updates) =>
                          selectedRelationshipId && updateRelationship(selectedRelationshipId, updates)
                        }
                        onConnectorItemFlowChange={
                          selectedRelationship?.type === 'Connector'
                            ? (value) => updateConnectorItemFlow(selectedRelationship.id, value)
                            : undefined
                        }
                        onCreateRelationship={
                          selectedElement
                            ? (type, targetId) => createRelationship(type, selectedElement.id, targetId)
                            : undefined
                        }
                        onDeleteRelationship={handleDeleteRelationship}
                        onAddToDiagram={
                          selectedElementId && canAddElementToDiagram
                            ? () => addToDiagram(selectedElementId, { position: diagramCenterPosition() })
                            : undefined
                        }
                        onAddPort={
                          (selectedIsBlock || selectedIsPart) && selectedElement
                            ? () => createPort(selectedElement.id)
                            : undefined
                        }
                        onCreatePart={
                          selectedIsBlock &&
                          selectedElement &&
                          activeDiagram &&
                          isIbdDiagram(activeDiagram) &&
                          activeDiagram.contextBlockId
                            ? () => createPart(activeDiagram.contextBlockId!, selectedElement.id)
                            : undefined
                        }
                        onCreateIbd={
                          selectedIsBlock && selectedElement
                            ? () => createIbdDiagramForBlock(selectedElement)
                            : undefined
                        }
                      />
                    )}
                  </Panel>
                  <button
                    type="button"
                    className="panel-toggle panel-toggle--left"
                    aria-label="Hide properties panel"
                    onClick={() => setShowPropertiesPanel(false)}
                  >
                    ›
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="panel-toggle panel-toggle--right panel-toggle--floating"
                  aria-label="Show properties panel"
                  onClick={() => setShowPropertiesPanel(true)}
                >
                  ‹
                </button>
              )}
            </main>
          </>
        ) : (
        <main className="layout layout--landing">
          <Panel title="Welcome" subtitle="Open or import a workspace to begin">
            <p className="lede">No workspace is currently loaded.</p>
            <div className="landing__actions">
              <button
                className="button"
                type="button"
                onClick={loadExampleWorkspace}
                disabled={loadingExample}
              >
                {loadingExample ? 'Loading example…' : 'Load example workspace'}
              </button>
              <button
                className="button button--ghost"
                type="button"
                onClick={openSampleWorkspace}
                disabled={loadingWorkspaces}
              >
                {loadingWorkspaces ? 'Preparing sample…' : 'Open sample BDD'}
              </button>
              <button className="button button--ghost" type="button" onClick={createWorkspace} disabled={loadingWorkspaces}>
                Create new workspace
              </button>
              <button
                className="button button--ghost"
                type="button"
                onClick={triggerImport}
                disabled={importingWorkspace}
              >
                {importingWorkspace ? 'Importing…' : 'Open / Import'}
              </button>
              <button
                className="button button--ghost"
                type="button"
                onClick={triggerSysmlImport}
                disabled={importingSysml}
              >
                {importingSysml ? 'Importing…' : 'Import SysML v2'}
              </button>
            </div>
            <p className="hint">
              Load the curated example or bring your own bundle. Accepts workspace archives or SysML v2 JSON with model and
              diagram data.
            </p>
          </Panel>
          <Panel title="Available workspaces" subtitle={landingSubtitle}>
            <div className="landing__actions">
              <button
                className="button button--ghost"
                type="button"
                onClick={() => refreshWorkspaces()}
                disabled={loadingWorkspaces}
              >
                {loadingWorkspaces ? 'Refreshing…' : 'Refresh list'}
              </button>
            </div>
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
                    <div className="workspace-card__actions">
                      <button
                        className="button button--ghost"
                        type="button"
                        onClick={() => selectWorkspace(workspace.id)}
                      >
                        Open workspace
                      </button>
                      <button
                        className="button button--ghost button--danger"
                        type="button"
                        disabled={deletingWorkspaceId === workspace.id}
                        onClick={() => removeWorkspace(workspace.id, workspace.name)}
                      >
                        {deletingWorkspaceId === workspace.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </main>
      )}
        <SysmlDrawer
          open={codeDrawerOpen}
          element={drawerSelectedElement}
          dirty={isCodeDirty}
          canApply={canApplyCodeDraft}
          externalChange={externalModelChange}
          pendingElement={pendingDrawerSelection}
          pinned={codeDrawerPinned}
          preview={sysmlPreview}
          draft={codeDraft}
          error={drawerError}
          onPin={pinCodeDrawer}
          onUnpin={unpinCodeDrawer}
          onDraftChange={setCodeDraft}
          onApply={applyCodeDraft}
          onClose={requestCloseCodeDrawer}
          onKeepEditing={keepEditingDrawer}
          onDiscardAndSwitch={discardAndSwitchDrawer}
          onReloadFromModel={reloadDraftFromModel}
        />
      </div>
    </ErrorBoundary>
  );
}
