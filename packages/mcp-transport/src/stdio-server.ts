import { randomUUID } from "node:crypto";
import {
  fromJsonSchema,
  McpServer,
  type CallToolResult,
  type JsonSchemaType,
  type Transport,
} from "@modelcontextprotocol/server";
import { serveStdio, type StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import type { Runtime } from "@mcp2webmcp/core";
import type { RuntimeConfig } from "@mcp2webmcp/protocol";
import { createManagementHandlers } from "./management-tools.js";
import { installStdioLifetime } from "./stdio-lifetime.js";
import { ToolProjector } from "./tool-projector.js";

export class McpStdioServer {
  readonly processInstanceId = randomUUID();
  readonly server: McpServer;
  private readonly projector: ToolProjector;
  private unsubEvents: (() => void) | undefined;
  private stdioHandle: StdioServerHandle | undefined;

  constructor(
    private readonly runtime: Runtime,
    private readonly config: RuntimeConfig,
  ) {
    this.server = new McpServer(
      { name: config.runtime.name, version: "0.1.0" },
      { capabilities: { tools: { listChanged: true } } },
    );
    this.projector = new ToolProjector(this.server, runtime, config, this.processInstanceId);
    this.registerManagementTools();
  }

  start(): void {
    const first = !this.unsubEvents;
    this.unsubEvents ??= this.projector.start();
    if (first) {
      this.runtime.log.info("mcp", "stdio.listening", {
        name: this.config.runtime.name,
        logPath: this.config.runtime.logPath ?? "",
      });
    }
  }

  async connect(transport: Transport): Promise<void> {
    this.start();
    await this.server.connect(transport);
  }

  startStdio(): StdioServerHandle {
    this.start();
    this.stdioHandle = serveStdio(() => this.server);
    installStdioLifetime({
      stdin: process.stdin,
      process,
      onHangup: (reason) => {
        void this.exitAfterHangup(reason);
      },
    });
    return this.stdioHandle;
  }

  async close(): Promise<void> {
    this.unsubEvents?.();
    this.unsubEvents = undefined;
    this.projector.stop();
    await this.stdioHandle?.close();
    await this.server.close();
    for (const adapter of this.runtime.adapters.list()) {
      await adapter.stop().catch(() => undefined);
    }
  }

  private async exitAfterHangup(reason: string): Promise<void> {
    this.runtime.log.info("mcp", "stdio.hangup", { reason });
    const timer = setTimeout(() => process.exit(0), 2_000);
    try {
      await this.close();
    } catch {
      // still exit
    }
    clearTimeout(timer);
    process.exit(0);
  }

  stats(): { projectedCount: number; omittedCount: number } {
    return {
      projectedCount: this.projector.projectedCount,
      omittedCount: this.projector.omittedCount,
    };
  }

  private registerManagementTools(): void {
    const handlers = createManagementHandlers(this.runtime, this.config, this.processInstanceId);
    this.server.registerTool(
      "webmcp_list_sources",
      { description: "List connected WebMCP browser sources" },
      async () => handlers.listSources(),
    );
    this.server.registerTool(
      "webmcp_list_tools",
      {
        description:
          "List discovered WebMCP tools with source metadata (fallback when dynamic refresh is unavailable)",
      },
      async () => handlers.listTools(),
    );
    this.server.registerTool(
      "webmcp_get_tool",
      {
        description: "Get one discovered tool by MCP name or runtime id",
        inputSchema: fromJsonSchema({
          type: "object",
          properties: {
            mcpName: { type: "string" },
            runtimeId: { type: "string" },
          },
        } as JsonSchemaType),
      },
      async (args): Promise<CallToolResult> => {
        const record = asRecord(args);
        return (await handlers.getTool({
          mcpName: typeof record.mcpName === "string" ? record.mcpName : undefined,
          runtimeId: typeof record.runtimeId === "string" ? record.runtimeId : undefined,
        })) as CallToolResult;
      },
    );
    this.server.registerTool(
      "webmcp_runtime_status",
      { description: "Gateway process status" },
      async () =>
        handlers.runtimeStatus({
          projectedCount: this.projector.projectedCount,
          omittedCount: this.projector.omittedCount,
        }),
    );
    this.server.registerTool(
      "webmcp_call_tool",
      {
        description:
          "Call a discovered tool by MCP name or runtime id (fallback when dynamic tools are not subscribed)",
        inputSchema: fromJsonSchema({
          type: "object",
          properties: {
            mcpName: { type: "string" },
            runtimeId: { type: "string" },
            arguments: { type: "object" },
          },
        } as JsonSchemaType),
      },
      async (args): Promise<CallToolResult> => {
        const record = asRecord(args);
        return (await handlers.callTool({
          mcpName: typeof record.mcpName === "string" ? record.mcpName : undefined,
          runtimeId: typeof record.runtimeId === "string" ? record.runtimeId : undefined,
          arguments: record.arguments,
        })) as CallToolResult;
      },
    );
    this.server.registerTool(
      "webmcp_list_consent",
      { description: "List auto-admitted origins and tools; revoked entries stay until restored" },
      async () => handlers.listConsent(),
    );
    this.server.registerTool(
      "webmcp_revoke_consent",
      {
        description: "Revoke an origin or one tool so MCP will not project or invoke it",
        inputSchema: fromJsonSchema({
          type: "object",
          properties: {
            origin: { type: "string" },
            tool: { type: "string" },
          },
          required: ["origin"],
        } as JsonSchemaType),
      },
      async (args): Promise<CallToolResult> => {
        const record = asRecord(args);
        return (await handlers.revokeConsent({
          origin: typeof record.origin === "string" ? record.origin : undefined,
          tool: typeof record.tool === "string" ? record.tool : undefined,
        })) as CallToolResult;
      },
    );
    this.server.registerTool(
      "webmcp_recent_logs",
      {
        description:
          "Recent Gateway JSON logs (page / extension / gateway / mcp hops). Source of truth is the log file when MCP discovery is down.",
        inputSchema: fromJsonSchema({
          type: "object",
          properties: {
            limit: { type: "number" },
          },
        } as JsonSchemaType),
      },
      async (args): Promise<CallToolResult> => {
        const record = asRecord(args);
        const limit = typeof record.limit === "number" ? record.limit : undefined;
        return (await handlers.recentLogs({ limit })) as CallToolResult;
      },
    );
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
