import type { AuditConfig } from "./audit.js";
import type { ConsentConfig } from "./consent.js";
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
}

export interface RuntimeConfig {
  runtime: {
    name: string;
    logLevel: "debug" | "info" | "warn" | "error";
    logPath?: string;
    logMaxBytes?: number;
    invocationDeadlineMs: number;
  };
  mcp: {
    stdio: { enabled: boolean };
  };
  browser: {
    adapter: string;
    allowedOrigins: string[];
    mcpb?: McpbRelayConfig;
    extension?: ExtensionAdapterConfig;
  };
  policy: PolicyConfig;
  consent: ConsentConfig;
  audit: AuditConfig;
  limits: ResourceLimits;
}

/**
 * Loopback bind settings for ExtensionAdapter.
 * Types stay generic so Core never imports chrome.* or WebSocket server types.
 */
export interface ExtensionAdapterConfig {
  host?: string;
  port?: number;
  invokeTimeoutMs?: number;
  /** Required by the Gateway when adapter=extension; the hello must carry it. */
  authToken?: string;
  /** How long a dropped WebSocket keeps its sources before they are removed. */
  disconnectGraceMs?: number;
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
};
