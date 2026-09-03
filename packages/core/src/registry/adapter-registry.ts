import type { AdapterRegistry, BrowserAdapter } from "@mcp2webmcp/protocol";

export class InMemoryAdapterRegistry implements AdapterRegistry {
  private readonly adapters = new Map<string, BrowserAdapter>();

  register(adapter: BrowserAdapter): void {
    this.adapters.set(adapter.adapterId, adapter);
  }

  unregister(adapterId: string): void {
    this.adapters.delete(adapterId);
  }

  get(adapterId: string): BrowserAdapter | undefined {
    return this.adapters.get(adapterId);
  }

  list(): BrowserAdapter[] {
    return [...this.adapters.values()];
  }
}
