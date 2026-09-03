import { sourceKey, type RuntimeTool } from "@mcp2webmcp/protocol";

export class ToolRegistry {
  private readonly byRuntimeId = new Map<string, RuntimeTool>();
  private readonly byMcpName = new Map<string, string>();
  private readonly bySource = new Map<string, Set<string>>();

  register(tool: RuntimeTool): void {
    const existing = this.byRuntimeId.get(tool.identity.runtimeId);
    if (existing && existing.identity.mcpName !== tool.identity.mcpName) {
      this.byMcpName.delete(existing.identity.mcpName);
    }
    this.byRuntimeId.set(tool.identity.runtimeId, tool);
    this.byMcpName.set(tool.identity.mcpName, tool.identity.runtimeId);
    const key = sourceKey(tool.identity.adapterId, tool.sourceId);
    const set = this.bySource.get(key) ?? new Set<string>();
    set.add(tool.identity.runtimeId);
    this.bySource.set(key, set);
  }

  unregister(runtimeId: string): void {
    const tool = this.byRuntimeId.get(runtimeId);
    if (!tool) return;
    this.byRuntimeId.delete(runtimeId);
    if (this.byMcpName.get(tool.identity.mcpName) === runtimeId) {
      this.byMcpName.delete(tool.identity.mcpName);
    }
    const key = sourceKey(tool.identity.adapterId, tool.sourceId);
    const set = this.bySource.get(key);
    set?.delete(runtimeId);
    if (set && set.size === 0) this.bySource.delete(key);
  }

  unregisterBySource(adapterId: string, sourceId: string): RuntimeTool[] {
    const key = sourceKey(adapterId, sourceId);
    const ids = [...(this.bySource.get(key) ?? [])];
    const removed: RuntimeTool[] = [];
    for (const id of ids) {
      const tool = this.byRuntimeId.get(id);
      this.unregister(id);
      if (tool) removed.push(tool);
    }
    return removed;
  }

  get(runtimeId: string): RuntimeTool | undefined {
    return this.byRuntimeId.get(runtimeId);
  }

  getByMcpName(mcpName: string): RuntimeTool | undefined {
    const runtimeId = this.byMcpName.get(mcpName);
    return runtimeId ? this.byRuntimeId.get(runtimeId) : undefined;
  }

  findByOriginalName(
    adapterId: string,
    sourceId: string,
    originalName: string,
    generation?: number,
  ): RuntimeTool | undefined {
    const key = sourceKey(adapterId, sourceId);
    for (const runtimeId of this.bySource.get(key) ?? []) {
      const tool = this.byRuntimeId.get(runtimeId);
      if (!tool) continue;
      if (tool.identity.originalName !== originalName) continue;
      if (generation !== undefined && tool.sourceGeneration !== generation) continue;
      return tool;
    }
    return undefined;
  }

  list(): RuntimeTool[] {
    return [...this.byRuntimeId.values()];
  }

  countBySource(adapterId: string, sourceId: string): number {
    return this.bySource.get(sourceKey(adapterId, sourceId))?.size ?? 0;
  }
}
