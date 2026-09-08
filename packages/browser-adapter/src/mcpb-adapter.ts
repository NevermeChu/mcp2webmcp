import type {
  BrowserAdapter,
  BrowserAdapterEvent,
  BrowserSource,
  BrowserToolInvokeRequest,
  BrowserToolInvokeResult,
  RuntimeTool,
} from "@mcp2webmcp/protocol";
import {
  createRelayBridge,
  type CreateRelayBridgeOptions,
  type McpbRelayBridge,
  type McpbRelaySnapshotSource,
  type McpbRelaySnapshotTool,
} from "./mcpb-bridge.js";
import { assertExplicitOrigins, assertLoopbackHost, normalizeLoopbackHost } from "./mcpb-safety.js";

export interface McpBAdapterOptions extends CreateRelayBridgeOptions {
  adapterId?: string;
  /** Injected public-API seam for tests. Production omits this and constructs RelayBridgeServer. */
  bridge?: McpbRelayBridge;
}

export class McpBAdapter implements BrowserAdapter {
  readonly type = "mcpb";
  readonly adapterId: string;
  private revision = 0;
  private syncTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Set<(event: BrowserAdapterEvent) => void>();
  private readonly sources = new Map<string, BrowserSource>();
  private readonly sourceGenerations = new Map<string, number>();
  private readonly tools = new Map<string, Map<string, RuntimeTool>>();
  private readonly invokeNames = new Map<string, string>();
  private readonly onStateChanged = (): void => this.scheduleSync();
  private bridge: McpbRelayBridge | undefined;
  private readonly options: McpBAdapterOptions;

  constructor(options: McpBAdapterOptions) {
    assertExplicitOrigins(options.allowedOrigins);
    if (options.host) {
      assertLoopbackHost(normalizeLoopbackHost(options.host));
    }
    this.adapterId = options.adapterId ?? "mcpb-1";
    this.options = options;
  }

  async start(): Promise<void> {
    this.bridge = this.options.bridge ?? createRelayBridge(this.options);
    this.bridge.on("stateChanged", this.onStateChanged);
    await this.bridge.start();
    this.sync();
  }

  async stop(): Promise<void> {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.bridge?.off("stateChanged", this.onStateChanged);
    await this.bridge?.stop();
    this.bridge = undefined;
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
    const invokeName = this.invokeNames.get(this.invokeKey(request.sourceId, request.originalName));
    if (!invokeName) {
      throw new Error(`tool not published by relay: ${request.originalName}`);
    }
    if (!this.bridge) {
      throw new Error("mcpb adapter is not started");
    }
    if (options.signal.aborted) {
      throw new Error("invocation cancelled");
    }
    const args = asInvokeArgs(request.input);
    return await Promise.race([
      this.bridge.invokeTool(invokeName, args, { sourceId: request.sourceId }),
      abortPromise(options.signal),
    ]);
  }

  private scheduleSync(): void {
    if (this.syncTimer) clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => this.sync(), 25);
  }

  private sync(): void {
    if (!this.bridge) return;
    const snapshot = this.bridge.snapshot();
    const sourceById = new Map(snapshot.sources.map((source) => [source.sourceId, source]));
    for (const sourceId of [...this.sources.keys()]) {
      if (!sourceById.has(sourceId)) this.removeSource(sourceId);
    }
    for (const relaySource of snapshot.sources) {
      this.upsertSource(relaySource);
    }
    const toolsBySource = groupTools(snapshot.tools);
    for (const [sourceId, tools] of toolsBySource) {
      if (!this.sources.has(sourceId)) continue;
      this.reconcileTools(sourceId, tools);
    }
    for (const sourceId of this.tools.keys()) {
      if (!toolsBySource.has(sourceId) && this.sources.has(sourceId)) {
        this.reconcileTools(sourceId, []);
      }
    }
  }

  private upsertSource(relaySource: McpbRelaySnapshotSource): void {
    const origin = relaySource.origin || "unknown://source";
    const url = relaySource.url || origin;
    const existing = this.sources.get(relaySource.sourceId);
    const now = Date.now();
    if (!existing) {
      const generation = (this.sourceGenerations.get(relaySource.sourceId) ?? 0) + 1;
      const source: BrowserSource = {
        adapterId: this.adapterId,
        sourceId: relaySource.sourceId,
        generation,
        browserId: "mcpb-relay",
        tabId: relaySource.tabId || relaySource.sourceId,
        origin,
        url,
        title: relaySource.title,
        adapterType: "mcpb",
        connectedAt: relaySource.connectedAt || now,
        updatedAt: now,
        state: "connected",
      };
      this.sourceGenerations.set(source.sourceId, generation);
      this.sources.set(source.sourceId, source);
      this.tools.set(source.sourceId, new Map());
      this.emit({
        type: "source.connected",
        adapterId: this.adapterId,
        sourceId: source.sourceId,
        sourceGeneration: source.generation,
        revision: ++this.revision,
        source,
      });
      return;
    }

    const navigated = existing.origin !== origin || existing.url !== url;
    if (navigated) {
      existing.generation += 1;
      this.sourceGenerations.set(existing.sourceId, existing.generation);
      this.clearTools(existing.sourceId);
    }
    existing.origin = origin;
    existing.url = url;
    existing.title = relaySource.title;
    existing.tabId = relaySource.tabId || existing.tabId;
    existing.updatedAt = now;
    existing.state = "connected";
    this.emit({
      type: "source.updated",
      adapterId: this.adapterId,
      sourceId: existing.sourceId,
      sourceGeneration: existing.generation,
      revision: ++this.revision,
      source: existing,
    });
  }

  private removeSource(sourceId: string): void {
    const source = this.sources.get(sourceId);
    if (!source) return;
    this.clearTools(sourceId);
    this.sources.delete(sourceId);
    this.tools.delete(sourceId);
    this.emit({
      type: "source.disconnected",
      adapterId: this.adapterId,
      sourceId,
      sourceGeneration: source.generation,
      revision: ++this.revision,
    });
  }

  private reconcileTools(sourceId: string, incoming: McpbRelaySnapshotTool[]): void {
    const source = this.sources.get(sourceId);
    if (!source) return;
    const bucket = this.tools.get(sourceId) ?? new Map();
    const nextNames = new Set(incoming.map((tool) => tool.originalName));
    for (const originalName of [...bucket.keys()]) {
      if (!nextNames.has(originalName)) {
        this.unregisterTool(source, originalName);
      }
    }
    for (const tool of incoming) {
      this.upsertTool(source, tool);
    }
  }

  private upsertTool(source: BrowserSource, incoming: McpbRelaySnapshotTool): void {
    const bucket = this.tools.get(source.sourceId) ?? new Map();
    const existing = bucket.get(incoming.originalName);
    const now = Date.now();
    const complete: RuntimeTool = {
      identity: {
        adapterId: this.adapterId,
        sourceId: source.sourceId,
        sourceGeneration: source.generation,
        originalName: incoming.originalName,
        runtimeId: existing?.identity.runtimeId || "pending",
        mcpName: existing?.identity.mcpName || incoming.originalName,
      },
      description: incoming.description,
      inputSchema: incoming.inputSchema,
      annotations: incoming.annotations,
      discoveredAt: existing?.discoveredAt ?? now,
      updatedAt: now,
    };
    bucket.set(incoming.originalName, complete);
    this.tools.set(source.sourceId, bucket);
    this.invokeNames.set(
      this.invokeKey(source.sourceId, incoming.originalName),
      incoming.invokeName,
    );
    this.emit({
      type: existing ? "tool.updated" : "tool.registered",
      adapterId: this.adapterId,
      sourceId: source.sourceId,
      sourceGeneration: source.generation,
      revision: ++this.revision,
      tool: complete,
    });
  }

  private unregisterTool(source: BrowserSource, originalName: string): void {
    const tool = this.tools.get(source.sourceId)?.get(originalName);
    this.tools.get(source.sourceId)?.delete(originalName);
    this.invokeNames.delete(this.invokeKey(source.sourceId, originalName));
    this.emit({
      type: "tool.unregistered",
      adapterId: this.adapterId,
      sourceId: source.sourceId,
      sourceGeneration: source.generation,
      revision: ++this.revision,
      runtimeId: tool?.identity.runtimeId ?? "",
      originalName,
    });
  }

  private clearTools(sourceId: string): void {
    const source = this.sources.get(sourceId);
    const names = [...(this.tools.get(sourceId)?.keys() ?? [])];
    for (const originalName of names) {
      if (source) this.unregisterTool(source, originalName);
      else this.invokeNames.delete(this.invokeKey(sourceId, originalName));
    }
    this.tools.set(sourceId, new Map());
  }

  private invokeKey(sourceId: string, originalName: string): string {
    return `${sourceId}::${originalName}`;
  }

  private emit(event: BrowserAdapterEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function groupTools(tools: McpbRelaySnapshotTool[]): Map<string, McpbRelaySnapshotTool[]> {
  const grouped = new Map<string, McpbRelaySnapshotTool[]>();
  for (const tool of tools) {
    for (const sourceId of tool.sourceIds) {
      const list = grouped.get(sourceId) ?? [];
      list.push(tool);
      grouped.set(sourceId, list);
    }
  }
  return grouped;
}

function asInvokeArgs(input: unknown): Record<string, unknown> | undefined {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  if (input === undefined) return undefined;
  return { value: input };
}

function abortPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const fail = () => reject(new Error("invocation cancelled"));
    if (signal.aborted) {
      fail();
      return;
    }
    signal.addEventListener("abort", fail, { once: true });
  });
}
