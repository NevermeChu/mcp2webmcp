import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BrowserContext, Page } from "playwright";
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
});

async function openReadyPage(context: BrowserContext, url: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await waitFor("page status ready", async () => {
    const text = await page.locator("#status").textContent();
    return text === "ready" ? text : undefined;
  });
  return page;
}
