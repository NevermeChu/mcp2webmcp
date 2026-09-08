import type {
  BrowserAdapter,
  BrowserAdapterEvent,
  BrowserSource,
  BrowserToolInvokeRequest,
  BrowserToolInvokeResult,
  RuntimeTool,
} from "@mcp2webmcp/protocol";

export interface FakeToolHandler {
  (
    input: unknown,
    options: { signal: AbortSignal; deadline: number },
  ): Promise<BrowserToolInvokeResult>;
}

export class FakeBrowserAdapter implements BrowserAdapter {
  readonly type = "fake";
  private revision = 0;
  private readonly sources = new Map<string, BrowserSource>();
  private readonly tools = new Map<string, Map<string, RuntimeTool>>();
  private readonly handlers = new Map<string, FakeToolHandler>();
  private readonly listeners = new Set<(event: BrowserAdapterEvent) => void>();

  constructor(readonly adapterId: string) {}

  async start(): Promise<void> {}

  async stop(): Promise<void> {
    this.listeners.clear();
  }

  subscribe(handler: (event: BrowserAdapterEvent) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  async listSources(): Promise<BrowserSource[]> {
    return [...this.sources.values()].filter((source) => source.state !== "disconnected");
  }

  async listTools(sourceId: string): Promise<RuntimeTool[]> {
    return [...(this.tools.get(sourceId)?.values() ?? [])];
  }

  async invokeTool(
    request: BrowserToolInvokeRequest,
    options: { signal: AbortSignal; deadline: number },
  ): Promise<BrowserToolInvokeResult> {
    const source = this.sources.get(request.sourceId);
    if (!source || source.state !== "connected") {
      throw new Error(`source not connected: ${request.sourceId}`);
    }
    if (source.generation !== request.sourceGeneration) {
      throw new Error("generation mismatch");
    }
    const handler = this.handlers.get(this.handlerKey(request.sourceId, request.originalName));
    if (handler) {
      return handler(request.input, options);
    }
    return {
      content: [{ type: "text", text: JSON.stringify(request.input) }],
    };
  }

  connectSource(
    input: Omit<BrowserSource, "adapterId" | "adapterType" | "state" | "updatedAt"> & {
      state?: BrowserSource["state"];
    },
  ): BrowserSource {
    const now = Date.now();
    const source: BrowserSource = {
      ...input,
      adapterId: this.adapterId,
      adapterType: "fake",
      state: input.state ?? "connected",
      connectedAt: input.connectedAt,
      updatedAt: now,
    };
    this.sources.set(source.sourceId, source);
    this.tools.set(source.sourceId, this.tools.get(source.sourceId) ?? new Map());
    this.emit({
      type: "source.connected",
      adapterId: this.adapterId,
      sourceId: source.sourceId,
      sourceGeneration: source.generation,
      revision: ++this.revision,
      source,
    });
    return source;
  }

  disconnectSource(sourceId: string): void {
    const source = this.sources.get(sourceId);
    if (!source) return;
    source.state = "disconnected";
    source.updatedAt = Date.now();
    this.emit({
      type: "source.disconnected",
      adapterId: this.adapterId,
      sourceId,
      sourceGeneration: source.generation,
      revision: ++this.revision,
    });
    this.tools.delete(sourceId);
    this.sources.delete(sourceId);
  }

  reloadSource(sourceId: string): BrowserSource {
    const source = this.sources.get(sourceId);
    if (!source) throw new Error(`unknown source ${sourceId}`);
    source.generation += 1;
    source.updatedAt = Date.now();
    this.tools.set(sourceId, new Map());
    this.emit({
      type: "source.updated",
      adapterId: this.adapterId,
      sourceId,
      sourceGeneration: source.generation,
      revision: ++this.revision,
      source,
    });
    return source;
  }

  registerTool(sourceId: string, tool: RuntimeTool): RuntimeTool {
    const source = this.sources.get(sourceId);
    if (!source) throw new Error(`unknown source ${sourceId}`);
    const complete: RuntimeTool = {
      ...tool,
      identity: {
        ...tool.identity,
        adapterId: this.adapterId,
        sourceId,
        sourceGeneration: source.generation,
      },
    };
    const bucket = this.tools.get(sourceId) ?? new Map();
    const existing = bucket.has(complete.identity.originalName);
    bucket.set(complete.identity.originalName, complete);
    this.tools.set(sourceId, bucket);
    this.emit({
      type: existing ? "tool.updated" : "tool.registered",
      adapterId: this.adapterId,
      sourceId,
      sourceGeneration: source.generation,
      revision: ++this.revision,
      tool: complete,
    });
    return complete;
  }

  unregisterTool(sourceId: string, originalName: string): void {
    const source = this.sources.get(sourceId);
    const tool = this.tools.get(sourceId)?.get(originalName);
    this.tools.get(sourceId)?.delete(originalName);
    this.emit({
      type: "tool.unregistered",
      adapterId: this.adapterId,
      sourceId,
      sourceGeneration: source?.generation ?? 0,
      revision: ++this.revision,
      runtimeId: tool?.identity.runtimeId ?? "",
      originalName,
    });
  }

  setHandler(sourceId: string, originalName: string, handler: FakeToolHandler): void {
    this.handlers.set(this.handlerKey(sourceId, originalName), handler);
  }

  currentRevision(): number {
    return this.revision;
  }

  private handlerKey(sourceId: string, originalName: string): string {
    return `${sourceId}::${originalName}`;
  }

  private emit(event: BrowserAdapterEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

export function discoveredTool(
  originalName: string,
  inputSchema: Record<string, unknown> = { type: "object", properties: {} },
): RuntimeTool {
  const now = Date.now();
  return {
    identity: {
      adapterId: "",
      sourceId: "",
      sourceGeneration: 0,
      originalName,
      runtimeId: "",
      mcpName: originalName,
    },
    description: originalName,
    inputSchema,
    discoveredAt: now,
    updatedAt: now,
  };
}
