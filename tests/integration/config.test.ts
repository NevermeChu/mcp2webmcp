import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../apps/gateway/src/config.js";

const originalToken = process.env.MCP2WEBMCP_EXTENSION_TOKEN;

afterEach(() => {
  if (originalToken === undefined) delete process.env.MCP2WEBMCP_EXTENSION_TOKEN;
  else process.env.MCP2WEBMCP_EXTENSION_TOKEN = originalToken;
});

describe("loadConfig", () => {
  it("requires a token to start the extension adapter but not for local consent maintenance", () => {
    delete process.env.MCP2WEBMCP_EXTENSION_TOKEN;
    const dir = mkdtempSync(join(tmpdir(), "mcp2webmcp-config-"));
    const path = join(dir, "gateway.yaml");
    writeFileSync(
      path,
      `runtime: {}\nbrowser:\n  adapter: extension\n  allowedOrigins: []\npolicy: {}\naudit:\n  path: "${join(dir, "audit.jsonl").replaceAll("\\", "/")}"\n`,
    );

    expect(() => loadConfig(["--config", path])).toThrow(/authToken/);
    expect(() => loadConfig(["--config", path], { requireExtensionToken: false })).not.toThrow();
  });
});
