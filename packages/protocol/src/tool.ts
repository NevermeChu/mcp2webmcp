export interface ToolIdentity {
  adapterId: string;
  sourceId: string;
  sourceGeneration: number;
  originalName: string;
  runtimeId: string;
  mcpName: string;
}

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface RuntimeTool {
  identity: ToolIdentity;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: ToolAnnotations;
  discoveredAt: number;
  updatedAt: number;
}
