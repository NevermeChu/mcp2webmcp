import { describe, expect, it } from "vitest";
import { PolicyEngine } from "./policy-engine.js";
import { NamespaceResolver } from "../routing/namespace-resolver.js";
import { testConfig, testSource } from "../../../../tests/helpers.js";

function context(originalName: string, extra?: { destructive?: boolean; origin?: string }) {
  const source = testSource({ origin: extra?.origin ?? "https://knowmesh.app" });
  const identity = new NamespaceResolver().resolve(source, originalName);
  return {
    tool: {
      identity,
      sourceId: source.sourceId,
      sourceGeneration: source.generation,
      inputSchema: {},
      annotations: extra?.destructive ? { destructiveHint: true } : undefined,
      discoveredAt: 1,
      updatedAt: 1,
      status: "available" as const,
    },
    source,
    input: {},
  };
}

describe("PolicyEngine", () => {
  const engine = new PolicyEngine(testConfig().policy);

  it("allows an exact origin and tool rule", () => {
    expect(engine.evaluate(context("search_documents")).action).toBe("allow");
  });

  it("denies by default", () => {
    expect(engine.evaluate(context("unknown_tool")).action).toBe("deny");
  });

  it("upgrades allow to confirm when destructiveHint is set", () => {
    expect(engine.evaluate(context("search_documents", { destructive: true })).action).toBe(
      "confirm",
    );
  });

  it("does not allow based on destructiveHint alone", () => {
    expect(engine.evaluate(context("wipe", { destructive: true })).action).toBe("confirm");
  });

  it("matches deny/confirm globs but never auto-allows them", () => {
    expect(engine.evaluate(context("delete_all")).action).toBe("confirm");
  });
});
