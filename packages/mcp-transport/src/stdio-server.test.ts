import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { discoveredTool, FakeBrowserAdapter } from "@mcp2webmcp/browser-adapter";
import { createRuntime } from "@mcp2webmcp/core";
import { McpStdioServer } from "./stdio-server.js";
import { testConfig, testSource } from "../../../tests/helpers.js";

describe("MCP stdio server with FakeBrowserAdapter", () => {
  const sessions: Array<{ client: Client; mcp: McpStdioServer }> = [];

  afterEach(async () => {
    for (const session of sessions.splice(0)) {
      await session.client.close().catch(() => undefined);
      await session.mcp.close().catch(() => undefined);
    }
  });

  async function boot(toolName = "echo") {
    const dir = mkdtempSync(join(tmpdir(), "mcp2webmcp-mcp-"));
    const config = testConfig({ audit: { path: join(dir, "audit.jsonl") } });
    const runtime = createRuntime(config);
    const adapter = new FakeBrowserAdapter("fake-1");
    await runtime.attach(adapter);
    adapter.connectSource(testSource({ adapterId: "fake-1" }));
    adapter.registerTool("tab-18", discoveredTool(toolName));
    const mcp = new McpStdioServer(runtime, config);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "mcp2webmcp-test-client", version: "0.0.0" });
    await Promise.all([client.connect(clientTransport), mcp.connect(serverTransport)]);
    sessions.push({ client, mcp });
    return { client, mcp, adapter, runtime };
  }

  it("lists management tools and a projected fake echo tool, then calls echo", async () => {
    const { client } = await boot("echo");
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("webmcp_list_sources");
    expect(names).toContain("webmcp_list_tools");
    expect(names).toContain("webmcp_call_tool");
    expect(names).toContain("webmcp_recent_logs");
    const echo = tools.find((tool) => tool.name !== undefined && !tool.name.startsWith("webmcp_"));
    expect(echo?.name).toMatch(/echo/);

    const direct = await client.callTool({
      name: echo?.name ?? "",
      arguments: { message: "from-mcp" },
    });
    expect(direct.isError).not.toBe(true);
    const text = JSON.stringify(direct.content);
    expect(text).toContain("from-mcp");

    const listed = await client.callTool({ name: "webmcp_list_sources", arguments: {} });
    expect(JSON.stringify(listed.content)).toContain("https://knowmesh.app");

    const logs = await client.callTool({ name: "webmcp_recent_logs", arguments: { limit: 40 } });
    const logText = JSON.stringify(logs.content);
    expect(logText).toMatch(/source\.added|tool\.added|projector\.sync/);
  });

  it("does not project tools from origins off the allowlist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp2webmcp-mcp-"));
    const config = testConfig({ audit: { path: join(dir, "audit.jsonl") } });
    const runtime = createRuntime(config);
    const adapter = new FakeBrowserAdapter("fake-1");
    await runtime.attach(adapter);
    adapter.connectSource(
      testSource({
        adapterId: "fake-1",
        sourceId: "tab-99",
        tabId: "99",
        origin: "https://evil.example",
      }),
    );
    adapter.registerTool("tab-99", discoveredTool("echo"));
    const mcp = new McpStdioServer(runtime, config);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "mcp2webmcp-test-client", version: "0.0.0" });
    await Promise.all([client.connect(clientTransport), mcp.connect(serverTransport)]);
    sessions.push({ client, mcp });
    const { tools } = await client.listTools();
    expect(tools.some((tool) => tool.name.includes("echo"))).toBe(false);
  });

  it("supports the webmcp_call_tool fallback", async () => {
    const { client } = await boot("echo");
    const listed = await client.callTool({ name: "webmcp_list_tools", arguments: {} });
    const payload = JSON.parse(
      (listed.content as Array<{ text?: string }>)[0]?.text ?? "[]",
    ) as Array<{ mcpName: string }>;
    const echo = payload.find((row) => row.mcpName.includes("echo"));
    const result = await client.callTool({
      name: "webmcp_call_tool",
      arguments: { mcpName: echo?.mcpName, arguments: { ping: true } },
    });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.content)).toContain("ping");
  });

  it("auto-admits a tool then omits it after revoke", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp2webmcp-mcp-"));
    const config = testConfig({
      audit: { path: join(dir, "audit.jsonl") },
      consent: { enabled: true, autoAdmit: true, path: join(dir, "consent.json") },
      policy: { default: "deny", rules: [] },
    });
    const runtime = createRuntime(config);
    const adapter = new FakeBrowserAdapter("fake-1");
    await runtime.attach(adapter);
    adapter.connectSource(testSource({ adapterId: "fake-1" }));
    adapter.registerTool("tab-18", discoveredTool("echo"));
    const mcp = new McpStdioServer(runtime, config);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "mcp2webmcp-test-client", version: "0.0.0" });
    await Promise.all([client.connect(clientTransport), mcp.connect(serverTransport)]);
    sessions.push({ client, mcp });

    const before = await client.listTools();
    const echo = before.tools.find((tool) => tool.name.includes("echo"));
    expect(echo?.name).toBeTruthy();
    const ok = await client.callTool({ name: echo?.name ?? "", arguments: { message: "hi" } });
    expect(ok.isError).not.toBe(true);

    await client.callTool({
      name: "webmcp_revoke_consent",
      arguments: { origin: "https://knowmesh.app", tool: "echo" },
    });
    await waitFor(() => true);
    await new Promise((resolve) => setTimeout(resolve, 200));
    const after = await client.listTools({ cacheMode: "refresh" } as never);
    expect(after.tools.some((tool) => tool.name.includes("echo"))).toBe(false);
    const denied = await client.callTool({
      name: "webmcp_call_tool",
      arguments: { mcpName: echo?.name, arguments: { message: "hi" } },
    });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied.content)).toContain("POLICY_DENIED");
  });

  it("keeps the projected mcpName across a source generation bump", async () => {
    const { client, adapter } = await boot("echo");
    const before = await client.listTools();
    const echoName = before.tools.find((tool) => tool.name?.includes("echo"))?.name;
    expect(echoName).toBeTruthy();
    adapter.reloadSource("tab-18");
    adapter.registerTool("tab-18", discoveredTool("echo"));
    await new Promise((resolve) => setTimeout(resolve, 250));
    const after = await client.listTools({ cacheMode: "refresh" } as never);
    expect(after.tools.find((tool) => tool.name?.includes("echo"))?.name).toBe(echoName);
    const result = await client.callTool({ name: echoName ?? "", arguments: { message: "again" } });
    expect(result.isError).not.toBe(true);
  });

  it("notifies the client when a dynamic tool is added", async () => {
    const { client, adapter } = await boot("echo");
    const notifications: string[] = [];
    client.setNotificationHandler("notifications/tools/list_changed", async () => {
      notifications.push("changed");
    });
    adapter.registerTool("tab-18", discoveredTool("search_documents"));
    await waitFor(() => notifications.length > 0);
    const { tools } = await client.listTools({ cacheMode: "refresh" } as never);
    expect(tools.some((tool) => tool.name.includes("search_documents"))).toBe(true);
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 3_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timeout waiting for MCP notification");
}
