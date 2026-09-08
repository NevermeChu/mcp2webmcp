import { randomUUID } from "node:crypto";
import type { Runtime } from "@mcp2webmcp/core";
import type { RuntimeConfig } from "@mcp2webmcp/protocol";
import { DEFAULT_INVOCATION_DEADLINE_MS } from "@mcp2webmcp/protocol";
import { mapInvokeResult } from "./error-map.js";

export function jsonText(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function createManagementHandlers(
  runtime: Runtime,
  config: RuntimeConfig,
  processInstanceId: string,
) {
  return {
    async listSources() {
      return jsonText(
        runtime.sources.list().map((source) => ({
          adapterId: source.adapterId,
          sourceId: source.sourceId,
          generation: source.generation,
          origin: source.origin,
          url: source.url,
          title: source.title,
          tabId: source.tabId,
          state: source.state,
        })),
      );
    },

    async listTools() {
      return jsonText(
        runtime.tools.list().map((tool) => {
          const source = runtime.sources.get(tool.identity.adapterId, tool.identity.sourceId);
          return {
            runtimeId: tool.identity.runtimeId,
            mcpName: tool.identity.mcpName,
            originalName: tool.identity.originalName,
            origin: source?.origin,
            sourceGeneration: tool.identity.sourceGeneration,
            consented:
              !runtime.consent.enabled ||
              Boolean(source && runtime.consent.allows(source.origin, tool.identity.originalName)),
          };
        }),
      );
    },

    async getTool(input: { mcpName?: string; runtimeId?: string }) {
      const tool = input.runtimeId
        ? runtime.tools.get(input.runtimeId)
        : input.mcpName
          ? runtime.tools.getByMcpName(input.mcpName)
          : undefined;
      if (!tool) {
        return {
          content: [{ type: "text", text: "TOOL_NOT_FOUND: tool not found" }],
          isError: true,
        };
      }
      const source = runtime.sources.get(tool.identity.adapterId, tool.identity.sourceId);
      return jsonText({ tool, source });
    },

    async runtimeStatus(extra?: Record<string, unknown>) {
      return jsonText({
        name: config.runtime.name,
        processInstanceId,
        sources: runtime.sources.list().length,
        tools: runtime.tools.list().length,
        adapters: runtime.adapters.list().map((adapter) => adapter.adapterId),
        eventRevision: runtime.events.currentRevision(),
        logPath: config.runtime.logPath ?? "",
        ...extra,
      });
    },

    async callTool(input: { mcpName?: string; runtimeId?: string; arguments?: unknown }) {
      const target = input.runtimeId
        ? { runtimeId: input.runtimeId }
        : input.mcpName
          ? { mcpName: input.mcpName }
          : undefined;
      if (!target) {
        return {
          content: [{ type: "text", text: "INVALID_INPUT: mcpName or runtimeId is required" }],
          isError: true,
        };
      }
      const result = await runtime.router.invoke(
        {
          requestId: randomUUID(),
          target,
          input: input.arguments ?? {},
          client: { processInstanceId },
        },
        {
          signal: new AbortController().signal,
          deadline:
            Date.now() + (config.runtime.invocationDeadlineMs ?? DEFAULT_INVOCATION_DEADLINE_MS),
        },
      );
      return mapInvokeResult(result);
    },

    async recentLogs(input: { limit?: number } = {}) {
      const limit =
        typeof input.limit === "number" && Number.isFinite(input.limit) ? input.limit : 80;
      return jsonText({
        path: runtime.log.path,
        records: runtime.log.recent(limit),
      });
    },

    async listConsent() {
      return jsonText({
        enabled: runtime.consent.enabled,
        autoAdmit: runtime.consent.autoAdmit,
        origins: runtime.consent.list(),
      });
    },

    async revokeConsent(input: { origin?: string; tool?: string }) {
      if (!runtime.consent.enabled) {
        return {
          content: [{ type: "text", text: "INVALID_INPUT: consent is disabled" }],
          isError: true,
        };
      }
      if (!input.origin) {
        return {
          content: [{ type: "text", text: "INVALID_INPUT: origin is required" }],
          isError: true,
        };
      }
      const changed = runtime.consent.revoke(input.origin, input.tool);
      if (changed) runtime.events.publish({ type: "consent.updated" });
      return jsonText({
        changed,
        origins: runtime.consent.list(),
      });
    },
  };
}
