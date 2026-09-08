import { randomUUID } from "node:crypto";
import {
  fromJsonSchema,
  type CallToolResult,
  type JsonSchemaType,
  type McpServer,
  type RegisteredTool,
  type ServerContext,
} from "@modelcontextprotocol/server";
import type { Runtime } from "@mcp2webmcp/core";
import {
  DEFAULT_INVOCATION_DEADLINE_MS,
  sourceKey,
  type RuntimeConfig,
  type RuntimeTool,
} from "@mcp2webmcp/protocol";
import { MANAGEMENT_TOOL_NAMES, mapInvokeResult } from "./error-map.js";

const EMPTY_SCHEMA = { type: "object", properties: {} } as const;

export class ToolProjector {
  private readonly handles = new Map<string, RegisteredTool>();
  private readonly handleMeta = new Map<string, string>();
  private syncQueued = false;
  private stopped = false;
  private lastFingerprint = "";
  omittedCount = 0;
  projectedCount = 0;

  constructor(
    private readonly server: McpServer,
    private readonly runtime: Runtime,
    private readonly config: RuntimeConfig,
    private readonly processInstanceId: string,
  ) {}

  start(): () => void {
    this.stopped = false;
    this.sync();
    return this.runtime.events.subscribe(() => this.scheduleSync());
  }

  stop(): void {
    this.stopped = true;
    for (const handle of this.handles.values()) handle.remove();
    this.handles.clear();
    this.handleMeta.clear();
    this.lastFingerprint = "";
  }

  /**
   * Coalesce bursts within one turn, then flush before the next I/O turn.
   * A timer-based debounce (the old 150ms) leaves a window where
   * webmcp_list_tools already shows a runtime tool that tools/call cannot
   * reach yet — the projection must never trail an observed listing.
   */
  private scheduleSync(): void {
    if (this.syncQueued || this.stopped) return;
    this.syncQueued = true;
    queueMicrotask(() => {
      this.syncQueued = false;
      if (this.stopped) return;
      this.sync();
    });
  }

  private sync(): void {
    const selected = this.selectTools();
    const meta = new Map<string, string>();
    for (const tool of selected) {
      meta.set(tool.identity.mcpName, toolMetaKey(tool));
    }
    const fingerprint = [...meta.entries()]
      .map(([name, key]) => `${name}::${key}`)
      .sort()
      .join("\n");
    if (fingerprint === this.lastFingerprint && this.handles.size === selected.length) {
      this.projectedCount = this.handles.size;
      this.runtime.log.debug("mcp", "projector.skip", {
        projectedCount: this.projectedCount,
        omittedCount: this.omittedCount,
      });
      return;
    }
    const removed: string[] = [];
    for (const [name, handle] of this.handles) {
      if (meta.get(name) === this.handleMeta.get(name)) continue;
      handle.remove();
      this.handles.delete(name);
      this.handleMeta.delete(name);
      removed.push(name);
    }
    const added: string[] = [];
    for (const tool of selected) {
      const name = tool.identity.mcpName;
      if (this.handles.has(name)) continue;
      const handle = this.registerDynamic(tool);
      if (handle) {
        this.handles.set(name, handle);
        this.handleMeta.set(name, meta.get(name) ?? "");
        added.push(name);
      }
    }
    this.lastFingerprint = fingerprint;
    this.projectedCount = this.handles.size;
    this.runtime.log.info("mcp", "projector.sync", {
      added,
      removed,
      projectedCount: this.projectedCount,
      omittedCount: this.omittedCount,
    });
  }

  private selectTools(): RuntimeTool[] {
    const allowed = new Set(this.config.browser.allowedOrigins);
    const perSource = new Map<string, number>();
    const selected: RuntimeTool[] = [];
    let omitted = 0;
    for (const tool of this.runtime.tools.list()) {
      if ((MANAGEMENT_TOOL_NAMES as readonly string[]).includes(tool.identity.mcpName)) {
        omitted += 1;
        continue;
      }
      const source = this.runtime.sources.get(tool.identity.adapterId, tool.identity.sourceId);
      if (!source || source.state !== "connected") continue;
      if (allowed.size > 0 && !allowed.has(source.origin)) {
        omitted += 1;
        continue;
      }
      if (
        this.runtime.consent.enabled &&
        !this.runtime.consent.allows(source.origin, tool.identity.originalName)
      ) {
        omitted += 1;
        continue;
      }
      const key = sourceKey(source.adapterId, source.sourceId);
      const used = perSource.get(key) ?? 0;
      if (
        used >= this.runtime.limits.maxToolsPerSource ||
        selected.length >= this.runtime.limits.maxToolsTotal
      ) {
        omitted += 1;
        continue;
      }
      selected.push(tool);
      perSource.set(key, used + 1);
    }
    this.omittedCount = omitted;
    return selected;
  }

  private registerDynamic(tool: RuntimeTool): RegisteredTool | undefined {
    const schema = asJsonSchema(tool.inputSchema);
    const mcpName = tool.identity.mcpName;
    try {
      return this.server.registerTool(
        mcpName,
        {
          title: tool.identity.originalName,
          description: tool.description ?? tool.identity.originalName,
          inputSchema: schema,
          annotations: tool.annotations,
        },
        async (args: unknown, ctx: ServerContext): Promise<CallToolResult> => {
          const result = await this.runtime.router.invoke(
            {
              requestId: randomUUID(),
              target: { mcpName },
              input: args ?? {},
              client: { processInstanceId: this.processInstanceId },
            },
            {
              signal: ctx.mcpReq.signal,
              deadline:
                Date.now() +
                (this.config.runtime.invocationDeadlineMs ?? DEFAULT_INVOCATION_DEADLINE_MS),
            },
          );
          return mapInvokeResult(result) as CallToolResult;
        },
      );
    } catch (error) {
      this.omittedCount += 1;
      this.runtime.log.error("mcp", "projector.register.failed", {
        mcpName,
        message: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }
}

/** Same-name tools must re-register when page metadata changes, not only on rename. */
function toolMetaKey(tool: RuntimeTool): string {
  return JSON.stringify([tool.description ?? "", tool.inputSchema ?? {}, tool.annotations ?? {}]);
}

function asJsonSchema(schema: Record<string, unknown>): ReturnType<typeof fromJsonSchema> {
  try {
    const candidate = {
      ...schema,
      type: typeof schema.type === "string" ? schema.type : "object",
    } as JsonSchemaType;
    return fromJsonSchema(candidate);
  } catch {
    return fromJsonSchema(EMPTY_SCHEMA as JsonSchemaType);
  }
}
