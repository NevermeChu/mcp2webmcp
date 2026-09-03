import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "playwright";
import { createFixtureServer } from "../../packages/test-fixtures/webmcp-demo/src/serve.mjs";
import {
  connectGateway,
  launchBrowser,
  listedRows,
  textContent,
  unusedPort,
  waitFor,
  waitForOriginal,
  writeGatewayConfig,
} from "./helpers.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function listen(server: ReturnType<typeof createFixtureServer>, port: number) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
}

describe("cooperative embed E2E (not extension zero-integration)", () => {
  let browser: Browser;
  let tmpDir: string;
  let originA: string;
  let originB: string;
  let originC: string;
  let configPath: string;
  let gateway: Awaited<ReturnType<typeof connectGateway>>;
  const fixtureA = createFixtureServer();
  const fixtureB = createFixtureServer();
  const fixtureC = createFixtureServer();

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp2webmcp-e2e-"));
    const relayPort = await unusedPort();
    const portA = await unusedPort();
    const portB = await unusedPort();
    const portC = await unusedPort();
    process.env.MCP2WEBMCP_E2E_RELAY_PORT = String(relayPort);
    originA = `http://127.0.0.1:${portA}`;
    originB = `http://127.0.0.1:${portB}`;
    originC = `http://127.0.0.1:${portC}`;
    configPath = path.join(tmpDir, "gateway.yaml");
    writeGatewayConfig(configPath, {
      origins: [originA, originB],
      relayPort,
      persistPath: path.join(tmpDir, "relay-port.json"),
      auditPath: path.join(tmpDir, "audit.jsonl"),
    });
    await listen(fixtureA, portA);
    await listen(fixtureB, portB);
    await listen(fixtureC, portC);
    browser = await launchBrowser();
    gateway = await connectGateway(repoRoot, configPath, path.join(tmpDir, "gw-primary.stderr.log"));
  }, 60_000);

  afterEach(async () => {
    if (!browser) return;
    await Promise.all(
      browser
        .contexts()
        .flatMap((context) => context.pages().map((page) => page.close().catch(() => undefined))),
    );
  });

  afterAll(async () => {
    await gateway?.client.close().catch(() => undefined);
    await browser?.close();
    fixtureA.close();
    fixtureB.close();
    fixtureC.close();
  });

  it("discovers three tools, calls echo, recovers after reload, and drops tools when the tab closes", async () => {
    const first = gateway;
    const page = await openReadyPage(browser, originA);

    const echo = await waitForOriginal(first.client, "echo", originA);
    await waitForOriginal(first.client, "get_page_title", originA);
    await waitForOriginal(first.client, "add", originA);
    const dynamic = await first.client.listTools();
    const pageTools = dynamic.tools.filter((tool) => !tool.name.startsWith("webmcp_"));
    expect(pageTools.length).toBeGreaterThanOrEqual(3);

    const echoResult = await first.client.callTool({
      name: echo.mcpName,
      arguments: { message: "hello-e2e" },
    });
    expect(echoResult.isError).not.toBe(true);
    expect(textContent(echoResult)).toContain("echo:hello-e2e");

    const titleTool = await waitForOriginal(first.client, "get_page_title", originA);
    const titleResult = await first.client.callTool({ name: titleTool.mcpName, arguments: {} });
    expect(textContent(titleResult)).toContain("cooperative embed");

    const addTool = await waitForOriginal(first.client, "add", originA);
    const addResult = await first.client.callTool({
      name: addTool.mcpName,
      arguments: { a: 2, b: 3 },
    });
    expect(textContent(addResult)).toContain("5");

    await page.reload({ waitUntil: "domcontentloaded" });
    await waitReady(page);
    const echoAfterReload = await waitForOriginal(first.client, "echo", originA);
    const again = await first.client.callTool({
      name: echoAfterReload.mcpName,
      arguments: { message: "after-reload" },
    });
    expect(textContent(again)).toContain("echo:after-reload");

    await page.close();
    await waitFor("tools gone after tab close", async () => {
      const rows = await listedRows(first.client);
      return !rows.some((row) => row.origin === originA && row.originalName === "echo");
    });
  }, 90_000);

  it("shares one browser source across two stdio clients and namespaces the same tool on two origins", async () => {
    const first = gateway;
    const pageA = await openReadyPage(browser, originA);
    const pageB = await openReadyPage(browser, originB);
    await waitForOriginal(first.client, "echo", originA);
    await waitForOriginal(first.client, "echo", originB);

    const second = await connectGateway(repoRoot, configPath, path.join(tmpDir, "gw-share-2.stderr.log"));
    const echoOnSecond = await waitForOriginal(second.client, "echo", originA);
    const shared = await second.client.callTool({
      name: echoOnSecond.mcpName,
      arguments: { message: "from-client-2" },
    });
    expect(shared.isError).not.toBe(true);
    expect(textContent(shared)).toContain("echo:from-client-2");

    const rows = await listedRows(first.client);
    const echoes = rows.filter((row) => row.originalName === "echo");
    expect(echoes.map((row) => row.origin).sort()).toEqual([originA, originB].sort());
    expect(new Set(echoes.map((row) => row.mcpName)).size).toBe(2);

    await pageA.close();
    await pageB.close();
    await second.client.close();
  }, 90_000);

  it("denies extra_ping after revoke, fail-closes misleading destructive tools, and ignores an origin off the allowlist", async () => {
    const first = gateway;
    const page = await openReadyPage(browser, originA);
    await waitForOriginal(first.client, "echo", originA);

    await page.click("#add-extra");
    const extra = await waitForOriginal(first.client, "extra_ping", originA);
    const admitted = await first.client.callTool({ name: extra.mcpName, arguments: {} });
    expect(admitted.isError).not.toBe(true);

    const revoked = await first.client.callTool({
      name: "webmcp_revoke_consent",
      arguments: { origin: originA, tool: "extra_ping" },
    });
    expect(revoked.isError).not.toBe(true);
    const denied = await first.client.callTool({
      name: "webmcp_call_tool",
      arguments: { mcpName: extra.mcpName, arguments: {} },
    });
    expect(denied.isError).toBe(true);
    expect(textContent(denied)).toContain("POLICY_DENIED");

    const backup = await waitForOriginal(first.client, "safe_backup", originA);
    const confirmed = await first.client.callTool({ name: backup.mcpName, arguments: {} });
    expect(confirmed.isError).toBe(true);
    expect(textContent(confirmed)).toMatch(/CONFIRMATION_UNAVAILABLE|POLICY_DENIED/);
    expect(await page.evaluate("window.__backupRan")).toBe(false);

    const blocked = await browser.newPage();
    await blocked.goto(originC, { waitUntil: "domcontentloaded" });
    await waitReady(blocked);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const rows = await listedRows(first.client);
    expect(rows.some((row) => row.origin === originC)).toBe(false);

    await blocked.close();
    await page.close();
  }, 90_000);

  it("handles rapid reload, origin navigation, and reload during an in-flight invocation", async () => {
    const first = gateway;
    const page = await openReadyPage(browser, originA);
    await waitForOriginal(first.client, "echo", originA);

    for (let i = 0; i < 3; i += 1) {
      await page.reload({ waitUntil: "domcontentloaded" });
      await waitReady(page);
    }
    const echo = await waitForOriginal(first.client, "echo", originA);
    expect(echo.mcpName).toBeTruthy();

    const slow = await waitForOriginal(first.client, "slow_write", originA);
    const pending = first.client.callTool({ name: slow.mcpName, arguments: {} });
    await page.waitForFunction("window.__slowStarted === true", null, { timeout: 20_000 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await waitReady(page);
    const inFlight = await pending;
    expect(inFlight.isError).toBe(true);

    await page.goto(originB, { waitUntil: "domcontentloaded" });
    await waitReady(page);
    await waitForOriginal(first.client, "echo", originB);
    await waitFor("origin A echo gone after navigation", async () => {
      const rows = await listedRows(first.client);
      return !rows.some((row) => row.origin === originA && row.originalName === "echo");
    });

    await page.close();
  }, 90_000);
});

async function openReadyPage(browser: Browser, url: string): Promise<Page> {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitReady(page);
  return page;
}

async function waitReady(page: Page): Promise<void> {
  await waitFor("page status ready", async () => {
    const text = await page.locator("#status").textContent();
    return text === "ready" || text === "ready+extra_ping" ? text : undefined;
  });
}
