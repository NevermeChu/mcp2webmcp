import { describe, expect, it } from "vitest";
import { SourceRegistry } from "./source-registry.js";
import { testSource } from "../../../../tests/helpers.js";

describe("SourceRegistry", () => {
  it("registers a source", () => {
    const registry = new SourceRegistry();
    registry.upsert(testSource());
    expect(registry.get("fake-1", "tab-18")?.origin).toBe("https://knowmesh.app");
  });

  it("updates a duplicate source in place", () => {
    const registry = new SourceRegistry();
    registry.upsert(testSource({ title: "one", connectedAt: 10 }));
    registry.upsert(testSource({ title: "two", updatedAt: 20 }));
    const source = registry.get("fake-1", "tab-18");
    expect(source?.title).toBe("two");
    expect(source?.connectedAt).toBe(10);
  });

  it("removes a disconnected source", () => {
    const registry = new SourceRegistry();
    registry.upsert(testSource());
    registry.remove("fake-1", "tab-18");
    expect(registry.get("fake-1", "tab-18")).toBeUndefined();
  });

  it("finds sources by origin", () => {
    const registry = new SourceRegistry();
    registry.upsert(testSource());
    registry.upsert(testSource({ sourceId: "tab-19", origin: "https://github.com" }));
    expect(registry.findByOrigin("https://knowmesh.app")).toHaveLength(1);
  });

  it("keeps same adapter type with different adapterId distinct", () => {
    const registry = new SourceRegistry();
    registry.upsert(testSource({ adapterId: "a" }));
    registry.upsert(testSource({ adapterId: "b" }));
    expect(registry.list()).toHaveLength(2);
  });
});
