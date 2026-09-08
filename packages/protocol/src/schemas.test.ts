import { describe, expect, it } from "vitest";
import {
  browserSourceSchema,
  policyRuleSchema,
  runtimeConfigSchema,
  runtimeInvokeRequestSchema,
  runtimeToolSchema,
} from "./schemas.js";

const source = {
  adapterId: "fake-1",
  sourceId: "tab-18",
  generation: 1,
  browserId: "browser-1",
  tabId: "18",
  origin: "https://knowmesh.app",
  url: "https://knowmesh.app/docs",
  adapterType: "fake" as const,
  connectedAt: 1,
  updatedAt: 1,
  state: "connected" as const,
};

const runtimeTool = {
  identity: {
    adapterId: "fake-1",
    sourceId: "tab-18",
    sourceGeneration: 1,
    originalName: "search_documents",
    runtimeId: "rt_abc",
    mcpName: "knowmesh__tab18__search_documents__a81f2c",
  },
  inputSchema: { type: "object", properties: {} },
  discoveredAt: 1,
  updatedAt: 1,
};

describe("protocol schemas", () => {
  it("rejects a missing adapterId", () => {
    expect(() => browserSourceSchema.parse({ ...source, adapterId: "" })).toThrow();
  });

  it("rejects removed speculative source and tool fields", () => {
    expect(() => browserSourceSchema.parse({ ...source, profileId: "profile-1" })).toThrow(
      /unrecognized/i,
    );
    expect(() => browserSourceSchema.parse({ ...source, adapterType: "cdp" })).toThrow();
    expect(() =>
      runtimeToolSchema.parse({
        ...runtimeTool,
        sourceId: "tab-18",
        sourceGeneration: 1,
        status: "available",
      }),
    ).toThrow(/unrecognized/i);
  });

  it("rejects mcp names longer than 128 characters", () => {
    expect(() =>
      runtimeToolSchema.parse({
        ...runtimeTool,
        identity: {
          ...runtimeTool.identity,
          mcpName: "n".repeat(129),
        },
      }),
    ).toThrow();
  });

  it("accepts invoke by mcpName or runtimeId", () => {
    const base = {
      requestId: "r1",
      input: { query: "hi" },
      client: { processInstanceId: "proc-1" },
    };
    expect(
      runtimeInvokeRequestSchema.parse({ ...base, target: { mcpName: "echo" } }).target,
    ).toEqual({ mcpName: "echo" });
    expect(
      runtimeInvokeRequestSchema.parse({ ...base, target: { runtimeId: "rt_1" } }).target,
    ).toEqual({ runtimeId: "rt_1" });
  });

  it("rejects allow rules that use a tool glob", () => {
    expect(() =>
      policyRuleSchema.parse({
        match: { tool: "delete_*" },
        action: "allow",
      }),
    ).toThrow(/glob/);
  });

  it("parses runtime config with default deny", () => {
    const config = runtimeConfigSchema.parse({
      runtime: {},
      browser: { allowedOrigins: ["https://knowmesh.app"] },
      policy: { default: "deny", rules: [] },
      audit: { path: "/tmp/audit.jsonl" },
    });
    expect(config.policy.default).toBe("deny");
    expect(config.consent.enabled).toBe(true);
    expect(config.limits.maxToolsTotal).toBe(500);
  });

  it("allows extension config with empty allowedOrigins when consent is on", () => {
    const config = runtimeConfigSchema.parse({
      runtime: {},
      browser: { adapter: "extension", allowedOrigins: [] },
      policy: { default: "deny", rules: [] },
      audit: { path: "/tmp/audit.jsonl" },
    });
    expect(config.browser.allowedOrigins).toEqual([]);
    expect(config.consent.enabled).toBe(true);
  });

  it("still requires mcpb allowedOrigins even when consent is on", () => {
    expect(() =>
      runtimeConfigSchema.parse({
        runtime: {},
        browser: { adapter: "mcpb", allowedOrigins: [] },
        policy: { default: "deny", rules: [] },
        audit: { path: "/tmp/audit.jsonl" },
      }),
    ).toThrow(/allowedOrigins/);
  });

  it("rejects mcpb config that uses a wildcard origin", () => {
    expect(() =>
      runtimeConfigSchema.parse({
        runtime: {},
        browser: { adapter: "mcpb", allowedOrigins: ["*"] },
        policy: { default: "deny", rules: [] },
        audit: { path: "/tmp/audit.jsonl" },
      }),
    ).toThrow(/\*/);
  });

  it("rejects extension config that uses a wildcard origin", () => {
    expect(() =>
      runtimeConfigSchema.parse({
        runtime: {},
        browser: { adapter: "extension", allowedOrigins: ["*"] },
        policy: { default: "deny", rules: [] },
        audit: { path: "/tmp/audit.jsonl" },
      }),
    ).toThrow(/\*/);
  });

  it("rejects unknown configuration keys instead of silently ignoring them", () => {
    expect(() =>
      runtimeConfigSchema.parse({
        runtime: { logLevell: "debug" },
        browser: { allowedOrigins: [] },
        policy: { default: "deny", rules: [] },
        audit: { path: "/tmp/audit.jsonl" },
      }),
    ).toThrow(/unrecognized/i);
  });

  it("rejects the removed stdio enabled switch", () => {
    expect(() =>
      runtimeConfigSchema.parse({
        runtime: {},
        mcp: { stdio: { enabled: true } },
        browser: { allowedOrigins: [] },
        policy: { default: "deny", rules: [] },
        audit: { path: "/tmp/audit.jsonl" },
      }),
    ).toThrow(/unrecognized/i);
  });
});
