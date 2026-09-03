import { z } from "zod";
import { defaultResourceLimits } from "./config.js";

export const adapterTypeSchema = z.enum(["extension", "cdp", "playwright", "mcpb", "fake"]);

export const sourceStateSchema = z.enum(["connected", "stale", "disconnected"]);

export const browserSourceSchema = z.object({
  adapterId: z.string().min(1),
  sourceId: z.string().min(1),
  generation: z.number().int().nonnegative(),
  browserId: z.string().min(1),
  profileId: z.string().optional(),
  tabId: z.string().min(1),
  frameId: z.string().optional(),
  origin: z.string().min(1),
  url: z.string().min(1),
  title: z.string().optional(),
  adapterType: adapterTypeSchema,
  connectedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  state: sourceStateSchema,
});

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

export const runtimeToolSchema = z.object({
  identity: toolIdentitySchema,
  sourceId: z.string().min(1),
  sourceGeneration: z.number().int().nonnegative(),
  description: z.string().optional(),
  inputSchema: z.record(z.unknown()),
  annotations: toolAnnotationsSchema.optional(),
  discoveredAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  status: z.enum(["available", "stale", "unavailable"]),
});

export const runtimeErrorCodeSchema = z.enum([
  "TOOL_NOT_FOUND",
  "TOOL_UNAVAILABLE",
  "SOURCE_NOT_FOUND",
  "SOURCE_DISCONNECTED",
  "POLICY_DENIED",
  "CONFIRMATION_REQUIRED",
  "CONFIRMATION_UNAVAILABLE",
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
    match: z.object({
      origin: z.string().optional(),
      tool: z.string().optional(),
      destructive: z.boolean().optional(),
    }),
    action: z.enum(["allow", "deny", "confirm"]),
  })
  .superRefine((rule, ctx) => {
    if (rule.action === "allow" && rule.match.tool?.includes("*")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "tool glob cannot be used on allow rules",
      });
    }
  });

export const policyConfigSchema = z.object({
  default: z.enum(["allow", "deny"]).default("deny"),
  rules: z.array(policyRuleSchema).default([]),
});

export const resourceLimitsSchema = z.object({
  maxToolsPerSource: z.number().int().positive().default(defaultResourceLimits.maxToolsPerSource),
  maxToolsTotal: z.number().int().positive().default(defaultResourceLimits.maxToolsTotal),
  maxInputBytes: z.number().int().positive().default(defaultResourceLimits.maxInputBytes),
  maxOutputBytes: z.number().int().positive().default(defaultResourceLimits.maxOutputBytes),
  maxSchemaBytes: z.number().int().positive().default(defaultResourceLimits.maxSchemaBytes),
  maxQueuePerSource: z.number().int().positive().default(defaultResourceLimits.maxQueuePerSource),
  maxSchemaDepth: z.number().int().positive().default(defaultResourceLimits.maxSchemaDepth),
  schemaCompileTimeoutMs: z
    .number()
    .int()
    .positive()
    .default(defaultResourceLimits.schemaCompileTimeoutMs),
});

export const runtimeConfigSchema = z.object({
  runtime: z.object({
    name: z.string().default("mcp2webmcp"),
    logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
    invocationDeadlineMs: z.number().int().positive().default(65_000),
  }),
  mcp: z
    .object({
      stdio: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
    })
    .default({ stdio: { enabled: true } }),
  browser: z.object({
    adapter: z.string().default("fake"),
    allowedOrigins: z.array(z.string()).default([]),
    mcpb: z
      .object({
        host: z.string().optional(),
        port: z.number().int().positive().optional(),
        persistPath: z.string().optional(),
        relayId: z.string().optional(),
        label: z.string().optional(),
        invokeTimeoutMs: z.number().int().positive().optional(),
        maxPayloadBytes: z.number().int().positive().optional(),
      })
      .optional(),
    extension: z
      .object({
        host: z.string().optional(),
        port: z.number().int().positive().optional(),
        invokeTimeoutMs: z.number().int().positive().optional(),
      })
      .optional(),
  }),
  policy: policyConfigSchema,
  audit: z.object({
    enabled: z.boolean().default(true),
    path: z.string().min(1),
    maxBytes: z.number().int().positive().default(10_485_760),
  }),
  limits: resourceLimitsSchema.default(defaultResourceLimits),
}).superRefine((config, ctx) => {
  if (config.browser.adapter !== "mcpb" && config.browser.adapter !== "extension") return;
  if (config.browser.allowedOrigins.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${config.browser.adapter} adapter requires an explicit allowedOrigins list`,
      path: ["browser", "allowedOrigins"],
    });
  }
  if (config.browser.allowedOrigins.includes("*")) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `allowedOrigins must not include * for production ${config.browser.adapter}`,
      path: ["browser", "allowedOrigins"],
    });
  }
});
