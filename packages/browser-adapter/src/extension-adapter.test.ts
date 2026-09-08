import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { ExtensionAdapter } from "./extension-adapter.js";
import {
  EXTENSION_PROTOCOL,
  EXTENSION_PROTOCOL_VERSION,
  parseExtensionClientMessage,
} from "./extension-protocol.js";
import type { ExtensionServerMessage } from "./extension-protocol.js";

const TEST_TOKEN = "test-extension-token";

class FakeExtensionClient {
  readonly received: ExtensionServerMessage[] = [];
  closeCode = 0;
  private readonly waiters: Array<(message: ExtensionServerMessage) => void> = [];

  private constructor(private readonly socket: WebSocket) {
    socket.on("close", (code) => {
      this.closeCode = code;
    });
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

  static async connect(
    port: number,
    options: { origin?: string | null } = {},
  ): Promise<FakeExtensionClient> {
    const headers: Record<string, string> = {
      origin:
        options.origin === null ? "" : (options.origin ?? "chrome-extension://test-extension"),
    };
    if (options.origin === null) delete headers.origin;
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, { headers });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    return new FakeExtensionClient(socket);
  }

  send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }

  async hello(token = TEST_TOKEN): Promise<ExtensionServerMessage> {
    const ack = this.waitFor((message) => message.type === "helloAck");
    this.send({
      type: "hello",
      protocol: EXTENSION_PROTOCOL,
      protocolVersion: EXTENSION_PROTOCOL_VERSION,
      token,
    });
    return ack;
  }

  async closed(): Promise<number> {
    if (this.socket.readyState === WebSocket.CLOSED) return this.closeCode;
    return new Promise((resolve) => {
      this.socket.once("close", (code) => resolve(code));
    });
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
      authToken: TEST_TOKEN,
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
      sourceGeneration: invoke.sourceGeneration,
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

  it("projects any origin when allowedOrigins is empty", async () => {
    const { adapter, client } = await boot([]);
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
    await waitFor(async () => (await adapter.listTools("tab:9")).length === 1);
    expect((await adapter.listSources())[0]?.origin).toBe("http://localhost:18081");
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

  it("does not reuse a source generation after removal", async () => {
    const { adapter, client } = await boot();
    const source = {
      type: "source.upsert" as const,
      sourceId: "tab:30",
      tabId: "30",
      origin: "http://127.0.0.1:18081",
      url: "http://127.0.0.1:18081/",
      reason: "connect" as const,
    };
    client.send(source);
    await waitFor(async () => (await adapter.listSources())[0]?.generation === 1);
    client.send({ type: "source.remove", sourceId: source.sourceId });
    await waitFor(async () => (await adapter.listSources()).length === 0);
    client.send(source);
    await waitFor(async () => (await adapter.listSources())[0]?.generation === 2);
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
    await client.waitFor(
      (message) => message.type === "sourceAck" && message.sourceGeneration === 2,
    );
  });

  it("does not emit tool.updated when tools.replace is identical", async () => {
    const { adapter, client } = await boot();
    const events: string[] = [];
    adapter.subscribe((event) => events.push(event.type));
    client.send({
      type: "source.upsert",
      sourceId: "tab:5",
      tabId: "5",
      origin: "http://127.0.0.1:18081",
      url: "http://127.0.0.1:18081/",
      reason: "connect",
    });
    const tools = [{ originalName: "echo", inputSchema: { type: "object", properties: {} } }];
    client.send({ type: "tools.replace", sourceId: "tab:5", tools });
    await waitFor(async () => (await adapter.listTools("tab:5")).length === 1);
    const afterFirst = events.filter((type) => type.startsWith("tool.")).length;
    client.send({ type: "tools.replace", sourceId: "tab:5", tools });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(events.filter((type) => type.startsWith("tool.")).length).toBe(afterFirst);
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
      annotations: undefined,
    });
  });

  it("rejects stale-protocol results and oversized tool snapshots", () => {
    expect(
      parseExtensionClientMessage(
        JSON.stringify({
          type: "invokeResult",
          requestId: "r1",
          sourceId: "tab:1",
          content: [],
        }),
      ),
    ).toBeUndefined();
    expect(
      parseExtensionClientMessage(
        JSON.stringify({
          type: "tools.replace",
          sourceId: "tab:1",
          tools: Array.from({ length: 501 }, () => ({ originalName: "echo", inputSchema: {} })),
        }),
      ),
    ).toBeUndefined();
  });

  it("strips secret-like fields from client log frames", () => {
    const parsed = parseExtensionClientMessage(
      JSON.stringify({
        type: "log",
        hop: "page",
        event: "runtime.wrapped",
        data: { originalName: "echo", cookie: "sid=1", names: ["echo"] },
      }),
    );
    expect(parsed?.type).toBe("log");
    if (parsed?.type !== "log") throw new Error("expected log");
    expect(parsed.hop).toBe("page");
    expect(parsed.data).toEqual({ originalName: "echo", names: ["echo"] });
  });

  it("records extension log frames on the gateway sink", async () => {
    const records: Array<{ event: string; hop?: string }> = [];
    const adapter = new ExtensionAdapter({
      adapterId: "ext-1",
      allowedOrigins: [],
      port: 0,
      authToken: TEST_TOKEN,
      log: {
        path: "",
        write(record) {
          records.push(record);
        },
        recent() {
          return [];
        },
      },
    });
    adapters.push(adapter);
    await adapter.start();
    const client = await FakeExtensionClient.connect(adapter.listenPort);
    clients.push(client);
    await client.hello();
    client.send({
      type: "log",
      hop: "extension",
      event: "page.snapshot",
      data: { count: 1, names: ["echo"] },
    });
    await waitFor(() => records.some((row) => row.event === "page.snapshot"));
    expect(records.find((row) => row.event === "page.snapshot")?.hop).toBe("extension");
  });

  it("refuses to construct with wildcard origins or a non-loopback host", () => {
    expect(() => new ExtensionAdapter({ allowedOrigins: ["*"], authToken: TEST_TOKEN })).toThrow(
      /\*/,
    );
    expect(() => new ExtensionAdapter({ allowedOrigins: [], authToken: TEST_TOKEN })).not.toThrow();
    expect(() => new ExtensionAdapter({ allowedOrigins: [], authToken: "" })).toThrow(/authToken/);
    expect(
      () =>
        new ExtensionAdapter({
          allowedOrigins: ["http://127.0.0.1:18081"],
          host: "0.0.0.0",
          authToken: TEST_TOKEN,
        }),
    ).toThrow(/loopback/);
  });

  it("rejects connections without a chrome-extension origin", async () => {
    const adapter = new ExtensionAdapter({
      adapterId: "ext-1",
      allowedOrigins: [],
      port: 0,
      authToken: TEST_TOKEN,
    });
    adapters.push(adapter);
    await adapter.start();
    const client = await FakeExtensionClient.connect(adapter.listenPort, { origin: null });
    clients.push(client);
    expect(await client.closed()).toBe(4003);
  });

  it("requires the configured hello token and accepts the matching one", async () => {
    const adapter = new ExtensionAdapter({
      adapterId: "ext-1",
      allowedOrigins: [],
      port: 0,
      authToken: "s3cret",
    });
    adapters.push(adapter);
    await adapter.start();
    const bad = await FakeExtensionClient.connect(adapter.listenPort);
    clients.push(bad);
    bad.send({
      type: "hello",
      protocol: EXTENSION_PROTOCOL,
      protocolVersion: EXTENSION_PROTOCOL_VERSION,
      token: "wrong-token",
    });
    expect(await bad.closed()).toBe(4001);

    const good = await FakeExtensionClient.connect(adapter.listenPort);
    clients.push(good);
    await good.hello("s3cret");
    await good.waitFor((message) => message.type === "helloAck");
  });

  it("replaces an established session only after a successful hello", async () => {
    const { adapter, client } = await boot();
    const second = await FakeExtensionClient.connect(adapter.listenPort);
    clients.push(second);
    await second.hello();
    await second.waitFor((message) => message.type === "helloAck");
    expect(await client.closed()).toBe(4000);
    expect(await adapter.listSources()).toHaveLength(0);
  });

  it("keeps sources during the disconnect grace period", async () => {
    const adapter = new ExtensionAdapter({
      adapterId: "ext-1",
      allowedOrigins: [],
      port: 0,
      disconnectGraceMs: 300,
      authToken: TEST_TOKEN,
    });
    adapters.push(adapter);
    await adapter.start();
    const client = await FakeExtensionClient.connect(adapter.listenPort);
    clients.push(client);
    await client.hello();
    client.send({
      type: "source.upsert",
      sourceId: "tab:7",
      tabId: "7",
      origin: "http://127.0.0.1:18081",
      url: "http://127.0.0.1:18081/",
      reason: "connect",
    });
    client.send({
      type: "tools.replace",
      sourceId: "tab:7",
      tools: [{ originalName: "echo", inputSchema: { type: "object", properties: {} } }],
    });
    await waitFor(async () => (await adapter.listTools("tab:7")).length === 1);
    client.close();
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(await adapter.listSources()).toHaveLength(1);
    await waitFor(async () => (await adapter.listSources()).length === 0);
  });

  it("cancels the grace period when the extension reconnects", async () => {
    const adapter = new ExtensionAdapter({
      adapterId: "ext-1",
      allowedOrigins: [],
      port: 0,
      disconnectGraceMs: 250,
      authToken: TEST_TOKEN,
    });
    adapters.push(adapter);
    await adapter.start();
    const first = await FakeExtensionClient.connect(adapter.listenPort);
    clients.push(first);
    await first.hello();
    first.send({
      type: "source.upsert",
      sourceId: "tab:8",
      tabId: "8",
      origin: "http://127.0.0.1:18081",
      url: "http://127.0.0.1:18081/",
      reason: "connect",
    });
    await waitFor(async () => (await adapter.listSources()).length === 1);
    first.close();
    await new Promise((resolve) => setTimeout(resolve, 80));
    const second = await FakeExtensionClient.connect(adapter.listenPort);
    clients.push(second);
    await second.hello();
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(await adapter.listSources()).toHaveLength(1);
  });
});

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timeout");
}
