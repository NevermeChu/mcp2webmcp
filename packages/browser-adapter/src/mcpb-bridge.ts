import { homedir } from "node:os";
import { join } from "node:path";
import { RelayBridgeServer } from "@mcp-b/webmcp-local-relay";
import type { ToolAnnotations } from "@mcp2webmcp/protocol";
import { assertExplicitOrigins, assertLoopbackHost, normalizeLoopbackHost } from "./mcpb-safety.js";
import { stripPageAnnotations } from "./page-annotations.js";

export interface McpbRelaySnapshotSource {
  sourceId: string;
  tabId: string;
  origin?: string;
  url?: string;
  title?: string;
  connectedAt: number;
}

export interface McpbRelaySnapshotTool {
  invokeName: string;
  originalName: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: ToolAnnotations;
  sourceIds: string[];
}

export interface McpbRelaySnapshot {
  sources: McpbRelaySnapshotSource[];
  tools: McpbRelaySnapshotTool[];
}

/**
 * Subset of the MCP-B public RelayBridgeServer surface used by McpBAdapter.
 * Tests inject this seam; production uses {@link createRelayBridge}.
 */
export interface McpbRelayBridge {
  readonly mode: "server" | "client";
  start(): Promise<void>;
  stop(): Promise<void>;
  on(event: "stateChanged", listener: () => void): this;
  off(event: "stateChanged", listener: () => void): this;
  snapshot(): McpbRelaySnapshot;
  invokeTool(
    toolName: string,
    args: Record<string, unknown> | undefined,
    options?: { sourceId?: string; requestTabId?: string },
  ): Promise<{
    content: unknown[];
    structuredContent?: unknown;
    isError?: boolean;
  }>;
}

export interface CreateRelayBridgeOptions {
  allowedOrigins: string[];
  host?: string;
  port?: number;
  persistPath?: string;
  relayId?: string;
  label?: string;
  invokeTimeoutMs?: number;
  maxPayloadBytes?: number;
}

export function createRelayBridge(options: CreateRelayBridgeOptions): McpbRelayBridge {
  assertExplicitOrigins(options.allowedOrigins);
  const host = normalizeLoopbackHost(options.host ?? "127.0.0.1");
  assertLoopbackHost(host);
  const inner = new RelayBridgeServer({
    host,
    port: options.port,
    portExplicitlySet: options.port !== undefined,
    allowedOrigins: options.allowedOrigins,
    persistPath: options.persistPath ?? join(homedir(), ".mcp2webmcp", "relay-port.json"),
    invokeTimeoutMs: options.invokeTimeoutMs,
    maxPayloadBytes: options.maxPayloadBytes,
    label: options.label ?? "mcp2webmcp",
    relayId: options.relayId ?? "mcp2webmcp",
  });
  return wrapRelayBridgeServer(inner);
}

/** Maps public RelayBridgeServer snapshots without copying MCP-B registry source. */
export function wrapRelayBridgeServer(inner: RelayBridgeServer): McpbRelayBridge {
  const wrapper: McpbRelayBridge = {
    get mode() {
      return inner.mode;
    },
    start: () => inner.start(),
    stop: () => inner.stop(),
    on(event, listener) {
      inner.on(event, listener);
      return wrapper;
    },
    off(event, listener) {
      inner.off(event, listener);
      return wrapper;
    },
    snapshot: () => snapshotFromRelay(inner),
    invokeTool: (toolName, args, options) => inner.invokeTool(toolName, args ?? {}, options),
  };
  return wrapper;
}

function snapshotFromRelay(inner: RelayBridgeServer): McpbRelaySnapshot {
  if (inner.mode === "client") {
    const sourceMap = inner.getToolSourceMapFromRelay();
    return {
      sources: inner.listSourcesFromRelay().map((source) => ({
        sourceId: source.sourceId,
        tabId: source.tabId,
        origin: source.origin,
        url: source.url,
        title: source.title,
        connectedAt: source.connectedAt,
      })),
      tools: inner.listToolsFromRelay().map((tool) => ({
        invokeName: tool.name,
        originalName: pageOriginalName(tool.name, tool.name),
        description: tool.description,
        inputSchema: (tool.inputSchema ?? { type: "object", properties: {} }) as Record<
          string,
          unknown
        >,
        annotations: stripPageAnnotations(tool.annotations),
        sourceIds: sourceMap[tool.name] ?? [],
      })),
    };
  }

  return {
    sources: inner.registry.listSources().map((source) => ({
      sourceId: source.sourceId,
      tabId: source.tabId,
      origin: source.origin,
      url: source.url,
      title: source.title,
      connectedAt: source.connectedAt,
    })),
    tools: inner.registry.listTools().map((tool) => ({
      invokeName: tool.name,
      originalName: pageOriginalName(tool.originalName, tool.name),
      description: tool.description,
      inputSchema: (tool.inputSchema ?? { type: "object", properties: {} }) as Record<
        string,
        unknown
      >,
      annotations: stripPageAnnotations(tool.annotations),
      sourceIds: tool.sources.map((source) => source.sourceId),
    })),
  };
}

/** MCP-B public names may look like echo_91c6; Core policy keys off the page tool name. */
function pageOriginalName(originalName: string, publicName: string): string {
  if (originalName && !/_[0-9a-f]{4}$/i.test(originalName)) return originalName;
  const stripped = publicName.replace(/_[0-9a-f]{4}$/i, "");
  return stripped || originalName || publicName;
}
