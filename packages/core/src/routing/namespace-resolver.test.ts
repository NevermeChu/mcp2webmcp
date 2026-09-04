import { describe, expect, it } from "vitest";
import { NamespaceResolver } from "./namespace-resolver.js";
import { testSource } from "../../../../tests/helpers.js";

describe("NamespaceResolver", () => {
  const names = new NamespaceResolver();

  it("is deterministic for the same source and tool", () => {
    const source = testSource();
    expect(names.resolve(source, "search_documents")).toEqual(
      names.resolve(source, "search_documents"),
    );
  });

  it("differs for the same tool on different tabs", () => {
    const a = names.resolve(testSource({ tabId: "18", sourceId: "tab-18" }), "search");
    const b = names.resolve(testSource({ tabId: "19", sourceId: "tab-19" }), "search");
    expect(a.mcpName).not.toBe(b.mcpName);
    expect(a.runtimeId).not.toBe(b.runtimeId);
  });

  it("differs for the same tool on different origins", () => {
    const a = names.resolve(testSource({ origin: "https://knowmesh.app" }), "search");
    const b = names.resolve(
      testSource({ origin: "https://github.com", sourceId: "other" }),
      "search",
    );
    expect(a.mcpName).not.toBe(b.mcpName);
  });

  it("differs for the same origin and different profile via sourceId", () => {
    const a = names.resolve(testSource({ profileId: "p1", sourceId: "s1" }), "search");
    const b = names.resolve(testSource({ profileId: "p2", sourceId: "s2" }), "search");
    expect(a.runtimeId).not.toBe(b.runtimeId);
  });

  it("sanitizes invalid MCP characters", () => {
    const identity = names.resolve(testSource(), "search documents!");
    expect(identity.mcpName).toMatch(/^[a-zA-Z0-9_]+$/);
  });

  it("keeps names at or under 128 characters", () => {
    const identity = names.resolve(testSource(), "n".repeat(500));
    expect(identity.mcpName.length).toBeLessThanOrEqual(128);
    expect(identity.mcpName).toMatch(/__[0-9a-f]{6}$/);
  });

  it("does not depend on registration order for truncated collisions", () => {
    const longA = names.resolve(testSource({ sourceId: "a", tabId: "1" }), "x".repeat(400));
    const longB = names.resolve(testSource({ sourceId: "b", tabId: "2" }), "x".repeat(400));
    const reverseB = names.resolve(testSource({ sourceId: "b", tabId: "2" }), "x".repeat(400));
    const reverseA = names.resolve(testSource({ sourceId: "a", tabId: "1" }), "x".repeat(400));
    expect(longA.mcpName).toBe(reverseA.mcpName);
    expect(longB.mcpName).toBe(reverseB.mcpName);
    expect(longA.mcpName).not.toBe(longB.mcpName);
  });

  it("keeps mcpName and runtimeId stable across generation", () => {
    const v1 = names.resolve(testSource({ generation: 1 }), "search");
    const v2 = names.resolve(testSource({ generation: 2 }), "search");
    expect(v1.mcpName).toBe(v2.mcpName);
    expect(v1.runtimeId).toBe(v2.runtimeId);
    expect(v1.sourceGeneration).toBe(1);
    expect(v2.sourceGeneration).toBe(2);
  });

  it("normalizes domains as specified", () => {
    expect(names.normalizeDomain("https://app.knowmesh.com")).toBe("app_knowmesh");
    expect(names.normalizeDomain("https://docs.google.com")).toBe("docs_google");
    expect(names.normalizeDomain("https://github.com")).toBe("github");
  });
});
