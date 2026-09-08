import { EventEmitter } from "node:events";
import type {
  McpbRelayBridge,
  McpbRelaySnapshot,
  McpbRelaySnapshotSource,
  McpbRelaySnapshotTool,
} from "../src/mcpb-bridge.js";

/** In-memory stand-in for RelayBridgeServer public methods. */
export class FakeRelayBridge extends EventEmitter implements McpbRelayBridge {
  mode: "server" | "client" = "server";
  invokeCalls: Array<{ toolName: string; args: unknown; sourceId?: string }> = [];
  private sources: McpbRelaySnapshotSource[] = [];
  private tools: McpbRelaySnapshotTool[] = [];

  snapshot(): McpbRelaySnapshot {
    return { sources: this.sources, tools: this.tools };
  }

  async start(): Promise<void> {}

  async stop(): Promise<void> {}

  override on(event: "stateChanged", listener: () => void): this {
    super.on(event, listener);
    return this;
  }

  override off(event: "stateChanged", listener: () => void): this {
    super.off(event, listener);
    return this;
  }

  setSnapshot(sources: McpbRelaySnapshotSource[], tools: McpbRelaySnapshotTool[]): void {
    this.sources = sources;
    this.tools = tools;
    this.emit("stateChanged");
  }

  async invokeTool(
    toolName: string,
    args: Record<string, unknown> | undefined,
    options?: { sourceId?: string },
  ): Promise<{ content: unknown[]; isError?: boolean }> {
    this.invokeCalls.push({ toolName, args, sourceId: options?.sourceId });
    return { content: [{ type: "text", text: JSON.stringify({ toolName, args }) }] };
  }
}

export function demoRelaySource(
  overrides: Partial<McpbRelaySnapshotSource> = {},
): McpbRelaySnapshotSource {
  return {
    sourceId: "conn-1",
    tabId: "18",
    origin: "https://knowmesh.app",
    url: "https://knowmesh.app/docs",
    title: "docs",
    connectedAt: 1,
    ...overrides,
  };
}

export function demoRelayTool(
  overrides: Partial<McpbRelaySnapshotTool> = {},
): McpbRelaySnapshotTool {
  return {
    invokeName: "echo_943b",
    originalName: "echo",
    description: "echo",
    inputSchema: { type: "object", properties: {} },
    sourceIds: ["conn-1"],
    ...overrides,
  };
}
