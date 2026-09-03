import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { ExtensionAdapter } from "./extension-adapter.js";
import {
  EXTENSION_PROTOCOL,
  EXTENSION_PROTOCOL_VERSION,
  parseExtensionClientMessage,
} from "./extension-protocol.js";
import type { ExtensionClientMessage, ExtensionServerMessage } from "./extension-protocol.js";

class FakeExtensionClient {
  readonly received: ExtensionServerMessage[] = [];
  private readonly waiters: Array<(message: ExtensionServerMessage) => void> = [];

  private constructor(private readonly socket: WebSocket) {
    socket.on("message", (data) => {
      const text = typeof data === "string" ? data : data.toString();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return;
      }
      if (!parsed || typeof parsed !== "object" || !("type" in parsed)) return;
      const message = parsed as ExtensionServerMessage;
      if (message.type === "ping") {
        this.send({ type: "pong", id: message.id });
      }
      this.received.push(message);
      const waiter = this.waiters.shift();
      if (waiter) waiter(message);
    });
  }

  static async connect(port: number): Promise<FakeExtensionClient> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    return new FakeExtensionClient(socket);
  }

  send(message: ExtensionClientMessage): void {
    this.socket.send(JSON.stringify(message));
  }

  async hello(): Promise<ExtensionServerMessage> {
    const ack = this.waitFor((message) => message.type === "helloAck");
    this.send({
      type: "hello",
      protocol: EXTENSION_PROTOCOL,
      protocolVersion: EXTENSION_PROTOCOL_VERSION,
    });
    return ack;
  }

  async waitFor(
    predicate: (message: ExtensionServerMessage) => boolean,
    timeoutMs = 2_000,
  ): Promise<ExtensionServerMessage> {
    const existing = this.received.find(predicate);
    if (existing) return existing;
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("fake client wait timeout")), timeoutMs);
      const probe = (message: ExtensionServerMessage) => {
        if (!predicate(message)) {
          this.waiters.unshift(probe);
          return;
        }
        clearTimeout(timer);
        resolve(message);
      };
      this.waiters.push(probe);
    });
  }

  close(): void {
    this.socket.close();
  }
}

describe("ExtensionAdapter", () => {
  const adapters: ExtensionAdapter[] = [];
  const clients: FakeExtensionClient[] = [];

  afterEach(async () => {
    for (const client of clients.splice(0)) client.close();
    for (const adapter of adapters.splice(0)) {
      await adapter.stop().catch(() => undefined);
    }
  });

  async function boot(allowedOrigins = ["http://127.0.0.1:18081"]) {
    const adapter = new ExtensionAdapter({
      adapterId: "ext-1",
      allowedOrigins,
      port: 0,
    });
    adapters.push(adapter);
    await adapter.start();
    const client = await FakeExtensionClient.connect(adapter.listenPort);
    clients.push(client);
    await client.hello();
    return { adapter, client };
  }

  it("maps upsert + tools.replace to BrowserSource / RuntimeTool and invokes by originalName", async () => {
    const { adapter, client } = await boot();
    const events: string[] = [];
    adapter.subscribe((event) => events.push(event.type));
    client.send({
      type: "source.upsert",
      sourceId: "tab:18",
      tabId: "18",
      origin: "http://127.0.0.1:18081",
      url: "http://127.0.0.1:18081/",
      title: "echo page",
      reason: "connect",
    });
    client.send({
      type: "tools.replace",
      sourceId: "tab:18",
      tools: [
        {
          originalName: "echo",
          description: "Echo the provided message",
          inputSchema: {
            type: "object",
            properties: { message: { type: "string" } },
            required: ["message"],
          },
          annotations: { readOnlyHint: true, idempotentHint: true },
        },
      ],
    });
    await waitFor(async () => (await adapter.listTools("tab:18")).length === 1);
    const sources = await adapter.listSources();
    expect(sources).toHaveLength(1);
    expect(sources[0]?.adapterType).toBe("extension");
    expect(sources[0]?.sourceId).toBe("tab:18");
    expect(sources[0]?.origin).toBe("http://127.0.0.1:18081");
    const tools = await adapter.listTools("tab:18");
    expect(tools[0]?.identity.originalName).toBe("echo");

    const invokePromise = adapter.invokeTool(
      {
        requestId: "r1",
        sourceId: "tab:18",
        sourceGeneration: 1,
        originalName: "echo",
        input: { message: "hello" },
      },
      { signal: new AbortController().signal, deadline: Date.now() + 5_000 },
    );
    const invoke = await client.waitFor((message) => message.type === "invoke");
    expect(invoke).toMatchObject({
      type: "invoke",
      originalName: "echo",
      sourceId: "tab:18",
      args: { message: "hello" },
    });
    if (invoke.type !== "invoke") throw new Error("expected invoke");
    client.send({
      type: "invokeResult",
      requestId: invoke.requestId,
      sourceId: "tab:18",
      content: [{ type: "text", text: "echo:hello" }],
    });
    const result = await invokePromise;
    expect(JSON.stringify(result.content)).toContain("echo:hello");
    expect(events).toContain("source.connected");
    expect(events).toContain("tool.registered");
  });

  it("does not project origins outside allowedOrigins (localhost ≠ 127.0.0.1)", async () => {
    const { adapter, client } = await boot(["http://127.0.0.1:18081"]);
    client.send({
      type: "source.upsert",
      sourceId: "tab:9",
      tabId: "9",
      origin: "http://localhost:18081",
      url: "http://localhost:18081/",
      reason: "connect",
    });
    client.send({
      type: "tools.replace",
      sourceId: "tab:9",
      tools: [{ originalName: "echo", inputSchema: { type: "object", properties: {} } }],
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(await adapter.listSources()).toHaveLength(0);
    expect(await adapter.listTools("tab:9")).toHaveLength(0);
  });

  it("emits source.disconnected when the tab is removed", async () => {
    const { adapter, client } = await boot();
    const events: string[] = [];
    adapter.subscribe((event) => events.push(event.type));
    client.send({
      type: "source.upsert",
      sourceId: "tab:3",
      tabId: "3",
      origin: "http://127.0.0.1:18081",
      url: "http://127.0.0.1:18081/",
      reason: "connect",
    });
    client.send({
      type: "tools.replace",
      sourceId: "tab:3",
      tools: [{ originalName: "echo", inputSchema: { type: "object", properties: {} } }],
    });
    await waitFor(async () => (await adapter.listTools("tab:3")).length === 1);
    client.send({ type: "source.remove", sourceId: "tab:3" });
    await waitFor(async () => (await adapter.listSources()).length === 0);
    expect(events).toContain("tool.unregistered");
    expect(events).toContain("source.disconnected");
  });

  it("bumps generation on reload of the same url", async () => {
    const { adapter, client } = await boot();
    client.send({
      type: "source.upsert",
      sourceId: "tab:4",
      tabId: "4",
      origin: "http://127.0.0.1:18081",
      url: "http://127.0.0.1:18081/",
      reason: "connect",
    });
    await waitFor(async () => (await adapter.listSources())[0]?.generation === 1);
    client.send({
      type: "source.upsert",
      sourceId: "tab:4",
      tabId: "4",
      origin: "http://127.0.0.1:18081",
      url: "http://127.0.0.1:18081/",
      reason: "reload",
    });
    await waitFor(async () => (await adapter.listSources())[0]?.generation === 2);
  });

  it("strips non-descriptor fields from tools.replace", () => {
    const parsed = parseExtensionClientMessage(
      JSON.stringify({
        type: "tools.replace",
        sourceId: "tab:1",
        tools: [
          {
            originalName: "echo",
            inputSchema: { type: "object" },
            cookie: "secret",
            authorization: "Bearer x",
            annotations: { readOnlyHint: true, extra: true },
          },
        ],
      }),
    );
    expect(parsed?.type).toBe("tools.replace");
    if (parsed?.type !== "tools.replace") throw new Error("expected tools.replace");
    expect(parsed.tools[0]).toEqual({
      originalName: "echo",
      description: undefined,
      inputSchema: { type: "object" },
      annotations: { readOnlyHint: true },
    });
  });

  it("refuses to construct with wildcard origins or a non-loopback host", () => {
    expect(() => new ExtensionAdapter({ allowedOrigins: ["*"] })).toThrow(/\*/);
    expect(
      () =>
        new ExtensionAdapter({
          allowedOrigins: ["http://127.0.0.1:18081"],
          host: "0.0.0.0",
        }),
    ).toThrow(/loopback/);
  });
});

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 2_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timeout");
}
