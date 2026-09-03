import type { ToolAnnotations } from "@mcp2webmcp/protocol";

export const EXTENSION_PROTOCOL = "mcp2webmcp-extension";
export const EXTENSION_PROTOCOL_VERSION = 1;
export const DEFAULT_EXTENSION_PORT = 9334;

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
      content: unknown[];
      structuredContent?: unknown;
      isError?: boolean;
      error?: { message: string };
    }
  | { type: "ping"; id: string }
  | { type: "pong"; id: string };

export type ExtensionServerMessage =
  | {
      type: "helloAck";
      protocol: typeof EXTENSION_PROTOCOL;
      protocolVersion: number;
      adapterId: string;
    }
  | {
      type: "invoke";
      requestId: string;
      sourceId: string;
      originalName: string;
      args?: unknown;
      deadline?: number;
    }
  | { type: "invokeCancel"; requestId: string; sourceId: string }
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
    return {
      type: "hello",
      protocol: EXTENSION_PROTOCOL,
      protocolVersion: msg.protocolVersion,
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
    if (typeof msg.sourceId !== "string" || !Array.isArray(msg.tools)) return undefined;
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
    if (typeof msg.requestId !== "string" || typeof msg.sourceId !== "string") return undefined;
    const content = Array.isArray(msg.content) ? msg.content : [];
    return {
      type: "invokeResult",
      requestId: msg.requestId,
      sourceId: msg.sourceId,
      content,
      structuredContent: msg.structuredContent,
      isError: Boolean(msg.isError),
      error:
        msg.error && typeof msg.error === "object" && typeof (msg.error as { message?: unknown }).message === "string"
          ? { message: (msg.error as { message: string }).message }
          : undefined,
    };
  }
  if (type === "ping" || type === "pong") {
    if (typeof msg.id !== "string") return undefined;
    return { type, id: msg.id };
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
  const annotations = sanitizeAnnotations(tool.annotations);
  return {
    originalName,
    description: typeof tool.description === "string" ? tool.description : undefined,
    inputSchema,
    annotations,
  };
}

function sanitizeAnnotations(value: unknown): ToolAnnotations | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const annotations: ToolAnnotations = {};
  if (typeof raw.readOnlyHint === "boolean") annotations.readOnlyHint = raw.readOnlyHint;
  if (typeof raw.destructiveHint === "boolean") annotations.destructiveHint = raw.destructiveHint;
  if (typeof raw.idempotentHint === "boolean") annotations.idempotentHint = raw.idempotentHint;
  if (typeof raw.openWorldHint === "boolean") annotations.openWorldHint = raw.openWorldHint;
  return Object.keys(annotations).length > 0 ? annotations : undefined;
}
