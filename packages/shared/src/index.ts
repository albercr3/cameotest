export interface WorkspaceMetadata {
  id: string;
  name: string;
  description?: string;
}

export interface WorkspaceNode {
  id: string;
  label: string;
  type?: string;
  notes?: string;
}

export interface WorkspaceEdge {
  from: string;
  to: string;
  label?: string;
}

export interface WorkspaceContext {
  summary?: string;
  owner?: string;
  updatedAt?: string;
}

export interface Workspace extends WorkspaceMetadata {
  nodes: WorkspaceNode[];
  connections: WorkspaceEdge[];
  context?: WorkspaceContext;
}

export const IR_VERSION = "1.0.0";
