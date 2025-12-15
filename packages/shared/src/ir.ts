import { z } from 'zod';

export const metaclassSchema = z.enum(['Package', 'Block', 'Part', 'Port', 'Requirement']);
export type Metaclass = z.infer<typeof metaclassSchema>;

export const diagramKindSchema = z.enum(['BDD', 'IBD']);
export type DiagramKind = z.infer<typeof diagramKindSchema>;

export const elementSchema = z
  .object({
    id: z.string().uuid(),
    metaclass: metaclassSchema,
    name: z.string().min(1),
    ownerId: z.string().uuid().nullable(),
    typeId: z.string().uuid().optional(),
    documentation: z.string().default(''),
    stereotypes: z.array(z.string()).default([]),
    tags: z.record(z.string()).default({}),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .passthrough();
export type Element = z.infer<typeof elementSchema>;

export const relationshipTypeSchema = z.enum(['Generalization', 'Association', 'Connector']);
export type RelationshipType = z.infer<typeof relationshipTypeSchema>;

const baseRelationshipSchema = z
  .object({
    id: z.string().uuid(),
    type: relationshipTypeSchema,
  })
  .passthrough();

export const connectorRelationshipSchema = baseRelationshipSchema.extend({
  type: z.literal('Connector'),
  sourcePortId: z.string().uuid(),
  targetPortId: z.string().uuid(),
  itemFlowLabel: z.string().optional(),
});

export const associationRelationshipSchema = baseRelationshipSchema.extend({
  type: z.enum(['Generalization', 'Association']),
  sourceId: z.string().uuid(),
  targetId: z.string().uuid(),
  properties: z.record(z.any()).default({}),
});

export const relationshipSchema = z.discriminatedUnion('type', [
  associationRelationshipSchema,
  connectorRelationshipSchema,
]);
export type Relationship = z.infer<typeof relationshipSchema>;

export const modelFileSchema = z
  .object({
    elements: z.array(elementSchema),
    relationships: z.array(relationshipSchema),
  })
  .passthrough();
export type ModelFile = z.infer<typeof modelFileSchema>;

export const portPlacementSchema = z
  .object({
    side: z.enum(['N', 'E', 'S', 'W']),
    offset: z.number().min(0).max(1),
  })
  .passthrough();
export type PortPlacement = z.infer<typeof portPlacementSchema>;

export const diagramNodeSchema = z
  .object({
    id: z.string().uuid(),
    elementId: z.string().uuid(),
    kind: z.enum(['Element', 'Port', 'Part']).default('Element'),
    x: z.number(),
    y: z.number(),
    w: z.number().positive(),
    h: z.number().positive(),
    placement: portPlacementSchema.optional(),
    compartments: z
      .object({
        collapsed: z.boolean().default(false),
        showPorts: z.boolean().default(true),
        showParts: z.boolean().default(true),
      })
      .default({ collapsed: false, showPorts: true, showParts: true }),
    style: z
      .object({
        highlight: z.boolean().default(false),
      })
      .default({ highlight: false }),
  })
  .passthrough();
export type DiagramNode = z.infer<typeof diagramNodeSchema>;

export const diagramEdgeSchema = z
  .object({
    id: z.string().uuid(),
    relationshipId: z.string().uuid(),
    sourceNodeId: z.string().uuid(),
    targetNodeId: z.string().uuid(),
    routingPoints: z.array(z.object({ x: z.number(), y: z.number() })).default([]),
    label: z.string().default(''),
  })
  .passthrough();
export type DiagramEdge = z.infer<typeof diagramEdgeSchema>;

export const diagramSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    type: diagramKindSchema.default('BDD'),
    kind: diagramKindSchema.default('BDD'),
    contextBlockId: z.string().uuid().optional(),
    ownerId: z.string().uuid().nullable(),
    nodes: z.array(diagramNodeSchema),
    edges: z.array(diagramEdgeSchema),
    viewSettings: z
      .object({
        gridEnabled: z.boolean().default(true),
        snapEnabled: z.boolean().default(true),
        zoom: z.number().default(1),
        panX: z.number().default(0),
        panY: z.number().default(0),
      })
      .default({ gridEnabled: true, snapEnabled: true, zoom: 1, panX: 0, panY: 0 }),
  })
  .passthrough();
export type Diagram = z.infer<typeof diagramSchema>;

export const diagramsFileSchema = z
  .object({
    diagrams: z.array(diagramSchema),
  })
  .passthrough();
export type DiagramsFile = z.infer<typeof diagramsFileSchema>;

export const workspaceManifestSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .passthrough();
export type WorkspaceManifest = z.infer<typeof workspaceManifestSchema>;

export interface WorkspaceFiles {
  manifest: WorkspaceManifest;
  model: ModelFile;
  diagrams: DiagramsFile;
}

export const sysmlV2JsonSchema = z
  .object({
    type: z.literal('sysmlv2-json'),
    manifest: workspaceManifestSchema.partial().optional(),
    model: modelFileSchema,
    diagrams: diagramsFileSchema.optional(),
  })
  .passthrough();
export type SysmlV2Json = z.infer<typeof sysmlV2JsonSchema>;

export function validateWorkspaceFiles(files: WorkspaceFiles) {
  const manifestResult = workspaceManifestSchema.safeParse(files.manifest);
  if (!manifestResult.success) {
    throw new Error(`Invalid workspace manifest: ${manifestResult.error.message}`);
  }
  const modelResult = modelFileSchema.safeParse(files.model);
  if (!modelResult.success) {
    throw new Error(`Invalid model file: ${modelResult.error.message}`);
  }
  const diagramsResult = diagramsFileSchema.safeParse(files.diagrams);
  if (!diagramsResult.success) {
    throw new Error(`Invalid diagrams file: ${diagramsResult.error.message}`);
  }
  return {
    manifest: manifestResult.data,
    model: modelResult.data,
    diagrams: diagramsResult.data,
  } satisfies WorkspaceFiles;
}

export const IR_VERSION = '0.1.0';
