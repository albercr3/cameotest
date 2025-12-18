import { Element, Relationship, WorkspaceFiles } from './ir.js';

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  code:
    | 'duplicate-name'
    | 'port-signal-mismatch'
    | 'port-direction-conflict'
    | 'connector-port-missing'
    | 'connector-target-invalid'
    | 'diagram-node-missing'
    | 'diagram-edge-missing'
    | 'diagram-edge-mismatch'
    | 'requirement-untraced';
  message: string;
  severity: ValidationSeverity;
  elementId?: string;
  relationshipId?: string;
  diagramId?: string;
  nodeId?: string;
  edgeId?: string;
}

export interface ValidationResult {
  issues: ValidationIssue[];
}

function addIssue(list: ValidationIssue[], issue: ValidationIssue) {
  list.push(issue);
}

function elementOwnerName(element: Element | undefined, elements: Record<string, Element>) {
  if (!element?.ownerId) return 'root';
  return elements[element.ownerId]?.name ?? 'unknown owner';
}

function validateUniqueNames(workspace: WorkspaceFiles, issues: ValidationIssue[]) {
  const elementsById = Object.fromEntries(workspace.model.elements.map((el) => [el.id, el]));
  const grouped = new Map<string | null, Map<string, Element[]>>();
  workspace.model.elements.forEach((element) => {
    const ownerKey = element.ownerId ?? null;
    const nameKey = element.name.trim().toLowerCase();
    const byName = grouped.get(ownerKey) ?? new Map<string, Element[]>();
    const existing = byName.get(nameKey) ?? [];
    existing.push(element);
    byName.set(nameKey, existing);
    grouped.set(ownerKey, byName);
  });

  grouped.forEach((byName, ownerId) => {
    byName.forEach((elements, nameKey) => {
      if (elements.length <= 1) return;
      elements.forEach((element) => {
        const owner = element.ownerId ? elementsById[element.ownerId] : undefined;
        addIssue(issues, {
          code: 'duplicate-name',
          severity: 'error',
          elementId: element.id,
          message: `Duplicate name "${element.name}" under ${elementOwnerName(owner, elementsById)}.`,
        });
      });
    });
  });
}

function validateConnectorSignals(workspace: WorkspaceFiles, issues: ValidationIssue[]) {
  const elements = Object.fromEntries(workspace.model.elements.map((el) => [el.id, el]));
  workspace.model.relationships
    .filter((rel) => rel.type === 'Connector')
    .forEach((relationship) => {
      const source = elements[(relationship as Relationship & { sourcePortId: string }).sourcePortId];
      const target = elements[(relationship as Relationship & { targetPortId: string }).targetPortId];

      if (!source || !target) {
        addIssue(issues, {
          code: 'connector-port-missing',
          severity: 'error',
          relationshipId: relationship.id,
          message: 'Connector endpoints must reference existing ports.',
        });
        return;
      }

      if (source.metaclass !== 'Port' || target.metaclass !== 'Port') {
        addIssue(issues, {
          code: 'connector-target-invalid',
          severity: 'error',
          relationshipId: relationship.id,
          elementId: source.metaclass !== 'Port' ? source.id : target.id,
          message: 'Connectors can only link port elements.',
        });
        return;
      }

      const sourceSignal = source.signalTypeId;
      const targetSignal = target.signalTypeId;
      if (sourceSignal && targetSignal && sourceSignal !== targetSignal) {
        addIssue(issues, {
          code: 'port-signal-mismatch',
          severity: 'error',
          relationshipId: relationship.id,
          elementId: source.id,
          message: 'Connected ports must share the same signal type.',
        });
      }

      const sourceDir = source.direction;
      const targetDir = target.direction;
      if (sourceDir && targetDir && sourceDir !== 'inout' && targetDir !== 'inout' && sourceDir === targetDir) {
        addIssue(issues, {
          code: 'port-direction-conflict',
          severity: 'error',
          relationshipId: relationship.id,
          elementId: source.id,
          message: 'Connector directions should be complementary.',
        });
      }
    });
}

function validateRequirementTraces(workspace: WorkspaceFiles, issues: ValidationIssue[]) {
  if (!workspace.model.elements.some((el) => el.metaclass === 'Requirement')) return;
  const touched = new Set<string>();
  workspace.model.relationships.forEach((rel) => {
    if (rel.type === 'Connector') return;
    if ('sourceId' in rel && rel.sourceId) touched.add(rel.sourceId);
    if ('targetId' in rel && rel.targetId) touched.add(rel.targetId);
  });

  workspace.model.elements
    .filter((element) => element.metaclass === 'Requirement')
    .forEach((requirement) => {
      if (!touched.has(requirement.id)) {
        addIssue(issues, {
          code: 'requirement-untraced',
          severity: 'error',
          elementId: requirement.id,
          message: `Requirement "${requirement.name}" is not traced to any relationship.`,
        });
      }
    });
}

function validateDiagramConsistency(workspace: WorkspaceFiles, issues: ValidationIssue[]) {
  const elements = Object.fromEntries(workspace.model.elements.map((el) => [el.id, el]));
  const relationships = Object.fromEntries(workspace.model.relationships.map((rel) => [rel.id, rel]));

  workspace.diagrams.diagrams.forEach((diagram) => {
    const nodesById = new Map(diagram.nodes.map((node) => [node.id, node] as const));

    diagram.nodes.forEach((node) => {
      const element = elements[node.elementId];
      if (!element) {
        addIssue(issues, {
          code: 'diagram-node-missing',
          severity: 'error',
          diagramId: diagram.id,
          nodeId: node.id,
          message: 'Diagram node references a missing element.',
        });
        return;
      }

      if (node.kind === 'Port' && element.metaclass !== 'Port') {
        addIssue(issues, {
          code: 'diagram-node-missing',
          severity: 'error',
          diagramId: diagram.id,
          nodeId: node.id,
          elementId: element.id,
          message: 'Port nodes must reference port elements.',
        });
      }

      if (node.kind === 'Part' && element.metaclass !== 'Part') {
        addIssue(issues, {
          code: 'diagram-node-missing',
          severity: 'error',
          diagramId: diagram.id,
          nodeId: node.id,
          elementId: element.id,
          message: 'Part nodes must reference part elements.',
        });
      }
    });

    diagram.edges.forEach((edge) => {
      const relationship = relationships[edge.relationshipId];
      if (!relationship) {
        addIssue(issues, {
          code: 'diagram-edge-missing',
          severity: 'error',
          diagramId: diagram.id,
          edgeId: edge.id,
          message: 'Diagram edge references a missing relationship.',
        });
        return;
      }
      const sourceNode = nodesById.get(edge.sourceNodeId);
      const targetNode = nodesById.get(edge.targetNodeId);
      if (!sourceNode || !targetNode) {
        addIssue(issues, {
          code: 'diagram-edge-mismatch',
          severity: 'error',
          diagramId: diagram.id,
          edgeId: edge.id,
          relationshipId: relationship.id,
          message: 'Diagram edge endpoints must exist within the diagram.',
        });
        return;
      }

      if (relationship.type === 'Connector') {
        if (
          sourceNode.elementId !== (relationship as Relationship & { sourcePortId: string }).sourcePortId ||
          targetNode.elementId !== (relationship as Relationship & { targetPortId: string }).targetPortId
        ) {
          addIssue(issues, {
            code: 'diagram-edge-mismatch',
            severity: 'error',
            diagramId: diagram.id,
            edgeId: edge.id,
            relationshipId: relationship.id,
            message: 'Connector edges must align with the connected ports.',
          });
        }
      } else {
        const assoc = relationship as Relationship & { sourceId?: string; targetId?: string };
        if (assoc.sourceId && sourceNode.elementId !== assoc.sourceId) {
          addIssue(issues, {
            code: 'diagram-edge-mismatch',
            severity: 'error',
            diagramId: diagram.id,
            edgeId: edge.id,
            relationshipId: relationship.id,
            message: 'Edge source node does not match relationship source.',
          });
        }
        if (assoc.targetId && targetNode.elementId !== assoc.targetId) {
          addIssue(issues, {
            code: 'diagram-edge-mismatch',
            severity: 'error',
            diagramId: diagram.id,
            edgeId: edge.id,
            relationshipId: relationship.id,
            message: 'Edge target node does not match relationship target.',
          });
        }
      }
    });
  });
}

export function validateWorkspace(workspace: WorkspaceFiles): ValidationResult {
  const issues: ValidationIssue[] = [];
  validateUniqueNames(workspace, issues);
  validateConnectorSignals(workspace, issues);
  validateRequirementTraces(workspace, issues);
  validateDiagramConsistency(workspace, issues);
  return { issues };
}
