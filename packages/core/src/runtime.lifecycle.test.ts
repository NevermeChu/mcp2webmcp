import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoveredTool, FakeBrowserAdapter } from "@mcp2webmcp/browser-adapter";
import { createRuntime } from "./runtime.js";
import { testConfig, testSource } from "../../../tests/helpers.js";

function runtime() {
  const dir = mkdtempSync(join(tmpdir(), "mcp2webmcp-"));
  return createRuntime(testConfig({ audit: { path: join(dir, "audit.jsonl") } }));
}

describe("LifecycleManager", () => {
  it("reconciles snapshot after subscribe", async () => {
    const rt = runtime();
    const adapter = new FakeBrowserAdapter("fake-1");
    adapter.connectSource(testSource({ adapterId: "fake-1" }));
    adapter.registerTool("tab-18", discoveredTool("echo"));
    await rt.attach(adapter);
    expect(rt.sources.get("fake-1", "tab-18")?.state).toBe("connected");
    expect(rt.tools.list()).toHaveLength(1);
  });

  it("rejects stale generation and out-of-order revision", async () => {
    const rt = runtime();
    const adapter = new FakeBrowserAdapter("fake-1");
    await rt.attach(adapter);
    adapter.connectSource(testSource({ adapterId: "fake-1", generation: 2 }));
    adapter.registerTool("tab-18", discoveredTool("echo"));
    expect(rt.tools.list()).toHaveLength(1);
    rt.lifecycle.onEvent({
      type: "tool.registered",
      adapterId: "fake-1",
      sourceId: "tab-18",
      sourceGeneration: 1,
      revision: 99,
      tool: {
        ...discoveredTool("echo"),
        sourceId: "tab-18",
        sourceGeneration: 1,
        status: "available",
      },
    });
    expect(rt.sources.get("fake-1", "tab-18")?.generation).toBe(2);
    rt.lifecycle.onEvent({
      type: "source.updated",
      adapterId: "fake-1",
      sourceId: "tab-18",
      sourceGeneration: 2,
      revision: 0,
      source: testSource({ adapterId: "fake-1", generation: 2, title: "late" }),
    });
    expect(rt.sources.get("fake-1", "tab-18")?.title).not.toBe("late");
  });

  it("drops tools when the source disconnects", async () => {
    const rt = runtime();
    const adapter = new FakeBrowserAdapter("fake-1");
    await rt.attach(adapter);
    adapter.connectSource(testSource({ adapterId: "fake-1" }));
    adapter.registerTool("tab-18", discoveredTool("echo"));
    adapter.disconnectSource("tab-18");
    expect(rt.tools.list()).toHaveLength(0);
    expect(rt.sources.get("fake-1", "tab-18")).toBeUndefined();
  });

  it("ignores delayed events from a previous generation after reload", async () => {
    const rt = runtime();
    const adapter = new FakeBrowserAdapter("fake-1");
    await rt.attach(adapter);
    adapter.connectSource(testSource({ adapterId: "fake-1", generation: 1 }));
    adapter.registerTool("tab-18", discoveredTool("echo"));
    adapter.reloadSource("tab-18");
    adapter.registerTool("tab-18", discoveredTool("echo"));
    expect(rt.sources.get("fake-1", "tab-18")?.generation).toBe(2);
    rt.lifecycle.onEvent({
      type: "tool.registered",
      adapterId: "fake-1",
      sourceId: "tab-18",
      sourceGeneration: 1,
      revision: 99,
      tool: {
        ...discoveredTool("stale_echo"),
        sourceId: "tab-18",
        sourceGeneration: 1,
        status: "available",
      },
    });
    expect(rt.tools.list().some((tool) => tool.identity.originalName === "stale_echo")).toBe(false);
  });
});
