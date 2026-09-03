import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FakeRelayBridge, McpBAdapter, demoRelaySource, demoRelayTool } from "@mcp2webmcp/browser-adapter";
import { createRuntime } from "@mcp2webmcp/core";
import { testConfig } from "../helpers.js";

describe("McpBAdapter through Core policy", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()?.();
  });

  it("does not call RelayBridgeServer.invokeTool when policy denies", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp2webmcp-mcpb-"));
    const relay = new FakeRelayBridge();
    relay.setSnapshot(
      [demoRelaySource()],
      [demoRelayTool(), demoRelayTool({ originalName: "extra_ping", invokeName: "extra_ping_aaaa" })],
    );
    const runtime = createRuntime(
      testConfig({
        audit: { path: join(dir, "audit.jsonl") },
        browser: { adapter: "mcpb", allowedOrigins: ["https://knowmesh.app"] },
      }),
    );
    const adapter = new McpBAdapter({
      adapterId: "mcpb-1",
      allowedOrigins: ["https://knowmesh.app"],
      bridge: relay,
    });
    await runtime.attach(adapter);
    cleanups.push(async () => {
      await adapter.stop();
    });

    const extra = runtime.tools.list().find((tool) => tool.identity.originalName === "extra_ping");
    expect(extra).toBeDefined();
    const denied = await runtime.router.invoke(
      {
        requestId: "deny-1",
        target: { runtimeId: extra?.identity.runtimeId ?? "" },
        input: {},
        client: { processInstanceId: "proc-1" },
      },
      { signal: new AbortController().signal, deadline: Date.now() + 5_000 },
    );
    expect(denied.status).toBe("error");
    if (denied.status === "error") {
      expect(denied.error.code).toBe("POLICY_DENIED");
    }
    expect(relay.invokeCalls).toHaveLength(0);

    const echo = runtime.tools.list().find((tool) => tool.identity.originalName === "echo");
    const allowed = await runtime.router.invoke(
      {
        requestId: "allow-1",
        target: { runtimeId: echo?.identity.runtimeId ?? "" },
        input: { hello: "core" },
        client: { processInstanceId: "proc-1" },
      },
      { signal: new AbortController().signal, deadline: Date.now() + 5_000 },
    );
    expect(allowed.status).toBe("success");
    expect(relay.invokeCalls).toHaveLength(1);
    expect(relay.invokeCalls[0]?.toolName).toBe("echo_943b");
  });
});
