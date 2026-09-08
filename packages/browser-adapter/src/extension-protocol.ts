import {
  isLogHop,
  isLogLevel,
  sanitizeLogData,
  type LogHop,
  type LogLevel,
  type ToolAnnotations,
  type RuntimeErrorCode,
  type ToolPolicyMode,
  type ToolPolicyOverride,
} from "@mcp2webmcp/protocol";
import { stripPageAnnotations } from "./page-annotations.js";

export const EXTENSION_PROTOCOL = "mcp2webmcp-extension";
export const EXTENSION_PROTOCOL_VERSION = 3;
export const DEFAULT_EXTENSION_PORT = 9334;
export const MAX_EXTENSION_TOOLS_PER_SNAPSHOT = 500;

export type ExtensionSourceReason = "connect" | "navigate" | "reload";

export interface ExtensionToolSnapshot {
  originalName: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: ToolAnnotations;
}

export type ExtensionClientMessage =
  | {
      type: "hello";
      protocol: typeof EXTENSION_PROTOCOL;
      protocolVersion: number;
      token: string;
    }
  | {
      type: "source.upsert";
      sourceId: string;
      tabId: string;
      origin: string;
      url: string;
      title?: string;
      reason?: ExtensionSourceReason;
    }
  | {
      type: "source.remove";
      sourceId: string;
    }
  | {
      type: "tools.replace";
      sourceId: string;
      tools: ExtensionToolSnapshot[];
      runtimePresent?: boolean;
      runtimeError?: string;
    }
  | {
      type: "invokeResult";
      requestId: string;
      sourceId: string;
      sourceGeneration: number;
      content: unknown[];
      structuredContent?: unknown;
      isError?: boolean;
      error?: { message: string; code?: "OUTCOME_UNKNOWN" };
    }
  | {
      type: "policy.set";
      requestId: string;
      origin: string;
      originalName: string;
      mode: ToolPolicyMode;
    }
  | { type: "confirmation.respond"; requestId: string; approved: boolean }
  | { type: "ping"; id: string }
  | { type: "pong"; id: string }
  | {
      type: "log";
      level: LogLevel;
      hop: LogHop;
      event: string;
      message?: string;
      traceId?: string;
      data?: Record<string, unknown>;
    };

export type ExtensionServerMessage =
  | {
      type: "helloAck";
      protocol: typeof EXTENSION_PROTOCOL;
      protocolVersion: number;
      adapterId: string;
    }
  | { type: "sourceAck"; sourceId: string; sourceGeneration: number }
  | {
      type: "invoke";
      requestId: string;
      sourceId: string;
      sourceGeneration: number;
      originalName: string;
      args?: unknown;
      deadline?: number;
    }
  | { type: "invokeCancel"; requestId: string; sourceId: string; sourceGeneration: number }
  | { type: "policy.snapshot"; overrides: ToolPolicyOverride[] }
  | { type: "policy.updated"; requestId: string; override: ToolPolicyOverride }
  | { type: "policy.error"; requestId: string; message: string }
  | {
      type: "confirmation.request";
      requestId: string;
      sourceId: string;
      sourceGeneration: number;
      origin: string;
      originalName: string;
      mcpName: string;
      inputPreview?: string;
      clientName?: string;
      deadline: number;
    }
  | { type: "confirmation.resolved"; requestId: string; approved: boolean }
  | {
      type: "invocation.decision";
      requestId: string;
      sourceId: string;
      originalName: string;
      action: ToolPolicyMode;
      reason?: string;
      errorCode?: RuntimeErrorCode;
      timestamp: number;
    }
  | { type: "ping"; id: string }
  | { type: "pong"; id: string };

export function parseExtensionClientMessage(raw: string): ExtensionClientMessage | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const msg = value as Record<string, unknown>;
  const type = msg.type;
  if (typeof type !== "string") return undefined;

  if (type === "hello") {
    if (msg.protocol !== EXTENSION_PROTOCOL || typeof msg.protocolVersion !== "number") {
      return undefined;
    }
    if (typeof msg.token !== "string" || msg.token.length === 0 || msg.token.length > 512) {
      return undefined;
    }
    return {
      type: "hello",
      protocol: EXTENSION_PROTOCOL,
      protocolVersion: msg.protocolVersion,
      token: msg.token,
    };
  }
  if (type === "source.upsert") {
    if (
      typeof msg.sourceId !== "string" ||
      typeof msg.tabId !== "string" ||
      typeof msg.origin !== "string" ||
      typeof msg.url !== "string"
    ) {
      return undefined;
    }
    const reason = msg.reason;
    const title = typeof msg.title === "string" ? msg.title : undefined;
    const parsedReason: ExtensionSourceReason | undefined =
      reason === "connect" || reason === "navigate" || reason === "reload" ? reason : undefined;
    return {
      type: "source.upsert",
      sourceId: msg.sourceId,
      tabId: msg.tabId,
      origin: msg.origin,
      url: msg.url,
      title,
      reason: parsedReason,
    };
  }
  if (type === "source.remove") {
    if (typeof msg.sourceId !== "string") return undefined;
    return { type: "source.remove", sourceId: msg.sourceId };
  }
  if (type === "tools.replace") {
    if (
      typeof msg.sourceId !== "string" ||
      !Array.isArray(msg.tools) ||
      msg.tools.length > MAX_EXTENSION_TOOLS_PER_SNAPSHOT
    ) {
      return undefined;
    }
    const tools: ExtensionToolSnapshot[] = [];
    for (const item of msg.tools) {
      const tool = sanitizeTool(item);
      if (tool) tools.push(tool);
    }
    return {
      type: "tools.replace",
      sourceId: msg.sourceId,
      tools,
      runtimePresent: typeof msg.runtimePresent === "boolean" ? msg.runtimePresent : undefined,
      runtimeError: typeof msg.runtimeError === "string" ? msg.runtimeError : undefined,
    };
  }
  if (type === "invokeResult") {
    if (
      typeof msg.requestId !== "string" ||
      typeof msg.sourceId !== "string" ||
      !Number.isInteger(msg.sourceGeneration) ||
      (msg.sourceGeneration as number) < 0
    ) {
      return undefined;
    }
    const content = Array.isArray(msg.content) ? msg.content : [];
    return {
      type: "invokeResult",
      requestId: msg.requestId,
      sourceId: msg.sourceId,
      sourceGeneration: msg.sourceGeneration as number,
      content,
      structuredContent: msg.structuredContent,
      isError: Boolean(msg.isError),
      error:
        msg.error &&
        typeof msg.error === "object" &&
        typeof (msg.error as { message?: unknown }).message === "string"
          ? {
              message: (msg.error as { message: string }).message,
              code:
                (msg.error as { code?: unknown }).code === "OUTCOME_UNKNOWN"
                  ? "OUTCOME_UNKNOWN"
                  : undefined,
            }
          : undefined,
    };
  }
  if (type === "policy.set") {
    if (
      typeof msg.requestId !== "string" ||
      typeof msg.origin !== "string" ||
      typeof msg.originalName !== "string" ||
      (msg.mode !== "allow" && msg.mode !== "confirm" && msg.mode !== "deny")
    ) {
      return undefined;
    }
    return {
      type: "policy.set",
      requestId: msg.requestId,
      origin: msg.origin,
      originalName: msg.originalName,
      mode: msg.mode,
    };
  }
  if (type === "confirmation.respond") {
    if (typeof msg.requestId !== "string" || typeof msg.approved !== "boolean") {
      return undefined;
    }
    return { type: "confirmation.respond", requestId: msg.requestId, approved: msg.approved };
  }
  if (type === "ping" || type === "pong") {
    if (typeof msg.id !== "string") return undefined;
    return { type, id: msg.id };
  }
  if (type === "log") {
    if (typeof msg.event !== "string" || msg.event.length === 0 || msg.event.length > 80) {
      return undefined;
    }
    return {
      type: "log",
      level: isLogLevel(msg.level) ? msg.level : "info",
      hop: isLogHop(msg.hop) ? msg.hop : "extension",
      event: msg.event,
      message: typeof msg.message === "string" ? msg.message.slice(0, 400) : undefined,
      traceId: typeof msg.traceId === "string" ? msg.traceId : undefined,
      data: sanitizeLogData(msg.data),
    };
  }
  return undefined;
}

function sanitizeTool(item: unknown): ExtensionToolSnapshot | undefined {
  if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
  const tool = item as Record<string, unknown>;
  const originalName = typeof tool.originalName === "string" ? tool.originalName : undefined;
  if (!originalName) return undefined;
  const inputSchema =
    tool.inputSchema && typeof tool.inputSchema === "object" && !Array.isArray(tool.inputSchema)
      ? (tool.inputSchema as Record<string, unknown>)
      : { type: "object", properties: {} };
  const annotations = stripPageAnnotations(tool.annotations);
  return {
    originalName,
    description: typeof tool.description === "string" ? tool.description : undefined,
    inputSchema,
    annotations,
  };
}
