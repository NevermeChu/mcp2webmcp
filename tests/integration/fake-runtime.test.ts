import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoveredTool, FakeBrowserAdapter } from "@mcp2webmcp/browser-adapter";
import { createRuntime } from "@mcp2webmcp/core";
import { testConfig, testSource } from "../helpers.js";

describe("fake adapter to router integration", () => {
  it("calls a fake WebMCP tool through Core", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp2webmcp-"));
    const rt = createRuntime(testConfig({ audit: { path: join(dir, "audit.jsonl") } }));
    const adapter = new FakeBrowserAdapter("fake-1");
    await rt.attach(adapter);
    adapter.connectSource(testSource({ adapterId: "fake-1" }));
    adapter.registerTool("tab-18", discoveredTool("echo"));
    const tool = rt.tools.list()[0];
    const result = await rt.router.invoke(
      {
        requestId: "int-1",
        target: { mcpName: tool?.identity.mcpName ?? "" },
        input: { ok: true },
        client: { processInstanceId: "proc-1", claimedName: "test" },
      },
      { signal: new AbortController().signal, deadline: Date.now() + 5_000 },
    );
    expect(result.status).toBe("success");
  });
});
