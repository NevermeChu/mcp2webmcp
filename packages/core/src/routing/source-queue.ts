import { RuntimeError } from "@mcp2webmcp/protocol";

export class SourceInvocationQueue {
  private readonly pending = new Map<string, number>();
  private readonly tail = new Map<string, Promise<void>>();

  constructor(private readonly maxQueuePerSource: number) {}

  async run<T>(sourceKey: string, task: () => Promise<T>): Promise<T> {
    const queued = this.pending.get(sourceKey) ?? 0;
    if (queued >= this.maxQueuePerSource) {
      throw new RuntimeError("RATE_LIMITED", "per-source invocation queue is full");
    }
    this.pending.set(sourceKey, queued + 1);
    const previous = this.tail.get(sourceKey) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tail.set(
      sourceKey,
      previous.then(() => gate).catch(() => gate),
    );
    await previous.catch(() => undefined);
    try {
      return await task();
    } finally {
      const next = (this.pending.get(sourceKey) ?? 1) - 1;
      if (next <= 0) this.pending.delete(sourceKey);
      else this.pending.set(sourceKey, next);
      release();
    }
  }
}
