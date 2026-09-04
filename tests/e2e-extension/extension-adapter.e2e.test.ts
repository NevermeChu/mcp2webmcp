import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BrowserContext, Page, Worker } from "playwright";
import { chromium } from "playwright";
import { createExtensionFixtureServer } from "../../packages/test-fixtures/webmcp-extension-demo/src/serve.mjs";
import {
  connectGateway,
  listedRows,
  textContent,
  unusedPort,
  waitFor,
  waitForOriginal,
  writeExtensionGatewayConfig,
} from "../e2e/helpers.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const extensionDir = path.join(repoRoot, "apps/extension");

async function listen(server: ReturnType<typeof createExtensionFixtureServer>, port: number) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });
}

async function launchWithExtension(userDataDir: string): Promise<BrowserContext> {
  const args = [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`];
  try {
    return await chromium.launchPersistentContext(userDataDir, {
      channel: "msedge",
      headless: false,
      args,
      ignoreDefaultArgs: ["--disable-extensions"],
    });
  } catch {
    return chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args,
      ignoreDefaultArgs: ["--disable-extensions"],
    });
  }
}

describe("extension adapter E2E (no MCP-B embed)", () => {
  let context: BrowserContext;
  let tmpDir: string;
  let originA: string;
  let originDenied: string;
  let configPath: string;
  let gateway: Awaited<ReturnType<typeof connectGateway>>;
  const fixtureA = createExtensionFixtureServer();
  const fixtureDenied = createExtensionFixtureServer();

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp2webmcp-ext-e2e-"));
    const extensionPort = await unusedPort();
    const portA = await unusedPort();
    const portDenied = await unusedPort();
    originA = `http://127.0.0.1:${portA}`;
    originDenied = `http://127.0.0.1:${portDenied}`;
    configPath = path.join(tmpDir, "gateway.yaml");
    writeExtensionGatewayConfig(configPath, {
      origins: [originA],
      extensionPort,
      auditPath: path.join(tmpDir, "audit.jsonl"),
    });
    await listen(fixtureA, portA);
    await listen(fixtureDenied, portDenied);
    gateway = await connectGateway(repoRoot, configPath, path.join(tmpDir, "gw.stderr.log"));
    context = await launchWithExtension(path.join(tmpDir, "user-data"));
    const worker =
      context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker", { timeout: 20_000 }));
    await worker.evaluate((port) => {
      (globalThis as unknown as { mcp2webmcpSetGatewayPort: (value: number) => void }).mcp2webmcpSetGatewayPort(
        port,
      );
    }, extensionPort);
  }, 90_000);

  afterAll(async () => {
    await gateway?.client.close().catch(() => undefined);
    await context?.close().catch(() => undefined);
    fixtureA.close();
    fixtureDenied.close();
  });

  it("lists echo from a page without embed, invokes it, ignores off-allowlist origins, and drops tools when the tab closes", async () => {
    const page = await openReadyPage(context, originA);
    const echo = await waitForOriginal(gateway.client, "echo", originA);
    const echoResult = await gateway.client.callTool({
      name: echo.mcpName,
      arguments: { message: "hello" },
    });
    expect(echoResult.isError).not.toBe(true);
    expect(textContent(echoResult)).toContain("echo:hello");

    const revoked = await gateway.client.callTool({
      name: "webmcp_revoke_consent",
      arguments: { origin: originA, tool: "echo" },
    });
    expect(revoked.isError).not.toBe(true);
    const denied = await gateway.client.callTool({
      name: "webmcp_call_tool",
      arguments: { mcpName: echo.mcpName, arguments: { message: "hello" } },
    });
    expect(denied.isError).toBe(true);
    expect(textContent(denied)).toContain("POLICY_DENIED");
    await gateway.client.callTool({
      name: "webmcp_restore_consent",
      arguments: { origin: originA, tool: "echo" },
    });
    await waitFor("echo re-projected", async () => {
      const { tools } = await gateway.client.listTools({ cacheMode: "refresh" } as never);
      return tools.some((tool) => tool.name === echo.mcpName) ? true : undefined;
    });
    const restored = await gateway.client.callTool({
      name: echo.mcpName,
      arguments: { message: "hello" },
    });
    expect(restored.isError).not.toBe(true);

    const blocked = await openReadyPage(context, originDenied);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const rows = await listedRows(gateway.client);
    expect(rows.some((row) => row.origin === originDenied)).toBe(false);

    await blocked.close();
    await page.close();
    await waitFor("tools gone after tab close", async () => {
      const remaining = await listedRows(gateway.client);
      return !remaining.some((row) => row.origin === originA && row.originalName === "echo");
    });
  }, 90_000);

  it("shows runtimePresent with zero tools when the page never registerTool", async () => {
    const page = await openReadyPage(context, `${originA}/empty.html`);
    const probe = await page.evaluate(() => {
      return (globalThis as { __runtimeProbe?: { runtimePresent: boolean; toolCount: number; polyfillBrand: boolean } })
        .__runtimeProbe;
    });
    expect(probe?.runtimePresent).toBe(true);
    expect(probe?.toolCount).toBe(0);
    expect(probe?.polyfillBrand).toBe(true);

    const line = await waitFor("popup 0 tools", async () => {
      const text = await popupLineForOrigin(context, originA);
      return text?.includes("0 tools") ? text : undefined;
    });
    expect(line).not.toContain("no-webmcp-runtime");
    await page.close();
  }, 90_000);

  it("registers a page button from the picker and invokes it through Gateway", async () => {
    const page = await openReadyPage(context, `${originA}/picker.html`);
    const worker = context.serviceWorkers()[0];
    if (!worker) throw new Error("extension service worker missing");
    await startPickerOnTab(worker, `${originA}/picker.html`);
    await page.locator("#mcp2webmcp-picker-host").waitFor({ state: "attached" });
    const saveBox = await page.locator("#save-btn").boundingBox();
    if (!saveBox) throw new Error("save button has no box");
    await page.mouse.click(saveBox.x + saveBox.width / 2, saveBox.y + saveBox.height / 2);
    await waitFor("click_save bound", async () => {
      const debug = await page.evaluate(() => ({
        name: document.documentElement.getAttribute("data-mcp2webmcp-bind"),
        error: document.documentElement.getAttribute("data-mcp2webmcp-bind-error"),
      }));
      if (debug.error) throw new Error(debug.error);
      return debug.name === "click_save" ? debug.name : undefined;
    });
    expect(await page.locator("#clicks").textContent()).toBe("0");
    const clickSave = await waitForOriginal(gateway.client, "click_save", originA);
    await gateway.client.listTools({ cacheMode: "refresh" } as never);
    const clicked = await gateway.client.callTool({ name: clickSave.mcpName, arguments: {} });
    expect(clicked.isError).not.toBe(true);
    await waitFor("save click counted", async () => {
      const n = await page.locator("#clicks").textContent();
      return n === "1" ? n : undefined;
    });

    await page.evaluate(() => {
      document.documentElement.removeAttribute("data-mcp2webmcp-bind");
      document.documentElement.removeAttribute("data-mcp2webmcp-bind-error");
    });
    await startPickerOnTab(worker, `${originA}/picker.html`);
    await page.locator("#mcp2webmcp-picker-host").waitFor({ state: "attached" });
    const qBox = await page.locator("#q").boundingBox();
    if (!qBox) throw new Error("search input has no box");
    await page.mouse.click(qBox.x + qBox.width / 2, qBox.y + qBox.height / 2);
    await waitFor("fill_search bound", async () => {
      const name = await page.locator("html").getAttribute("data-mcp2webmcp-bind");
      const error = await page.locator("html").getAttribute("data-mcp2webmcp-bind-error");
      if (error) throw new Error(error);
      return name === "fill_search" ? name : undefined;
    });
    const filled = await waitFor("fill_search invoked", async () => {
      const row = (await listedRows(gateway.client)).find(
        (item) => item.originalName === "fill_search" && item.origin === originA,
      );
      if (!row) return undefined;
      await gateway.client.listTools({ cacheMode: "refresh" } as never);
      const result = await gateway.client.callTool({
        name: row.mcpName,
        arguments: { value: "hello-picker" },
      });
      return result.isError ? undefined : result;
    });
    expect(filled.isError).not.toBe(true);
    await waitFor("search filled", async () => {
      const value = await page.locator("#q").inputValue();
      return value === "hello-picker" ? value : undefined;
    });
    await page.close();
  }, 90_000);

  it("keeps a page-owned host and still invokes echo", async () => {
    const page = await openReadyPage(context, `${originA}/existing-host.html`);
    const probe = await page.evaluate(() => {
      return (globalThis as { __runtimeProbe?: { pageOwned: boolean; polyfillBrand: boolean } }).__runtimeProbe;
    });
    expect(probe?.pageOwned).toBe(true);
    expect(probe?.polyfillBrand).toBe(false);

    const echo = await waitForOriginal(gateway.client, "echo", originA);
    const echoResult = await gateway.client.callTool({
      name: echo.mcpName,
      arguments: { message: "from-page-host" },
    });
    expect(echoResult.isError).not.toBe(true);
    expect(textContent(echoResult)).toContain("echo:from-page-host");
    await page.close();
    await waitFor("page-host echo gone", async () => {
      const remaining = await listedRows(gateway.client);
      return !remaining.some((row) => row.origin === originA && row.originalName === "echo");
    });
  }, 90_000);

  it("drops the tool from Gateway when the page aborts registerTool", async () => {
    const page = await openReadyPage(context, originA);
    await waitForOriginal(gateway.client, "echo", originA);
    await page.evaluate(() => {
      (globalThis as { __abortEcho?: () => void }).__abortEcho?.();
    });
    await waitFor("echo gone after abort", async () => {
      const remaining = await listedRows(gateway.client);
      return !remaining.some((row) => row.origin === originA && row.originalName === "echo");
    });
    await page.close();
  }, 90_000);
});

function extensionId(context: BrowserContext): string {
  const worker = context.serviceWorkers()[0];
  if (!worker) throw new Error("extension service worker missing");
  return new URL(worker.url()).host;
}

async function popupLineForOrigin(context: BrowserContext, origin: string): Promise<string | undefined> {
  const popup = await context.newPage();
  try {
    await popup.goto(`chrome-extension://${extensionId(context)}/popup.html`);
    const items = await popup.locator("#tabs li").allTextContents();
    return items.find((line) => line.includes(origin));
  } finally {
    await popup.close();
  }
}

async function startPickerOnTab(worker: Worker, targetUrl: string): Promise<void> {
  await worker.evaluate(async (url) => {
    const ext = (
      globalThis as unknown as {
        chrome: {
          tabs: {
            query: (query: Record<string, never>) => Promise<Array<{ id?: number; url?: string }>>;
            sendMessage: (tabId: number, message: { type: string }) => Promise<unknown>;
          };
        };
      }
    ).chrome;
    const found = (await ext.tabs.query({})).find((tab) => tab.url === url);
    if (!found?.id) throw new Error("picker tab not found");
    await ext.tabs.sendMessage(found.id, { type: "pick.start" });
  }, targetUrl);
}

async function openReadyPage(context: BrowserContext, url: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitFor("page status ready", async () => {
    const text = await page.locator("#status").textContent();
    return text === "ready" ? text : undefined;
  });
  return page;
}
