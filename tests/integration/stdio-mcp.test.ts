import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const root = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(root, "../../packages/mcp-transport");
const distEntry = join(pkgRoot, "dist/fake-stdio-main.js");

describe("stdio MCP child process", () => {
  let client: Client | undefined;

  afterAll(async () => {
    await client?.close().catch(() => undefined);
  });

  it("calls the fake echo tool over a real stdio transport", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp2webmcp-stdio-"));
    client = new Client({ name: "stdio-integration", version: "0.0.0" });
    if (!existsSync(distEntry)) {
      throw new Error(`stdio integration test requires ${distEntry}; run pnpm build first`);
    }
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [distEntry],
      cwd: pkgRoot,
      env: childEnv({ MCP2WEBMCP_SPIKE_AUDIT: join(dir, "audit.jsonl") }),
      stderr: "pipe",
    });
    await client.connect(transport);
    const { tools } = await client.listTools();
    const echo = tools.find((tool) => tool.name.includes("echo"));
    expect(echo).toBeDefined();
    const result = await client.callTool({
      name: echo?.name ?? "",
      arguments: { hello: "stdio" },
    });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.content)).toContain("stdio");
  });
});

function childEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  return { ...env, ...extra };
}
