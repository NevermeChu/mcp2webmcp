import {
  sourceKey,
  type BrowserAdapter,
  type BrowserAdapterEvent,
  type BrowserSource,
  type ResourceLimits,
  type RuntimeTool,
} from "@mcp2webmcp/protocol";
import type { RuntimeEventBus } from "../events/runtime-event-bus.js";
import type { SourceRegistry } from "../registry/source-registry.js";
import type { ToolRegistry } from "../registry/tool-registry.js";
import type { NamespaceResolver } from "../routing/namespace-resolver.js";

interface SourceCursor {
  generation: number;
  revision: number;
}

export class LifecycleManager {
  private readonly last = new Map<string, SourceCursor>();
  private readonly unsubscribers = new Map<string, () => void>();

  constructor(
    private readonly sources: SourceRegistry,
    private readonly tools: ToolRegistry,
    private readonly events: RuntimeEventBus,
    private readonly names: NamespaceResolver,
    private readonly limits: ResourceLimits,
  ) {}

  async attach(adapter: BrowserAdapter): Promise<void> {
    this.detach(adapter.adapterId);
    const pending: BrowserAdapterEvent[] = [];
    let snapshotDone = false;
    const unsub = adapter.subscribe((event) => {
      if (!snapshotDone) {
        pending.push(event);
        return;
      }
      this.onEvent(event);
    });
    this.unsubscribers.set(adapter.adapterId, unsub);
    await this.reconcile(adapter, pending);
    snapshotDone = true;
    for (const event of pending) this.onEvent(event);
  }

  detach(adapterId: string): void {
    this.unsubscribers.get(adapterId)?.();
    this.unsubscribers.delete(adapterId);
  }

  onEvent(event: BrowserAdapterEvent): void {
    const key = sourceKey(event.adapterId, event.sourceId);
    const cursor = this.last.get(key);
    if (cursor) {
      if (event.sourceGeneration < cursor.generation) return;
      if (event.sourceGeneration === cursor.generation && event.revision <= cursor.revision) return;
    }

    switch (event.type) {
      case "source.connected":
      case "source.updated":
        this.upsertSource(event.source, event.revision);
        break;
      case "source.disconnected":
        this.removeSource(event.adapterId, event.sourceId, event.sourceGeneration, event.revision);
        break;
      case "tool.registered":
      case "tool.updated":
        this.upsertTool(event.adapterId, event.tool, event.revision);
        break;
      case "tool.unregistered":
        this.removeTool(event, event.revision);
        break;
    }
  }

  private async reconcile(adapter: BrowserAdapter, buffered: BrowserAdapterEvent[]): Promise<void> {
    const listed = await adapter.listSources();
    for (const source of listed) {
      const maxRevision = Math.max(
        0,
        ...buffered
          .filter((event) => event.sourceId === source.sourceId)
          .map((event) => event.revision),
      );
      this.upsertSource(source, maxRevision);
      const tools = await adapter.listTools(source.sourceId);
      for (const tool of tools) {
        this.upsertTool(adapter.adapterId, tool, maxRevision);
      }
    }
  }

  private upsertSource(source: BrowserSource, revision: number): void {
    const key = sourceKey(source.adapterId, source.sourceId);
    const previous = this.sources.get(source.adapterId, source.sourceId);
    if (previous && source.generation > previous.generation) {
      const removed = this.tools.unregisterBySource(source.adapterId, source.sourceId);
      for (const tool of removed) {
        this.events.publish({
          type: "tool.removed",
          runtimeId: tool.identity.runtimeId,
          sourceId: tool.sourceId,
          sourceGeneration: tool.sourceGeneration,
        });
      }
    }
    this.sources.upsert(source);
    this.last.set(key, { generation: source.generation, revision });
    if (!previous) {
      this.events.publish({ type: "source.added", source });
    }
  }

  private removeSource(
    adapterId: string,
    sourceId: string,
    generation: number,
    revision: number,
  ): void {
    const existing = this.sources.get(adapterId, sourceId);
    const removed = this.tools.unregisterBySource(adapterId, sourceId);
    for (const tool of removed) {
      this.events.publish({
        type: "tool.removed",
        runtimeId: tool.identity.runtimeId,
        sourceId: tool.sourceId,
        sourceGeneration: tool.sourceGeneration,
      });
    }
    this.sources.remove(adapterId, sourceId);
    this.last.set(sourceKey(adapterId, sourceId), { generation, revision });
    this.events.publish({
      type: "source.removed",
      sourceId,
      sourceGeneration: existing?.generation ?? generation,
    });
  }

  private upsertTool(adapterId: string, incoming: RuntimeTool, revision: number): void {
    const source = this.sources.get(adapterId, incoming.sourceId);
    if (!source || source.generation !== incoming.sourceGeneration) {
      return;
    }
    const identity = this.names.resolve(source, incoming.identity.originalName);
    const previous = this.tools.get(identity.runtimeId);
    if (!previous) {
      if (this.tools.list().length >= this.limits.maxToolsTotal) return;
      if (this.tools.countBySource(adapterId, incoming.sourceId) >= this.limits.maxToolsPerSource) {
        return;
      }
    }
    const tool: RuntimeTool = {
      ...incoming,
      identity,
      sourceId: source.sourceId,
      sourceGeneration: source.generation,
      status: "available",
      updatedAt: Date.now(),
    };
    this.tools.register(tool);
    this.last.set(sourceKey(adapterId, incoming.sourceId), {
      generation: incoming.sourceGeneration,
      revision,
    });
    this.events.publish({
      type: previous ? "tool.updated" : "tool.added",
      tool,
    });
  }

  private removeTool(
    event: Extract<BrowserAdapterEvent, { type: "tool.unregistered" }>,
    revision: number,
  ): void {
    const byId = this.tools.get(event.runtimeId);
    const tool =
      byId ??
      this.tools.findByOriginalName(
        event.adapterId,
        event.sourceId,
        event.originalName,
        event.sourceGeneration,
      );
    if (tool) {
      this.tools.unregister(tool.identity.runtimeId);
      this.events.publish({
        type: "tool.removed",
        runtimeId: tool.identity.runtimeId,
        sourceId: tool.sourceId,
        sourceGeneration: tool.sourceGeneration,
      });
    }
    this.last.set(sourceKey(event.adapterId, event.sourceId), {
      generation: event.sourceGeneration,
      revision,
    });
  }
}
