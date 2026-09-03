import type { PolicyAction } from "./policy.js";

export interface AuditRecord {
  requestId: string;
  timestamp: number;
  clientId?: string;
  runtimeToolId: string;
  mcpToolName: string;
  sourceId: string;
  origin: string;
  decision: PolicyAction;
  durationMs?: number;
  success?: boolean;
  errorCode?: string;
  inputDigest?: string;
}

export interface AuditConfig {
  enabled: boolean;
  path: string;
  maxBytes: number;
}
