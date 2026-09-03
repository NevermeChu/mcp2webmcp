import { describe, expect, it } from "vitest";
import { NamespaceResolver } from "../routing/namespace-resolver.js";
import { ToolRegistry } from "./tool-registry.js";
import { testSource } from "../../../../tests/helpers.js";

describe("ToolRegistry", () => {
  const names = new NamespaceResolver();

  function tool(source = testSource(), originalName = "search_documents") {
    const identity = names.resolve(source, originalName);
    return {
      identity,
      sourceId: source.sourceId,
      sourceGeneration: source.generation,
      inputSchema: { type: "object", properties: {} },
      discoveredAt: 1,
      updatedAt: 1,
      status: "available" as const,
    };
  }

  it("registers a tool", () => {
    const registry = new ToolRegistry();
    registry.register(tool());
    expect(registry.list()).toHaveLength(1);
  });

  it("updates a duplicate runtimeId", () => {
    const registry = new ToolRegistry();
    const first = tool();
    registry.register(first);
    registry.register({ ...first, description: "updated" });
    expect(registry.get(first.identity.runtimeId)?.description).toBe("updated");
    expect(registry.list()).toHaveLength(1);
  });

  it("unregisters by source", () => {
    const registry = new ToolRegistry();
    registry.register(tool());
    registry.unregisterBySource("fake-1", "tab-18");
    expect(registry.list()).toHaveLength(0);
  });

  it("looks up by MCP name", () => {
    const registry = new ToolRegistry();
    const registered = tool();
    registry.register(registered);
    expect(registry.getByMcpName(registered.identity.mcpName)?.identity.originalName).toBe(
      "search_documents",
    );
  });
});
