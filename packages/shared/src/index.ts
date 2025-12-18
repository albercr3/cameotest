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

export {
  detectSysmlFormat,
  parseSysmlPayload,
  sysmlV2TextSchema,
  sysmlV2TextToWorkspace,
  sysmlV2JsonToWorkspace,
  workspaceToSysmlV2Json,
  workspaceToSysmlV2Text,
} from './sysmlConversion.js';

export { validateWorkspace } from './validation.js';
export type { ValidationIssue, ValidationResult } from './validation.js';

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

export type { SysmlV2Text, SysmlFormat } from './sysmlConversion.js';
