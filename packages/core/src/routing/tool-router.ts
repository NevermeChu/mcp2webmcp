import { createHash } from "node:crypto";
import {
  RuntimeError,
  sourceKey,
  type AdapterRegistry,
  type AuditRecord,
  type BrowserSource,
  type ResourceLimits,
  type RuntimeInvokeRequest,
  type RuntimeInvokeResult,
  type RuntimeTool,
} from "@mcp2webmcp/protocol";
import type { AuditLogger } from "../audit/audit-logger.js";
import type { PolicyEngine } from "../policy/policy-engine.js";
import type { SourceRegistry } from "../registry/source-registry.js";
import type { ToolRegistry } from "../registry/tool-registry.js";
import { SchemaValidator } from "./schema-validator.js";
import { SourceInvocationQueue } from "./source-queue.js";

export class ToolRouter {
  private readonly validator: SchemaValidator;
  private readonly queue: SourceInvocationQueue;

  constructor(
    private readonly options: {
      sources: SourceRegistry;
      tools: ToolRegistry;
      adapters: AdapterRegistry;
      policy: PolicyEngine;
      audit: AuditLogger;
      limits: ResourceLimits;
      invocationDeadlineMs: number;
    },
  ) {
    this.validator = new SchemaValidator(options.limits);
    this.queue = new SourceInvocationQueue(options.limits.maxQueuePerSource);
  }

  async invoke(
    request: RuntimeInvokeRequest,
    options: { signal: AbortSignal; deadline: number },
  ): Promise<RuntimeInvokeResult> {
    const started = Date.now();
    const tool = this.resolveTool(request);
    if (!tool) {
      await this.safeAudit({
        requestId: request.requestId,
        timestamp: started,
        runtimeToolId: "",
        mcpToolName:
          "mcpName" in request.target ? request.target.mcpName : request.target.runtimeId,
        sourceId: "",
        origin: "",
        decision: "deny",
        success: false,
        errorCode: "TOOL_NOT_FOUND",
        inputDigest: digestInput(request.input),
      });
      return errorResult("TOOL_NOT_FOUND", "tool not found", "not_executed");
    }

    const source = this.options.sources.get(tool.identity.adapterId, tool.identity.sourceId);
    if (!source) {
      return errorResult("SOURCE_NOT_FOUND", "source not found", "not_executed");
    }
    if (source.state === "disconnected") {
      return errorResult("SOURCE_DISCONNECTED", "source is disconnected", "not_executed");
    }
    if (tool.identity.sourceGeneration !== source.generation) {
      return errorResult("TOOL_UNAVAILABLE", "tool generation is stale", "not_executed");
    }

    try {
      this.assertSize(request.input, this.options.limits.maxInputBytes, "INVALID_INPUT", "input");
      this.validator.validate(tool.inputSchema, request.input);
    } catch (error) {
      return this.fail(request, tool, source, started, error, "deny");
    }

    const decision = this.options.policy.evaluate({
      client: {
        clientId: request.client.processInstanceId,
        name: request.client.claimedName,
      },
      tool,
      source,
      input: request.input,
    });

    const adapter = this.options.adapters.get(source.adapterId);

    if (decision.action === "confirm") {
      if (!adapter?.requestConfirmation) {
        const err = new RuntimeError(
          "CONFIRMATION_UNAVAILABLE",
          "confirmation requires a connected extension control plane",
          "not_executed",
        );
        this.notify(adapter, request, tool, source, "confirm", err.message, err.code);
        return this.fail(request, tool, source, started, err, "confirm");
      }
      try {
        const approved = await adapter.requestConfirmation(
          {
            requestId: request.requestId,
            sourceId: source.sourceId,
            sourceGeneration: source.generation,
            origin: source.origin,
            originalName: tool.identity.originalName,
            mcpName: tool.identity.mcpName,
            inputPreview: describeInput(request.input),
            clientName: request.client.claimedName,
          },
          options,
        );
        if (!approved) {
          throw new RuntimeError(
            "CONFIRMATION_DENIED",
            "user denied this invocation",
            "not_executed",
          );
        }
      } catch (error) {
        const mapped = this.asError(error);
        this.notify(
          adapter,
          request,
          tool,
          source,
          "confirm",
          mapped.error.message,
          mapped.error.code,
        );
        return this.fail(request, tool, source, started, error, "confirm");
      }
    }
    if (decision.action === "deny") {
      const err = new RuntimeError("POLICY_DENIED", decision.reason, "not_executed");
      this.notify(adapter, request, tool, source, "deny", err.message, err.code);
      return this.fail(request, tool, source, started, err, "deny");
    }

    try {
      await this.options.audit.append(this.record(request, tool, source, started, "allow"));
    } catch (error) {
      return this.asError(error);
    }

    const key = sourceKey(source.adapterId, source.sourceId);
    try {
      const result = await this.queue.run(key, () => this.dispatch(request, tool, source, options));
      await this.safeAudit(
        this.record(request, tool, source, started, "allow", {
          success: true,
          durationMs: Date.now() - started,
        }),
      );
      return result;
    } catch (error) {
      const mapped = this.asError(error);
      await this.safeAudit(
        this.record(request, tool, source, started, "allow", {
          success: false,
          durationMs: Date.now() - started,
          errorCode: mapped.error.code,
        }),
      );
      return mapped;
    }
  }

  private async dispatch(
    request: RuntimeInvokeRequest,
    tool: RuntimeTool,
    source: BrowserSource,
    options: { signal: AbortSignal; deadline: number },
  ): Promise<RuntimeInvokeResult> {
    if (options.signal.aborted) {
      throw new RuntimeError("CANCELLED", "invocation cancelled", "not_executed");
    }
    const latest = this.options.sources.get(source.adapterId, source.sourceId);
    if (!latest || latest.generation !== source.generation) {
      throw new RuntimeError(
        "TOOL_UNAVAILABLE",
        "generation changed before dispatch",
        "not_executed",
      );
    }
    const adapter = this.options.adapters.get(source.adapterId);
    if (!adapter) {
      throw new RuntimeError("INTERNAL_ERROR", `adapter not registered: ${source.adapterId}`);
    }

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options.signal.addEventListener("abort", onAbort, { once: true });
    const remaining = options.deadline - Date.now();
    if (remaining <= 0) {
      throw this.timeoutError(tool, false);
    }
    const timer = setTimeout(() => controller.abort(), remaining);
    let started = false;
    try {
      started = true;
      const raw = await adapter.invokeTool(
        {
          requestId: request.requestId,
          sourceId: source.sourceId,
          sourceGeneration: source.generation,
          originalName: tool.identity.originalName,
          input: request.input,
        },
        { signal: controller.signal, deadline: options.deadline },
      );
      this.assertSize(raw, this.options.limits.maxOutputBytes, "RESULT_TOO_LARGE", "output");
      if (raw.isError) {
        return {
          status: "error",
          error: { code: "WEBMCP_ERROR", message: stringifyContent(raw.content) },
          outcome: "executed_failed",
        };
      }
      return {
        status: "success",
        content: raw.content,
        structuredContent: raw.structuredContent,
        sourceGeneration: source.generation,
      };
    } catch (error) {
      if (controller.signal.aborted) {
        if (options.signal.aborted) {
          throw new RuntimeError(
            "CANCELLED",
            "invocation cancelled",
            this.safeOutcome(tool, started),
          );
        }
        throw this.timeoutError(tool, started);
      }
      if (error instanceof RuntimeError) throw error;
      throw new RuntimeError(
        "BROWSER_ERROR",
        error instanceof Error ? error.message : String(error),
        "executed_failed",
      );
    } finally {
      clearTimeout(timer);
      options.signal.removeEventListener("abort", onAbort);
    }
  }

  private resolveTool(request: RuntimeInvokeRequest): RuntimeTool | undefined {
    if ("runtimeId" in request.target) {
      return this.options.tools.get(request.target.runtimeId);
    }
    return this.options.tools.getByMcpName(request.target.mcpName);
  }

  private timeoutError(tool: RuntimeTool, started: boolean): RuntimeError {
    const outcome = this.safeOutcome(tool, started);
    return new RuntimeError(
      outcome === "unknown" ? "OUTCOME_UNKNOWN" : "INVOCATION_TIMEOUT",
      "invocation deadline exceeded",
      outcome,
    );
  }

  private safeOutcome(
    tool: RuntimeTool,
    started: boolean,
  ): "not_executed" | "executed_failed" | "unknown" {
    if (!started) return "not_executed";
    if (tool.annotations?.readOnlyHint && tool.annotations.idempotentHint) {
      return "executed_failed";
    }
    return "unknown";
  }

  private assertSize(
    value: unknown,
    maxBytes: number,
    code: "INVALID_INPUT" | "RESULT_TOO_LARGE",
    label: string,
  ): void {
    const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
    if (bytes > maxBytes) {
      throw new RuntimeError(code, `${label} exceeds ${maxBytes} bytes`);
    }
  }

  private async fail(
    request: RuntimeInvokeRequest,
    tool: RuntimeTool,
    source: BrowserSource,
    started: number,
    error: unknown,
    decision: "deny" | "confirm",
  ): Promise<RuntimeInvokeResult> {
    const mapped = this.asError(error);
    await this.safeAudit(
      this.record(request, tool, source, started, decision, {
        success: false,
        errorCode: mapped.error.code,
        durationMs: Date.now() - started,
      }),
    );
    return mapped;
  }

  private asError(error: unknown): Extract<RuntimeInvokeResult, { status: "error" }> {
    if (error instanceof RuntimeError) {
      return {
        status: "error",
        error: { code: error.code, message: error.message },
        outcome: error.outcome,
      };
    }
    return {
      status: "error",
      error: {
        code: "INTERNAL_ERROR",
        message: error instanceof Error ? error.message : String(error),
      },
      outcome: "not_executed",
    };
  }

  private record(
    request: RuntimeInvokeRequest,
    tool: RuntimeTool,
    source: BrowserSource,
    timestamp: number,
    decision: "allow" | "deny" | "confirm",
    extra: Partial<AuditRecord> = {},
  ): AuditRecord {
    return {
      requestId: request.requestId,
      timestamp,
      clientId: request.client.processInstanceId,
      runtimeToolId: tool.identity.runtimeId,
      mcpToolName: tool.identity.mcpName,
      sourceId: source.sourceId,
      origin: source.origin,
      decision,
      inputDigest: digestInput(request.input),
      ...extra,
    };
  }

  private async safeAudit(record: AuditRecord): Promise<void> {
    try {
      await this.options.audit.append(record);
    } catch {
      // Deny-path audit failure must not execute the tool; allow-path uses append directly.
    }
  }

  private notify(
    adapter: ReturnType<AdapterRegistry["get"]>,
    request: RuntimeInvokeRequest,
    tool: RuntimeTool,
    source: BrowserSource,
    action: "allow" | "deny" | "confirm",
    reason?: string,
    errorCode?: RuntimeError["code"],
  ): void {
    adapter?.notifyInvocationDecision?.({
      requestId: request.requestId,
      sourceId: source.sourceId,
      originalName: tool.identity.originalName,
      action,
      reason,
      errorCode,
      timestamp: Date.now(),
    });
  }
}

function errorResult(
  code: RuntimeError["code"],
  message: string,
  outcome: RuntimeError["outcome"],
): RuntimeInvokeResult {
  return { status: "error", error: { code, message }, outcome };
}

function digestInput(input: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(input) ?? "null")
    .digest("hex")
    .slice(0, 16);
}

function stringifyContent(content: unknown[]): string {
  try {
    return JSON.stringify(content);
  } catch {
    return "webmcp error";
  }
}

function describeInput(input: unknown): string {
  if (input === null) return "null";
  if (Array.isArray(input)) return `array(${input.length})`;
  if (input && typeof input === "object") {
    const keys = Object.keys(input as Record<string, unknown>).slice(0, 20);
    return keys.length > 0 ? `fields: ${keys.join(", ")}` : "empty object";
  }
  return typeof input;
}
