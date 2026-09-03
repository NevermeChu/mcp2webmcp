import { discoveredTool, FakeBrowserAdapter } from "@mcp2webmcp/browser-adapter";
import { createRuntime } from "@mcp2webmcp/core";
import type { BrowserSource } from "@mcp2webmcp/protocol";
import { McpStdioServer } from "./stdio-server.js";
import { testRuntimeConfig } from "./test-config.js";

const auditPath = process.env.MCP2WEBMCP_SPIKE_AUDIT;
if (!auditPath) {
  console.error("MCP2WEBMCP_SPIKE_AUDIT is required");
  process.exit(1);
}

const source: BrowserSource = {
  adapterId: "fake-1",
  sourceId: "tab-18",
  generation: 1,
  browserId: "browser-1",
  tabId: "18",
  origin: "https://knowmesh.app",
  url: "https://knowmesh.app/docs",
  adapterType: "fake",
  connectedAt: Date.now(),
  updatedAt: Date.now(),
  state: "connected",
};

const config = testRuntimeConfig(auditPath);
const runtime = createRuntime(config);
const adapter = new FakeBrowserAdapter("fake-1");
await runtime.attach(adapter);
adapter.connectSource(source);
adapter.registerTool("tab-18", discoveredTool("echo"));

const server = new McpStdioServer(runtime, config);
server.startStdio();
console.error("mcp2webmcp fake stdio gateway ready");
