import type { AuditConfig } from "./audit.js";
import type { PolicyConfig } from "./policy.js";

export const TOOL_INPUT_JSON_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema";

export const DEFAULT_INVOCATION_DEADLINE_MS = 65_000;

export interface ResourceLimits {
  maxToolsPerSource: number;
  maxToolsTotal: number;
  maxInputBytes: number;
  maxOutputBytes: number;
  maxSchemaBytes: number;
  maxQueuePerSource: number;
  maxSchemaDepth: number;
  schemaCompileTimeoutMs: number;
}

export interface RuntimeConfig {
  runtime: {
    name: string;
    logLevel: "debug" | "info" | "warn" | "error";
    invocationDeadlineMs: number;
  };
  mcp: {
    stdio: { enabled: boolean };
  };
  browser: {
    adapter: string;
    allowedOrigins: string[];
    mcpb?: McpbRelayConfig;
  };
  policy: PolicyConfig;
  audit: AuditConfig;
  limits: ResourceLimits;
}

/** Relay bind settings for the MCP-B adapter. Types stay generic so Core never imports MCP-B. */
export interface McpbRelayConfig {
  host?: string;
  port?: number;
  persistPath?: string;
  relayId?: string;
  label?: string;
  invokeTimeoutMs?: number;
  maxPayloadBytes?: number;
}

export const defaultResourceLimits: ResourceLimits = {
  maxToolsPerSource: 100,
  maxToolsTotal: 500,
  maxInputBytes: 1_048_576,
  maxOutputBytes: 4_194_304,
  maxSchemaBytes: 262_144,
  maxQueuePerSource: 16,
  maxSchemaDepth: 32,
  schemaCompileTimeoutMs: 50,
};
