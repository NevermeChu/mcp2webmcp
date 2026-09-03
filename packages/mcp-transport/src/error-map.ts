import type { RuntimeErrorCode, RuntimeInvokeResult } from "@mcp2webmcp/protocol";

export const MCP_JSONRPC_INTERNAL_ERROR = -32603;
export const MCP_JSONRPC_INVALID_PARAMS = -32602;

export interface MappedToolResult {
  content: Array<{ type: "text"; text: string } | Record<string, unknown>>;
  structuredContent?: unknown;
  isError?: boolean;
}

export interface MappedProtocolError {
  jsonRpcCode: number;
  code: RuntimeErrorCode;
  message: string;
}

/**
 * Central mapping from Core invoke results to MCP CallToolResult.
 * Tool-layer failures use isError so clients can surface POLICY_DENIED etc.
 * Only INTERNAL_ERROR outside a resolved tool call should become a JSON-RPC error.
 */
export function mapInvokeResult(result: RuntimeInvokeResult): MappedToolResult {
  if (result.status === "success") {
    return {
      content: normalizeContent(result.content),
      structuredContent: result.structuredContent,
    };
  }
  if (result.status === "confirmation_required") {
    return {
      content: [
        {
          type: "text",
          text: `CONFIRMATION_UNAVAILABLE: ${result.summary}`,
        },
      ],
      isError: true,
    };
  }
  return {
    content: [
      {
        type: "text",
        text: `${result.error.code}: ${result.error.message}`,
      },
    ],
    isError: true,
  };
}

export function mapErrorCodeToJsonRpc(code: RuntimeErrorCode): MappedProtocolError {
  const jsonRpcCode =
    code === "INVALID_INPUT" || code === "TOOL_NOT_FOUND" || code === "SCHEMA_TOO_LARGE"
      ? MCP_JSONRPC_INVALID_PARAMS
      : MCP_JSONRPC_INTERNAL_ERROR;
  return { jsonRpcCode, code, message: code };
}

function normalizeContent(content: unknown[]): MappedToolResult["content"] {
  if (!Array.isArray(content) || content.length === 0) {
    return [{ type: "text" as const, text: "" }];
  }
  return content.map((part) => {
    if (part && typeof part === "object" && "type" in part) {
      return part as Record<string, unknown>;
    }
    return { type: "text" as const, text: JSON.stringify(part) };
  });
}

export const MANAGEMENT_TOOL_NAMES = [
  "webmcp_list_sources",
  "webmcp_list_tools",
  "webmcp_get_tool",
  "webmcp_runtime_status",
  "webmcp_call_tool",
  "webmcp_list_consent",
  "webmcp_revoke_consent",
  "webmcp_restore_consent",
] as const;

export type ManagementToolName = (typeof MANAGEMENT_TOOL_NAMES)[number];
