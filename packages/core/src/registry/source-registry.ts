import { sourceKey, type BrowserSource } from "@mcp2webmcp/protocol";

export class SourceRegistry {
  private readonly sources = new Map<string, BrowserSource>();

  upsert(source: BrowserSource): void {
    const key = sourceKey(source.adapterId, source.sourceId);
    const existing = this.sources.get(key);
    this.sources.set(key, {
      ...source,
      connectedAt: existing?.connectedAt ?? source.connectedAt,
      updatedAt: source.updatedAt,
    });
  }

  remove(adapterId: string, sourceId: string): void {
    this.sources.delete(sourceKey(adapterId, sourceId));
  }

  get(adapterId: string, sourceId: string): BrowserSource | undefined {
    return this.sources.get(sourceKey(adapterId, sourceId));
  }

  list(): BrowserSource[] {
    return [...this.sources.values()];
  }

  findByOrigin(origin: string): BrowserSource[] {
    return this.list().filter((source) => source.origin === origin);
  }
}
