import { afterEach, describe, expect, it } from "vitest";
import { McpBAdapter } from "./mcpb-adapter.js";
import {
  demoRelaySource,
  demoRelayTool,
  FakeRelayBridge,
} from "../test-fixtures/fake-relay-bridge.js";
import {
  assertExplicitOrigins,
  assertLoopbackHost,
  assertOriginPolicy,
  originIsAllowed,
} from "./mcpb-safety.js";

describe("mcpb safety", () => {
  it("rejects wildcard origins and non-loopback hosts", () => {
    expect(() => assertExplicitOrigins(["*"])).toThrow(/\*/);
    expect(() => assertExplicitOrigins([])).toThrow(/explicit/);
    expect(() => assertOriginPolicy(["*"])).toThrow(/\*/);
    expect(originIsAllowed([], "http://127.0.0.1:18081")).toBe(true);
    expect(originIsAllowed(["http://127.0.0.1:18081"], "http://localhost:18081")).toBe(false);
    expect(() => assertLoopbackHost("0.0.0.0")).toThrow(/loopback/);
    expect(() => assertLoopbackHost("127.0.0.1")).not.toThrow();
  });
});

describe("McpBAdapter", () => {
  const adapters: McpBAdapter[] = [];

  afterEach(async () => {
    for (const adapter of adapters.splice(0)) {
      await adapter.stop().catch(() => undefined);
    }
  });

  async function boot(relay: FakeRelayBridge) {
    const adapter = new McpBAdapter({
      adapterId: "mcpb-1",
      allowedOrigins: ["https://knowmesh.app"],
      bridge: relay,
    });
    adapters.push(adapter);
    await adapter.start();
    return adapter;
  }

  it("maps relay snapshot to BrowserSource / RuntimeTool and invokes by original name + sourceId", async () => {
    const relay = new FakeRelayBridge();
    relay.setSnapshot([demoRelaySource()], [demoRelayTool()]);
    const adapter = await boot(relay);
    const sources = await adapter.listSources();
    expect(sources).toHaveLength(1);
    expect(sources[0]?.origin).toBe("https://knowmesh.app");
    expect(sources[0]?.adapterType).toBe("mcpb");
    const tools = await adapter.listTools("conn-1");
    expect(tools[0]?.identity.originalName).toBe("echo");
    const result = await adapter.invokeTool(
      {
        requestId: "r1",
        sourceId: "conn-1",
        sourceGeneration: 1,
        originalName: "echo",
        input: { hello: "adapter" },
      },
      { signal: new AbortController().signal, deadline: Date.now() + 1000 },
    );
    expect(JSON.stringify(result.content)).toContain("adapter");
    expect(relay.invokeCalls[0]).toMatchObject({
      toolName: "echo_943b",
      sourceId: "conn-1",
    });
  });

  it("emits connect/register then unregisters on snapshot shrink", async () => {
    const relay = new FakeRelayBridge();
    const adapter = await boot(relay);
    const events: string[] = [];
    adapter.subscribe((event) => events.push(event.type));
    relay.setSnapshot([demoRelaySource()], [demoRelayTool()]);
    await waitFor(async () => (await adapter.listTools("conn-1")).length === 1);
    relay.setSnapshot([], []);
    await waitFor(async () => (await adapter.listSources()).length === 0);
    expect(events).toContain("source.connected");
    expect(events).toContain("tool.registered");
    expect(events).toContain("tool.unregistered");
    expect(events).toContain("source.disconnected");
  });

  it("bumps generation when origin changes on the same sourceId", async () => {
    const relay = new FakeRelayBridge();
    relay.setSnapshot([demoRelaySource()], [demoRelayTool()]);
    const adapter = await boot(relay);
    const first = (await adapter.listSources())[0];
    expect(first?.generation).toBe(1);
    relay.setSnapshot(
      [demoRelaySource({ origin: "https://other.example", url: "https://other.example/" })],
      [demoRelayTool()],
    );
    await waitFor(async () => (await adapter.listSources())[0]?.generation === 2);
  });

  it("does not reuse a generation when a relay source reconnects", async () => {
    const relay = new FakeRelayBridge();
    relay.setSnapshot([demoRelaySource()], [demoRelayTool()]);
    const adapter = await boot(relay);
    relay.setSnapshot([], []);
    await waitFor(async () => (await adapter.listSources()).length === 0);
    relay.setSnapshot([demoRelaySource()], [demoRelayTool()]);
    await waitFor(async () => (await adapter.listSources())[0]?.generation === 2);
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
