import type { RuntimeEvent, RuntimeEventBody } from "@mcp2webmcp/protocol";

export type RuntimeEventHandler = (event: RuntimeEvent) => void;

export class RuntimeEventBus {
  private revision = 0;
  private readonly handlers = new Set<RuntimeEventHandler>();

  subscribe(handler: RuntimeEventHandler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  publish(event: RuntimeEventBody): RuntimeEvent {
    this.revision += 1;
    const full = {
      ...event,
      runtimeRevision: this.revision,
      timestamp: Date.now(),
    } as RuntimeEvent;
    for (const handler of this.handlers) {
      handler(full);
    }
    return full;
  }

  currentRevision(): number {
    return this.revision;
  }
}
