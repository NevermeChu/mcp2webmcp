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
    this.unsubEvents ??= this.projector.start();
  }

  async connect(transport: Transport): Promise<void> {
    this.start();
    await this.server.connect(transport);
  }

  startStdio(): StdioServerHandle {
    this.start();
    this.stdioHandle = serveStdio(() => this.server);
    return this.stdioHandle;
  }

  async close(): Promise<void> {
    this.unsubEvents?.();
    this.unsubEvents = undefined;
    this.projector.stop();
    await this.stdioHandle?.close();
    await this.server.close();
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
      { description: "List discovered WebMCP tools with source metadata (fallback when dynamic refresh is unavailable)" },
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
        description: "Call a discovered tool by MCP name or runtime id (fallback when dynamic tools are not subscribed)",
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
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
