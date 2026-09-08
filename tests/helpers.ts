import type { BrowserSource, RuntimeConfig } from "@mcp2webmcp/protocol";
import { defaultResourceLimits } from "@mcp2webmcp/protocol";

export function disabledConsent(path = "consent.json"): RuntimeConfig["consent"] {
  return { enabled: false, autoAdmit: false, path };
}

export function enabledConsent(path: string): RuntimeConfig["consent"] {
  return { enabled: true, autoAdmit: true, path };
}

export function testSource(overrides: Partial<BrowserSource> = {}): BrowserSource {
  return {
    adapterId: "fake-1",
    sourceId: "tab-18",
    generation: 1,
    browserId: "browser-1",
    tabId: "18",
    origin: "https://knowmesh.app",
    url: "https://knowmesh.app/docs",
    adapterType: "fake",
    connectedAt: 1,
    updatedAt: 1,
    state: "connected",
    ...overrides,
  };
}

export function testConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  const base: RuntimeConfig = {
    runtime: {
      name: "mcp2webmcp-test",
      logLevel: "info",
      invocationDeadlineMs: 65_000,
    },
    browser: {
      adapter: "fake",
      allowedOrigins: ["https://knowmesh.app"],
    },
    policy: {
      default: "deny",
      rules: [
        {
          match: { origin: "https://knowmesh.app", tool: "search_documents" },
          action: "allow",
        },
        {
          match: { origin: "https://knowmesh.app", tool: "echo" },
          action: "allow",
        },
        { match: { destructive: true }, action: "confirm" },
        { match: { tool: "delete_*" }, action: "confirm" },
      ],
    },
    audit: {
      enabled: true,
      path: "audit.jsonl",
      maxBytes: 1_048_576,
    },
    limits: { ...defaultResourceLimits },
    consent: disabledConsent(),
  };
  return {
    ...base,
    ...overrides,
    runtime: { ...base.runtime, ...overrides.runtime },
    browser: {
      ...base.browser,
      ...overrides.browser,
      mcpb: overrides.browser?.mcpb ?? base.browser.mcpb,
    },
    policy: overrides.policy ?? base.policy,
    consent: overrides.consent ?? base.consent,
    audit: { ...base.audit, ...overrides.audit },
    limits: { ...base.limits, ...overrides.limits },
  };
}
