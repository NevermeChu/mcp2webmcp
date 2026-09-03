import { describe, expect, it } from "vitest";
import { PolicyEngine } from "./policy-engine.js";
import { MemoryConsentStore } from "./consent-store.js";
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

  it("allows a discovered tool when consent has admitted it", () => {
    const consent = new MemoryConsentStore();
    consent.admit("https://knowmesh.app", "list_notes");
    const withConsent = new PolicyEngine(testConfig().policy, consent);
    expect(withConsent.evaluate(context("list_notes")).action).toBe("allow");
    expect(engine.evaluate(context("list_notes")).action).toBe("deny");
  });

  it("lets a yaml confirm win over consent when MCP-B drops destructiveHint", () => {
    const consent = new MemoryConsentStore();
    consent.admit("https://knowmesh.app", "safe_backup");
    const withConsent = new PolicyEngine(
      {
        default: "deny",
        rules: [{ match: { tool: "safe_backup" }, action: "confirm" }],
      },
      consent,
    );
    expect(withConsent.evaluate(context("safe_backup")).action).toBe("confirm");
  });

  it("lets a yaml deny win over consent", () => {
    const consent = new MemoryConsentStore();
    consent.admit("https://knowmesh.app", "echo");
    const withConsent = new PolicyEngine(
      {
        default: "deny",
        rules: [{ match: { origin: "https://knowmesh.app", tool: "echo" }, action: "deny" }],
      },
      consent,
    );
    expect(withConsent.evaluate(context("echo")).action).toBe("deny");
  });
});
