// Re-export all shared schemas, types, and helpers for consumers like the server.
export {
  diagramEdgeSchema,
  diagramNodeSchema,
  diagramSchema,
  diagramsFileSchema,
  elementSchema,
  metaclassSchema,
  modelFileSchema,
  relationshipTypeSchema,
  relationshipSchema,
  workspaceManifestSchema,
  validateWorkspaceFiles,
  IR_VERSION,
  sysmlV2JsonSchema,
} from './ir.js';

export type {
  Diagram,
  DiagramsFile,
  Element,
  Metaclass,
  ModelFile,
  RelationshipType,
  Relationship,
  WorkspaceFiles,
  WorkspaceManifest,
  SysmlV2Json,
} from './ir.js';
