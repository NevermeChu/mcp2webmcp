#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { bootstrap } from "./bootstrap.js";

const config = loadConfig();
if (!config.mcp.stdio.enabled) {
  console.error("stdio MCP is disabled in config");
  process.exit(1);
}

try {
  const server = await bootstrap(config);
  server.startStdio();
  console.error(
    `mcp2webmcp ${config.runtime.name} listening on stdio; logs ${config.runtime.logPath ?? "(memory)"}`,
  );
} catch (error) {
  const text = error instanceof Error ? error.message : String(error);
  console.error(`mcp2webmcp ${config.runtime.name} failed to start: ${text}`);
  if (/EADDRINUSE/i.test(text)) {
    console.error(
      "Loopback port still held by a previous Cursor MCP child (Reload closes stdio but used to leave the WebSocket server running). End that leftover node process, then Reload.",
    );
  }
  process.exit(1);
}
