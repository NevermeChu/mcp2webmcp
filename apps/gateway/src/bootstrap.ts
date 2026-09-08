import {
  discoveredTool,
  ExtensionAdapter,
  FakeBrowserAdapter,
  McpBAdapter,
} from "@mcp2webmcp/browser-adapter";
import { createRuntime } from "@mcp2webmcp/core";
import { McpStdioServer } from "@mcp2webmcp/mcp-transport";
import type { BrowserSource, RuntimeConfig } from "@mcp2webmcp/protocol";

export async function bootstrap(config: RuntimeConfig): Promise<McpStdioServer> {
  const runtime = createRuntime(config);
  if (config.browser.adapter === "fake") {
    const adapter = new FakeBrowserAdapter("fake-1");
    await runtime.attach(adapter);
    if (process.env.MCP2WEBMCP_FAKE_ECHO === "1") {
      adapter.connectSource(demoSource());
      adapter.registerTool("tab-18", discoveredTool("echo"));
    }
  } else if (config.browser.adapter === "mcpb") {
    const mcpb = config.browser.mcpb ?? {};
    await runtime.attach(
      new McpBAdapter({
        adapterId: "mcpb-1",
        allowedOrigins: config.browser.allowedOrigins,
        host: mcpb.host,
        port: mcpb.port,
        persistPath: mcpb.persistPath,
        relayId: mcpb.relayId,
        label: mcpb.label,
        invokeTimeoutMs: mcpb.invokeTimeoutMs ?? config.runtime.invocationDeadlineMs,
        maxPayloadBytes: mcpb.maxPayloadBytes,
      }),
    );
  } else if (config.browser.adapter === "extension") {
    const extension = config.browser.extension ?? {};
    if (!extension.authToken) {
      throw new Error("extension adapter requires browser.extension.authToken");
    }
    const adapter = new ExtensionAdapter({
      adapterId: "ext-1",
      allowedOrigins: config.browser.allowedOrigins,
      host: extension.host,
      port: extension.port,
      invokeTimeoutMs: extension.invokeTimeoutMs ?? config.runtime.invocationDeadlineMs,
      authToken: extension.authToken,
      disconnectGraceMs: extension.disconnectGraceMs,
      log: runtime.log,
      policyControl: {
        get: (origin, originalName) => runtime.policyOverrides.get(origin, originalName),
        list: () => runtime.policyOverrides.list(),
        set: (origin, originalName, mode) =>
          runtime.policyOverrides.set(origin, originalName, mode),
        effective: (source, tool) => runtime.policy.evaluate({ source, tool, input: {} }).action,
      },
    });
    await runtime.attach(adapter);
    runtime.log.info("gateway", "extension.listen", {
      host: extension.host ?? "127.0.0.1",
      port: adapter.listenPort,
    });
  } else {
    throw new Error(`unsupported browser adapter: ${config.browser.adapter}`);
  }
  runtime.log.info("gateway", "bootstrap.ready", {
    name: config.runtime.name,
    adapter: config.browser.adapter,
    logPath: config.runtime.logPath ?? "",
  });
  return new McpStdioServer(runtime, config);
}

function demoSource(): Omit<BrowserSource, "adapterId" | "adapterType" | "state" | "updatedAt"> & {
  connectedAt: number;
} {
  const now = Date.now();
  return {
    sourceId: "tab-18",
    generation: 1,
    browserId: "browser-1",
    tabId: "18",
    origin: "https://knowmesh.app",
    url: "https://knowmesh.app/docs",
    title: "fake echo",
    connectedAt: now,
  };
}
