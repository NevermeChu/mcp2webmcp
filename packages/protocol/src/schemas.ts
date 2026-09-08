import { z } from "zod";
import { defaultResourceLimits } from "./config.js";
import { defaultConsentConfig } from "./consent.js";

export const adapterTypeSchema = z.enum(["extension", "mcpb", "fake"]);

export const sourceStateSchema = z.enum(["connected", "disconnected"]);

export const browserSourceSchema = z
  .object({
    adapterId: z.string().min(1),
    sourceId: z.string().min(1),
    generation: z.number().int().nonnegative(),
    browserId: z.string().min(1),
    tabId: z.string().min(1),
    origin: z.string().min(1),
    url: z.string().min(1),
    title: z.string().optional(),
    adapterType: adapterTypeSchema,
    connectedAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    state: sourceStateSchema,
  })
  .strict();

export const toolAnnotationsSchema = z
  .object({
    readOnlyHint: z.boolean().optional(),
    destructiveHint: z.boolean().optional(),
    idempotentHint: z.boolean().optional(),
    openWorldHint: z.boolean().optional(),
  })
  .strict();

export const toolIdentitySchema = z.object({
  adapterId: z.string().min(1),
  sourceId: z.string().min(1),
  sourceGeneration: z.number().int().nonnegative(),
  originalName: z.string().min(1),
  runtimeId: z.string().min(1),
  mcpName: z.string().min(1).max(128),
});

export const runtimeToolSchema = z
  .object({
    identity: toolIdentitySchema,
    description: z.string().optional(),
    inputSchema: z.record(z.unknown()),
    annotations: toolAnnotationsSchema.optional(),
    discoveredAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

export const runtimeErrorCodeSchema = z.enum([
  "TOOL_NOT_FOUND",
  "TOOL_UNAVAILABLE",
  "SOURCE_NOT_FOUND",
  "SOURCE_DISCONNECTED",
  "POLICY_DENIED",
  "CONFIRMATION_UNAVAILABLE",
  "CONFIRMATION_DENIED",
  "INVALID_INPUT",
  "CANCELLED",
  "INVOCATION_TIMEOUT",
  "OUTCOME_UNKNOWN",
  "RESULT_TOO_LARGE",
  "RATE_LIMITED",
  "BROWSER_ERROR",
  "WEBMCP_ERROR",
  "INTERNAL_ERROR",
  "AUDIT_FAILED",
  "SCHEMA_TOO_LARGE",
]);

export const invokeOutcomeSchema = z.enum(["not_executed", "executed_failed", "unknown"]);

export const runtimeInvokeRequestSchema = z.object({
  requestId: z.string().min(1),
  target: z.union([
    z.object({ mcpName: z.string().min(1) }),
    z.object({ runtimeId: z.string().min(1) }),
  ]),
  input: z.unknown(),
  client: z.object({
    processInstanceId: z.string().min(1),
    claimedName: z.string().optional(),
  }),
});

export const policyRuleSchema = z
  .object({
    match: z
      .object({
        origin: z.string().optional(),
        tool: z.string().optional(),
        destructive: z.boolean().optional(),
      })
      .strict(),
    action: z.enum(["allow", "deny", "confirm"]),
  })
  .strict()
  .superRefine((rule, ctx) => {
    if (rule.action === "allow" && rule.match.tool?.includes("*")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "tool glob cannot be used on allow rules",
      });
    }
  });

export const policyConfigSchema = z
  .object({
    default: z.enum(["allow", "deny"]).default("deny"),
    rules: z.array(policyRuleSchema).default([]),
    overridesPath: z.string().min(1).optional(),
  })
  .strict();

export const consentConfigSchema = z
  .object({
    enabled: z.boolean().default(defaultConsentConfig.enabled),
    autoAdmit: z.boolean().default(defaultConsentConfig.autoAdmit),
    path: z.string().min(1).default(defaultConsentConfig.path),
  })
  .strict()
  .default(defaultConsentConfig);

export const resourceLimitsSchema = z
  .object({
    maxToolsPerSource: z.number().int().positive().default(defaultResourceLimits.maxToolsPerSource),
    maxToolsTotal: z.number().int().positive().default(defaultResourceLimits.maxToolsTotal),
    maxInputBytes: z.number().int().positive().default(defaultResourceLimits.maxInputBytes),
    maxOutputBytes: z.number().int().positive().default(defaultResourceLimits.maxOutputBytes),
    maxSchemaBytes: z.number().int().positive().default(defaultResourceLimits.maxSchemaBytes),
    maxQueuePerSource: z.number().int().positive().default(defaultResourceLimits.maxQueuePerSource),
    maxSchemaDepth: z.number().int().positive().default(defaultResourceLimits.maxSchemaDepth),
  })
  .strict();

export const runtimeConfigSchema = z
  .object({
    runtime: z
      .object({
        name: z.string().default("mcp2webmcp"),
        logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
        logPath: z.string().min(1).optional(),
        logMaxBytes: z.number().int().positive().default(5_242_880),
        invocationDeadlineMs: z.number().int().positive().default(65_000),
      })
      .strict(),
    browser: z
      .object({
        adapter: z.enum(["fake", "mcpb", "extension"]).default("fake"),
        allowedOrigins: z.array(z.string()).default([]),
        mcpb: z
          .object({
            host: z.string().optional(),
            port: z.number().int().min(1).max(65_535).optional(),
            persistPath: z.string().optional(),
            relayId: z.string().optional(),
            label: z.string().optional(),
            invokeTimeoutMs: z.number().int().positive().optional(),
            maxPayloadBytes: z.number().int().positive().optional(),
          })
          .strict()
          .optional(),
        extension: z
          .object({
            host: z.string().optional(),
            port: z.number().int().min(1).max(65_535).optional(),
            invokeTimeoutMs: z.number().int().positive().optional(),
            authToken: z.string().min(1).max(512).optional(),
            disconnectGraceMs: z.number().int().min(0).max(300_000).optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    policy: policyConfigSchema,
    consent: consentConfigSchema,
    audit: z
      .object({
        enabled: z.boolean().default(true),
        path: z.string().min(1),
        maxBytes: z.number().int().positive().default(10_485_760),
      })
      .strict(),
    limits: resourceLimitsSchema.default(defaultResourceLimits),
  })
  .strict()
  .superRefine((config, ctx) => {
    if (config.browser.allowedOrigins.includes("*")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `allowedOrigins must not include * for production ${config.browser.adapter}`,
        path: ["browser", "allowedOrigins"],
      });
    }
    const adapter = config.browser.adapter;
    if (adapter !== "mcpb" && adapter !== "extension") return;
    if (adapter === "extension" && config.consent.enabled) return;
    if (config.browser.allowedOrigins.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${adapter} adapter requires an explicit allowedOrigins list when consent is disabled`,
        path: ["browser", "allowedOrigins"],
      });
    }
  });
