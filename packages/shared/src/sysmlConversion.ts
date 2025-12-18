import { z } from 'zod';

import {
  DiagramsFile,
  Diagram,
  DiagramEdge,
  DiagramNode,
  IR_VERSION,
  ModelFile,
  Relationship,
  SysmlV2Json,
  WorkspaceFiles,
  WorkspaceManifest,
  diagramEdgeSchema,
  diagramNodeSchema,
  diagramSchema,
  diagramsFileSchema,
  modelFileSchema,
  sysmlV2JsonSchema,
  validateWorkspaceFiles,
  workspaceManifestSchema,
} from './ir.js';

export const sysmlV2TextSchema = z
  .object({
    type: z.literal('sysmlv2-text'),
    version: z.string().default(IR_VERSION),
    manifest: workspaceManifestSchema.partial().optional(),
    text: z.string(),
  })
  .passthrough();

export type SysmlV2Text = z.infer<typeof sysmlV2TextSchema>;

export type SysmlFormat = 'sysmlv2-json' | 'sysmlv2-text';

interface ConversionOptions {
  schemaVersion?: string;
  manifestOverride?: WorkspaceManifest;
}

function asJsonString(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function formatLine(kind: string, fields: Record<string, unknown>) {
  const serialized = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${asJsonString(value) ?? 'null'}`)
    .join(' ');
  return `${kind} ${serialized}`.trim();
}

function parseValue(raw: string): unknown {
  if (raw === 'null') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  if (raw.startsWith('"') || raw.startsWith('{') || raw.startsWith('[')) {
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new Error(`Unable to parse value ${raw}: ${error}`);
    }
  }
  return raw;
}

function parseAssignments(segment: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const regex = /(\w+)=((?:\"[^\"]*\")|\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(segment)) !== null) {
    const [, key, value] = match;
    result[key] = parseValue(value);
  }
  return result;
}

function normalizeManifest(base: Partial<WorkspaceManifest> | undefined, override?: WorkspaceManifest) {
  const now = new Date().toISOString();
  const parsed = workspaceManifestSchema.partial().parse(base ?? {});
  const manifest = workspaceManifestSchema.parse({
    id: parsed.id ?? override?.id ?? 'sysmlv2-import',
    name: parsed.name ?? override?.name ?? parsed.id ?? 'Imported SysML v2 workspace',
    description: parsed.description ?? override?.description ?? 'Imported from SysML v2 payload',
    createdAt: parsed.createdAt ?? override?.createdAt ?? now,
    updatedAt: now,
    version: parsed.version ?? override?.version ?? 1,
  });
  return manifest;
}

function normalizeDiagrams(diagrams: DiagramsFile | undefined): DiagramsFile {
  if (!diagrams) return { diagrams: [] } satisfies DiagramsFile;
  const normalized = diagrams.diagrams.map((diagram) => diagramSchema.parse(diagram));
  return diagramsFileSchema.parse({ diagrams: normalized });
}

export function workspaceToSysmlV2Json(workspace: WorkspaceFiles, options?: ConversionOptions): SysmlV2Json {
  const version = options?.schemaVersion ?? IR_VERSION;
  const manifest = options?.manifestOverride ?? workspace.manifest;
  const diagrams = normalizeDiagrams(workspace.diagrams);
  return sysmlV2JsonSchema.parse({
    type: 'sysmlv2-json',
    version,
    manifest,
    model: modelFileSchema.parse(workspace.model),
    diagrams,
  });
}

export function sysmlV2JsonToWorkspace(
  bundle: SysmlV2Json,
  options?: { manifestOverride?: WorkspaceManifest },
): WorkspaceFiles {
  const manifest = normalizeManifest(bundle.manifest, options?.manifestOverride);
  return validateWorkspaceFiles({
    manifest,
    model: modelFileSchema.parse(bundle.model),
    diagrams: normalizeDiagrams(bundle.diagrams),
  });
}

export function workspaceToSysmlV2Text(
  workspace: WorkspaceFiles,
  options?: ConversionOptions,
): SysmlV2Text {
  const version = options?.schemaVersion ?? IR_VERSION;
  const manifest = options?.manifestOverride ?? workspace.manifest;
  const lines: string[] = [];
  lines.push(`# sysmlv2-text schema=${version}`);
  lines.push(formatLine('manifest', manifest));

  workspace.model.elements.forEach((element) => {
    lines.push(
      formatLine('element', {
        id: element.id,
        metaclass: element.metaclass,
        name: element.name,
        ownerId: element.ownerId,
        typeId: element.typeId,
        signalTypeId: element.signalTypeId,
        direction: element.direction,
        documentation: element.documentation,
        stereotypes: element.stereotypes,
        tags: element.tags,
        createdAt: element.createdAt,
        updatedAt: element.updatedAt,
      }),
    );
  });

  workspace.model.relationships.forEach((relationship) => {
    const base: Record<string, unknown> = {
      id: relationship.id,
      type: relationship.type,
    };
    if (relationship.type === 'Connector') {
      const connector = relationship as Relationship & { sourcePortId: string; targetPortId: string };
      lines.push(
        formatLine('relationship', {
          ...base,
          sourcePortId: connector.sourcePortId,
          targetPortId: connector.targetPortId,
          itemFlowLabel: connector.itemFlowLabel,
        }),
      );
    } else {
      const assoc = relationship as Relationship & { sourceId: string; targetId: string; properties?: Record<string, unknown> };
      lines.push(
        formatLine('relationship', {
          ...base,
          sourceId: assoc.sourceId,
          targetId: assoc.targetId,
          properties: assoc.properties,
        }),
      );
    }
  });

  workspace.diagrams.diagrams.forEach((diagram) => {
    lines.push(
      formatLine('diagram', {
        id: diagram.id,
        name: diagram.name,
        type: diagram.type,
        kind: diagram.kind,
        ownerId: diagram.ownerId,
        contextBlockId: diagram.contextBlockId,
        viewSettings: diagram.viewSettings,
      }),
    );

    diagram.nodes.forEach((node) => {
      lines.push(
        formatLine('node', {
          diagramId: diagram.id,
          id: node.id,
          elementId: node.elementId,
          kind: node.kind,
          x: node.x,
          y: node.y,
          w: node.w,
          h: node.h,
          placement: node.placement,
          compartments: node.compartments,
          style: node.style,
        }),
      );
    });

    diagram.edges.forEach((edge) => {
      lines.push(
        formatLine('edge', {
          diagramId: diagram.id,
          id: edge.id,
          relationshipId: edge.relationshipId,
          sourceNodeId: edge.sourceNodeId,
          targetNodeId: edge.targetNodeId,
          routingPoints: edge.routingPoints,
          label: edge.label,
        }),
      );
    });
  });

  return sysmlV2TextSchema.parse({
    type: 'sysmlv2-text',
    version,
    manifest,
    text: lines.join('\n'),
  });
}

export function sysmlV2TextToWorkspace(
  payload: SysmlV2Text,
  options?: { manifestOverride?: WorkspaceManifest },
): WorkspaceFiles {
  const manifest = normalizeManifest(payload.manifest, options?.manifestOverride);
  const elements: ModelFile['elements'] = [];
  const relationships: ModelFile['relationships'] = [];
  const diagrams: Map<string, Diagram> = new Map();
  const nodesByDiagram: Map<string, DiagramNode[]> = new Map();
  const edgesByDiagram: Map<string, DiagramEdge[]> = new Map();

  const lines = payload.text.split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const [kind, ...rest] = trimmed.split(' ');
    const payloadText = rest.join(' ');
    const assignments = parseAssignments(payloadText);

    switch (kind) {
      case 'manifest': {
        Object.assign(manifest, assignments);
        break;
      }
      case 'element': {
        elements.push(assignments as ModelFile['elements'][number]);
        break;
      }
      case 'relationship': {
        relationships.push(assignments as ModelFile['relationships'][number]);
        break;
      }
      case 'diagram': {
        const diagram = diagramSchema.parse({
          id: assignments.id,
          name: assignments.name,
          type: assignments.type,
          kind: assignments.kind ?? assignments.type,
          ownerId: (assignments as Diagram).ownerId ?? null,
          contextBlockId: (assignments as Diagram).contextBlockId,
          nodes: [],
          edges: [],
          viewSettings: assignments.viewSettings,
        });
        diagrams.set(diagram.id, diagram);
        break;
      }
      case 'node': {
        const diagramId = assignments.diagramId as string;
        const node = diagramNodeSchema.parse({
          id: assignments.id,
          elementId: assignments.elementId,
          kind: assignments.kind ?? 'Element',
          x: assignments.x,
          y: assignments.y,
          w: assignments.w,
          h: assignments.h,
          placement: assignments.placement,
          compartments: assignments.compartments,
          style: assignments.style,
        });
        const list = nodesByDiagram.get(diagramId) ?? [];
        list.push(node);
        nodesByDiagram.set(diagramId, list);
        break;
      }
      case 'edge': {
        const diagramId = assignments.diagramId as string;
        const edge = diagramEdgeSchema.parse({
          id: assignments.id,
          relationshipId: assignments.relationshipId,
          sourceNodeId: assignments.sourceNodeId,
          targetNodeId: assignments.targetNodeId,
          routingPoints: assignments.routingPoints,
          label: assignments.label,
        });
        const list = edgesByDiagram.get(diagramId) ?? [];
        list.push(edge);
        edgesByDiagram.set(diagramId, list);
        break;
      }
      default:
        throw new Error(`Unsupported sysmlv2-text line kind: ${kind}`);
    }
  });

  const diagramList: DiagramsFile['diagrams'] = Array.from(diagrams.values()).map((diagram) => ({
    ...diagram,
    nodes: nodesByDiagram.get(diagram.id) ?? [],
    edges: edgesByDiagram.get(diagram.id) ?? [],
  }));

  return validateWorkspaceFiles({
    manifest,
    model: modelFileSchema.parse({ elements, relationships }),
    diagrams: diagramsFileSchema.parse({ diagrams: diagramList }),
  });
}

export function detectSysmlFormat(payload: unknown): SysmlFormat | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const marker = (payload as { type?: string }).type;
  if (marker === 'sysmlv2-json') return 'sysmlv2-json';
  if (marker === 'sysmlv2-text') return 'sysmlv2-text';
  return null;
}

export function parseSysmlPayload(
  payload: unknown,
  options?: { manifestOverride?: WorkspaceManifest },
): WorkspaceFiles | null {
  const format = detectSysmlFormat(payload);
  if (format === 'sysmlv2-json') {
    const parsed = sysmlV2JsonSchema.parse((payload as { sysml?: unknown }).sysml ?? payload);
    return sysmlV2JsonToWorkspace(parsed, { manifestOverride: options?.manifestOverride });
  }
  if (format === 'sysmlv2-text') {
    const parsed = sysmlV2TextSchema.parse((payload as { sysml?: unknown }).sysml ?? payload);
    return sysmlV2TextToWorkspace(parsed, { manifestOverride: options?.manifestOverride });
  }
  return null;
}
