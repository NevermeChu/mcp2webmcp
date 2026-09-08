import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { runtimeConfigSchema, type RuntimeConfig } from "@mcp2webmcp/protocol";

export function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

export function loadConfig(
  argv = process.argv.slice(2),
  options: { requireExtensionToken?: boolean } = {},
): RuntimeConfig {
  const configFlag = flagValue(argv, "--config") ?? process.env.MCP2WEBMCP_CONFIG;
  if (!configFlag) {
    throw new Error(
      "config required: pass --config <path-to-yaml> or set MCP2WEBMCP_CONFIG (see configs/example.yaml)",
    );
  }
  const raw = readFileSync(resolve(expandHome(configFlag)), "utf8");
  const parsed = runtimeConfigSchema.parse(parseYaml(raw));
  const logLevel = process.env.MCP2WEBMCP_LOG_LEVEL;
  if (logLevel === "debug" || logLevel === "info" || logLevel === "warn" || logLevel === "error") {
    parsed.runtime.logLevel = logLevel;
  }
  const origins = process.env.MCP2WEBMCP_ALLOWED_ORIGINS;
  if (origins) {
    parsed.browser.allowedOrigins = origins
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  const extensionToken = process.env.MCP2WEBMCP_EXTENSION_TOKEN;
  if (extensionToken) {
    parsed.browser.extension ??= {};
    parsed.browser.extension.authToken = extensionToken;
  }
  const logPath = process.env.MCP2WEBMCP_LOG_PATH || parsed.runtime.logPath;
  const safeName = parsed.runtime.name.replace(/[^a-zA-Z0-9._-]+/g, "_") || "mcp2webmcp";
  parsed.runtime.logPath = expandHome(logPath || `~/.mcp2webmcp/logs/${safeName}.jsonl`);
  parsed.audit.path = expandHome(parsed.audit.path);
  parsed.consent.path = expandHome(parsed.consent.path);
  if (parsed.browser.mcpb?.persistPath) {
    parsed.browser.mcpb.persistPath = expandHome(parsed.browser.mcpb.persistPath);
  }
  const validated = runtimeConfigSchema.parse(parsed);
  if (
    options.requireExtensionToken !== false &&
    validated.browser.adapter === "extension" &&
    !validated.browser.extension?.authToken
  ) {
    throw new Error(
      "extension adapter requires browser.extension.authToken or MCP2WEBMCP_EXTENSION_TOKEN",
    );
  }
  return validated;
}

export function flagValue(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index >= 0) return argv[index + 1];
  const prefixed = argv.find((item) => item.startsWith(`${name}=`));
  return prefixed?.slice(name.length + 1);
}
