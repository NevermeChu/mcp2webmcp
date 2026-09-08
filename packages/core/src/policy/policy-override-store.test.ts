import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FilePolicyOverrideStore } from "./policy-override-store.js";

describe("FilePolicyOverrideStore", () => {
  it("persists exact origin and tool modes across instances", () => {
    const path = join(mkdtempSync(join(tmpdir(), "mcp2webmcp-policy-")), "policy.json");
    const first = new FilePolicyOverrideStore(path);
    first.set("https://example.test", "echo", "confirm");
    const second = new FilePolicyOverrideStore(path);
    expect(second.get("https://example.test", "echo")?.mode).toBe("confirm");
    expect(second.get("https://example.test", "other")).toBeUndefined();
    second.set("https://example.test", "echo", "deny");
    expect(first.get("https://example.test", "echo")?.mode).toBe("deny");
  });

  it("rejects a partially invalid authority file instead of dropping entries", () => {
    const path = join(mkdtempSync(join(tmpdir(), "mcp2webmcp-policy-")), "policy.json");
    writeFileSync(path, '{"version":1,"overrides":[{"mode":"allow"}]}');
    expect(() => new FilePolicyOverrideStore(path).list()).toThrow("unreadable");
  });
});
