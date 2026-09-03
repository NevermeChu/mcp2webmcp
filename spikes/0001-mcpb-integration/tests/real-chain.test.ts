import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createFixtureServer } from "../fixture/serve.mjs";

const spikeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function listen(server: ReturnType<typeof createFixtureServer>, port: number) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
}

async function waitFor<T>(
  label: string,
  fn: () => Promise<T | undefined | false | null>,
  timeoutMs = 45_000,
): Promise<T> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} timed out: ${String(lastError ?? "predicate never succeeded")}`);
}

function toolNames(tools: Array<{ name: string }>): string[] {
  return tools.map((tool) => tool.name).sort();
}

function textContent(result: { content?: Array<{ type: string; text?: string }> }): string {
  return (result.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
}

async function connectClient(
  env: Record<string, string>,
  stderrPath: string,
): Promise<{
  client: Client;
  transport: StdioClientTransport;
}> {
  const client = new Client({ name: "mcp2webmcp-spike-client", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(spikeRoot, "src/stdio-relay.mjs")],
    cwd: spikeRoot,
    env: Object.fromEntries(
      Object.entries({ ...process.env, ...env }).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
    stderr: "pipe",
  });
  transport.stderr?.pipe(fs.createWriteStream(stderrPath));
  await client.connect(transport);
  return { client, transport };
}

describe("real cooperative WebMCP chain", () => {
  let browser: Browser;
  let tmpDir: string;
  let relayPort: number;
  let fixturePortA: number;
  let fixturePortB: number;
  let originA: string;
  let originB: string;
  let persistPath: string;
  let auditPath: string;
  const fixtureA = createFixtureServer();
  const fixtureB = createFixtureServer();

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp2webmcp-spike-"));
    persistPath = path.join(tmpDir, "relay-port.json");
    auditPath = path.join(tmpDir, "audit.jsonl");
    relayPort = await unusedPort();
    fixturePortA = await unusedPort();
    fixturePortB = await unusedPort();
    originA = `http://127.0.0.1:${fixturePortA}`;
    originB = `http://127.0.0.1:${fixturePortB}`;
    process.env.MCP2WEBMCP_SPIKE_RELAY_PORT = String(relayPort);
    await listen(fixtureA, fixturePortA);
    await listen(fixtureB, fixturePortB);
    browser = await chromium.launch({ channel: "msedge" });
  });

  afterAll(async () => {
    await browser?.close();
    fixtureA.close();
    fixtureB.close();
  });

  it("discovers echo, calls it, syncs lifecycle, shares two stdio clients, and denies by wrap", async () => {
    const sharedEnv = {
      MCP2WEBMCP_SPIKE_RELAY_PORT: String(relayPort),
      MCP2WEBMCP_SPIKE_PERSIST: persistPath,
      MCP2WEBMCP_SPIKE_ORIGINS: `${originA},${originB}`,
      MCP2WEBMCP_SPIKE_RELAY_ID: "spike-0001",
      MCP2WEBMCP_SPIKE_AUDIT: auditPath,
      MCP2WEBMCP_SPIKE_DENY_TOOLS: "extra_ping",
    };

    const first = await connectClient(sharedEnv, path.join(tmpDir, "relay-1.stderr.log"));
    const capabilities = first.client.getServerCapabilities();
    const listChanged = Boolean(capabilities?.tools?.listChanged);
    const notifications: string[] = [];
    first.client.setNotificationHandler("notifications/tools/list_changed", async () => {
      notifications.push("tools/list_changed");
    });

    const pageA = await browser.newPage();
    const pageLogs: string[] = [];
    pageA.on("console", (msg) => pageLogs.push(`[A] ${msg.type()}: ${msg.text()}`));
    pageA.on("pageerror", (error) => pageLogs.push(`[A] pageerror: ${error.message}`));
    await pageA.goto(originA, { waitUntil: "domcontentloaded" });
    await waitFor("page runtime", async () =>
      pageA.locator("#status").textContent().then((text) => text === "echo"),
    );

    const echoOnA = await waitFor("echo on client 1", async () => {
      const { tools } = await first.client.listTools();
      return tools.find((tool) => tool.name === "echo" || tool.name.startsWith("echo_"));
    });

    const echoResult = await first.client.callTool({
      name: echoOnA.name,
      arguments: { message: "hello-spike" },
    });
    expect(echoResult.isError).not.toBe(true);
    expect(textContent(echoResult)).toContain("echo:hello-spike");

    await pageA.click("#add-extra");
    const extra = await waitFor("extra_ping after add", async () => {
      const { tools } = await first.client.listTools();
      return tools.find((tool) => tool.name.includes("extra_ping"));
    });

    const denied = await first.client.callTool({
      name: extra.name,
      arguments: {},
    });
    expect(denied.isError).toBe(true);
    expect(textContent(denied)).toContain("POLICY_DENIED");

    await pageA.click("#remove-extra");
    await waitFor("extra_ping removed", async () => {
      const { tools } = await first.client.listTools();
      return !tools.some((tool) => tool.name.includes("extra_ping"));
    });

    await pageA.reload({ waitUntil: "domcontentloaded" });
    await waitFor("echo after reload", async () => {
      await pageA.locator("#status").textContent().then((text) => text === "echo");
      const { tools } = await first.client.listTools();
      return tools.find((tool) => tool.name === "echo" || tool.name.startsWith("echo_"));
    });

    const pageB = await browser.newPage();
    await pageB.goto(originB, { waitUntil: "domcontentloaded" });
    await waitFor("second origin connected", async () => {
      const listed = await first.client.callTool({
        name: "webmcp_list_sources",
        arguments: {},
      });
      return textContent(listed).includes(originB) ? listed : undefined;
    });

    const sameNameTools = await waitFor("two echo tools", async () => {
      const { tools } = await first.client.listTools();
      const echoes = tools.filter((tool) => tool.name === "echo" || tool.name.startsWith("echo"));
      return echoes.length >= 2 ? echoes : undefined;
    });
    expect(new Set(sameNameTools.map((tool) => tool.name)).size).toBeGreaterThan(1);

    const second = await connectClient(sharedEnv, path.join(tmpDir, "relay-2.stderr.log"));
    const secondEcho = await waitFor("echo on client 2", async () => {
      const { tools } = await second.client.listTools();
      return tools.find((tool) => tool.name.includes("echo"));
    });
    const secondResult = await second.client.callTool({
      name: secondEcho.name,
      arguments: { message: "from-client-2" },
    });
    expect(secondResult.isError).not.toBe(true);
    expect(textContent(secondResult)).toContain("echo:from-client-2");

    const sources = await first.client.callTool({
      name: "webmcp_list_sources",
      arguments: {},
    });
    expect(textContent(sources)).toContain(originA);

    await pageA.close();
    await pageB.close();
    await waitFor("tools gone after tab close", async () => {
      const { tools } = await first.client.listTools();
      return !tools.some((tool) => tool.name.includes("echo"));
    });

    const audit = fs.readFileSync(auditPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(audit.some((row) => row.decision === "allow" && row.success === true)).toBe(true);
    expect(audit.some((row) => row.errorCode === "POLICY_DENIED")).toBe(true);

    const observations = {
      listChangedCapability: listChanged,
      listChangedNotifications: notifications.length,
      firstServerCaps: capabilities,
      toolNamesAfterTwoOrigins: toolNames(sameNameTools),
      auditRecords: audit.length,
    };
    fs.writeFileSync(
      path.join(spikeRoot, "e2e-observations.json"),
      `${JSON.stringify({ ...observations, pageLogs }, null, 2)}\n`,
    );

    await second.client.close();
    await first.client.close();
  });
});

function unusedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("failed to allocate port"));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}
