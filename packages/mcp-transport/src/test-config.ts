import { defaultResourceLimits } from "@mcp2webmcp/protocol";
import type { RuntimeConfig } from "@mcp2webmcp/protocol";

export function testRuntimeConfig(auditPath: string): RuntimeConfig {
  return {
    runtime: {
      name: "mcp2webmcp-test",
      logLevel: "info",
      invocationDeadlineMs: 65_000,
    },
    mcp: { stdio: { enabled: true } },
    browser: {
      adapter: "fake",
      allowedOrigins: ["https://knowmesh.app"],
    },
    policy: {
      default: "deny",
      rules: [
        {
          match: { origin: "https://knowmesh.app", tool: "echo" },
          action: "allow",
        },
      ],
    },
    audit: { enabled: true, path: auditPath, maxBytes: 1_048_576 },
    limits: { ...defaultResourceLimits },
    consent: { enabled: false, autoAdmit: false, path: "consent.json" },
  };
}
