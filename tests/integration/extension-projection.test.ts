import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import type WebSocketType from "ws";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
const distEntry = join(repoRoot, "apps/gateway/dist/main.js");
const requireFromAdapter = createRequire(join(repoRoot, "packages/browser-adapter/package.json"));
const WebSocket = requireFromAdapter("ws") as typeof WebSocketType;
const TEST_TOKEN = "integration-extension-token";

const ECHO_SCHEMA = {
  type: "object",
  properties: { message: { type: "string" } },
  required: ["message"],
};

class FakeExtension {
  private readonly socket: WebSocket;
  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on("message", (data) => {
      const msg = JSON.parse(String(data)) as {
        type?: string;
        id?: string;
        requestId?: string;
        sourceId?: string;
        sourceGeneration?: number;
        args?: { message?: string };
      };
      if (msg.type === "ping") this.send({ type: "pong", id: msg.id });
      if (msg.type === "invoke") {
        this.send({
          type: "invokeResult",
          requestId: msg.requestId,
          sourceId: msg.sourceId,
          sourceGeneration: msg.sourceGeneration,
          content: [{ type: "text", text: `echo:${msg.args?.message ?? ""}` }],
          isError: false,
        });
      }
    });
  }
  static async connect(port: number): Promise<FakeExtension> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, {
      headers: { origin: "chrome-extension://repro" },
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });
    return new FakeExtension(socket);
  }
  send(msg: unknown): void {
    this.socket.send(JSON.stringify(msg));
  }
  hello(): void {
    this.send({
      type: "hello",
      protocol: "mcp2webmcp-extension",
      protocolVersion: 2,
      token: TEST_TOKEN,
    });
  }
  upsert(tabId: number, origin: string, reason = "connect"): void {
    this.send({
      type: "source.upsert",
      sourceId: `tab:${tabId}`,
      tabId: String(tabId),
      origin,
      url: `${origin}/`,
      reason,
    });
  }
  replaceTools(tabId: number, tools: unknown[]): void {
    this.send({ type: "tools.replace", sourceId: `tab:${tabId}`, tools });
  }
  close(): void {
    this.socket.close();
  }
}

async function unusedPort(): Promise<number> {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("no port")));
      }
    });
    server.on("error", reject);
  });
}

interface Handles {
  client: Client;
  transport: StdioClientTransport;
  ext: FakeExtension;
  dir: string;
  originA: string;
}

async function boot(): Promise<Handles> {
  const dir = mkdtempSync(join(tmpdir(), "mcp2webmcp-extproj-"));
  const originA = `http://127.0.0.1:${await unusedPort()}`;
  const extensionPort = await unusedPort();
  const configPath = join(dir, "gateway.yaml");
  writeFileSync(
    configPath,
    [
      "runtime:",
      "  name: extproj",
      "  logLevel: info",
      `  logPath: ${join(dir, "log.jsonl").replaceAll("\\", "/")}`,
      "  invocationDeadlineMs: 65000",
      "mcp:",
      "  stdio:",
      "    enabled: true",
      "browser:",
      "  adapter: extension",
      "  allowedOrigins:",
      `    - "${originA}"`,
      "  extension:",
      '    host: "127.0.0.1"',
      `    port: ${extensionPort}`,
      `    authToken: "${TEST_TOKEN}"`,
      "policy:",
      "  default: deny",
      "  rules: []",
      "consent:",
      "  enabled: true",
      "  autoAdmit: true",
      `  path: ${join(dir, "consent.json").replaceAll("\\", "/")}`,
      "audit:",
      "  enabled: true",
      `  path: ${join(dir, "audit.jsonl").replaceAll("\\", "/")}`,
      "",
    ].join("\n"),
  );
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [distEntry, "--config", configPath],
    cwd: repoRoot,
    env,
    stderr: "pipe",
  });
  const client = new Client({ name: "extproj", version: "0.0.0" });
  await client.connect(transport);
  const ext = await FakeExtension.connect(extensionPort);
  ext.hello();
  return { client, transport, ext, dir, originA };
}

async function waitForTool(client: Client, name: string, timeoutMs = 5000): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await client.callTool({ name: "webmcp_list_tools", arguments: {} });
    const text = (result.content as Array<{ type: string; text: string }>)
      .map((part) => part.text)
      .join("");
    const rows = JSON.parse(text) as Array<{ originalName: string; mcpName: string }>;
    const row = rows.find((item) => item.originalName === name);
    if (row?.mcpName) return row.mcpName;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`tool ${name} never appeared`);
}

describe("extension projection over real stdio gateway", () => {
  const handles: Handles[] = [];

  afterAll(async () => {
    for (const h of handles.splice(0)) {
      h.ext.close();
      await h.client.close().catch(() => undefined);
    }
  });

  it("discovers echo, invokes it, and keeps restore outside the MCP trust boundary", async () => {
    const h = await boot();
    handles.push(h);
    const { client, ext, originA } = h;

    ext.upsert(100, originA);
    ext.replaceTools(100, [
      {
        originalName: "echo",
        description: "Echo the provided message",
        inputSchema: ECHO_SCHEMA,
        annotations: { readOnlyHint: true, idempotentHint: true },
      },
    ]);
    const mcpName = await waitForTool(client, "echo");

    const first = await client.callTool({ name: mcpName, arguments: { message: "hello" } });
    expect(first.isError).not.toBe(true);
    expect(JSON.stringify(first.content)).toContain("echo:hello");

    await client.callTool({
      name: "webmcp_revoke_consent",
      arguments: { origin: originA, tool: "echo" },
    });
    const denied = await client.callTool({
      name: "webmcp_call_tool",
      arguments: { mcpName, arguments: { message: "hello" } },
    });
    expect(denied.isError).toBe(true);
    expect(JSON.stringify(denied.content)).toContain("POLICY_DENIED");

    execFileSync(process.execPath, [
      distEntry,
      "--config",
      join(h.dir, "gateway.yaml"),
      "--consent-restore-origin",
      originA,
      "--consent-tool",
      "echo",
    ]);
    const restored = await client.callTool({
      name: "webmcp_call_tool",
      arguments: { mcpName, arguments: { message: "again" } },
    });
    expect(restored.isError).not.toBe(true);
    expect(JSON.stringify(restored.content)).toContain("echo:again");
  }, 20000);

  it("mimics the denied second tab arriving between discovery and the call", async () => {
    const h = await boot();
    handles.push(h);
    const { client, ext, originA } = h;

    ext.upsert(200, originA);
    ext.replaceTools(200, [
      { originalName: "echo", description: "Echo", inputSchema: ECHO_SCHEMA },
    ]);
    const mcpName = await waitForTool(client, "echo");

    ext.upsert(201, originA);
    ext.replaceTools(201, []);

    const result = await client.callTool({ name: mcpName, arguments: { message: "hello" } });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.content)).toContain("echo:hello");
  }, 20000);
});
