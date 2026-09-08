#!/usr/bin/env node
import { FileConsentStore } from "@mcp2webmcp/core";
import { flagValue, loadConfig } from "./config.js";
import { bootstrap } from "./bootstrap.js";

try {
  const argv = process.argv.slice(2);
  const restoreOrigin = flagValue(argv, "--consent-restore-origin");
  const config = loadConfig(argv, { requireExtensionToken: !restoreOrigin });
  if (restoreOrigin) {
    const store = new FileConsentStore(config.consent.path, config.consent);
    const tool = flagValue(argv, "--consent-tool");
    const changed = store.restore(restoreOrigin, tool);
    console.error(
      JSON.stringify({ operation: "consent.restore", origin: restoreOrigin, tool, changed }),
    );
    process.exit(0);
  }
  if (!config.mcp.stdio.enabled) {
    console.error("stdio MCP is disabled in config");
    process.exit(1);
  }
  const server = await bootstrap(config);
  server.startStdio();
  console.error(
    `mcp2webmcp ${config.runtime.name} listening on stdio; logs ${config.runtime.logPath ?? "(memory)"}`,
  );
} catch (error) {
  const text = error instanceof Error ? error.message : String(error);
  console.error(`mcp2webmcp failed to start: ${text}`);
  if (/EADDRINUSE/i.test(text)) {
    console.error(
      "Loopback port still held by a previous Cursor MCP child (Reload closes stdio but used to leave the WebSocket server running). End that leftover node process, then Reload.",
    );
  }
  process.exit(1);
}
