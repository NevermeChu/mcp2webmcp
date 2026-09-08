import { describe, expect, it } from "vitest";
import type { RuntimeInvokeResult } from "@mcp2webmcp/protocol";
import { mapErrorCodeToJsonRpc, mapInvokeResult, MCP_JSONRPC_INVALID_PARAMS } from "./error-map.js";

describe("MCP error mapping", () => {
  it("maps policy deny to CallToolResult isError", () => {
    const result: RuntimeInvokeResult = {
      status: "error",
      error: { code: "POLICY_DENIED", message: "default deny" },
      outcome: "not_executed",
    };
    const mapped = mapInvokeResult(result);
    expect(mapped.isError).toBe(true);
    expect(mapped.content[0]).toMatchObject({ text: "POLICY_DENIED: default deny" });
  });

  it("maps INVALID_INPUT to JSON-RPC InvalidParams when used as a protocol error", () => {
    expect(mapErrorCodeToJsonRpc("INVALID_INPUT").jsonRpcCode).toBe(MCP_JSONRPC_INVALID_PARAMS);
  });
});
