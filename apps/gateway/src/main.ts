#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { bootstrap } from "./bootstrap.js";

const config = loadConfig();
if (!config.mcp.stdio.enabled) {
  console.error("stdio MCP is disabled in config");
  process.exit(1);
}

const server = await bootstrap(config);
server.startStdio();
console.error(`mcp2webmcp ${config.runtime.name} listening on stdio`);
