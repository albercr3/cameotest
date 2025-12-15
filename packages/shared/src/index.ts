// Re-export all shared schemas, types, and helpers for consumers like the server.
export {
  diagramEdgeSchema,
  diagramNodeSchema,
  diagramSchema,
  diagramsFileSchema,
  elementSchema,
  diagramKindSchema,
  metaclassSchema,
  modelFileSchema,
  relationshipTypeSchema,
  relationshipSchema,
  portPlacementSchema,
  workspaceManifestSchema,
  validateWorkspaceFiles,
  IR_VERSION,
  sysmlV2JsonSchema,
} from './ir.js';

export type {
  Diagram,
  DiagramKind,
  DiagramsFile,
  Element,
  Metaclass,
  ModelFile,
  PortPlacement,
  RelationshipType,
  Relationship,
  WorkspaceFiles,
  WorkspaceManifest,
  SysmlV2Json,
} from './ir.js';
