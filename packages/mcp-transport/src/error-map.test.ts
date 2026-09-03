import { describe, expect, it } from "vitest";
import type { RuntimeInvokeResult } from "@mcp2webmcp/protocol";
import { mapErrorCodeToJsonRpc, mapInvokeResult, MCP_JSONRPC_INVALID_PARAMS } from "./error-map.js";

describe("MCP error mapping", () => {
  it("passes success content through", () => {
    const mapped = mapInvokeResult({
      status: "success",
      content: [{ type: "text", text: "ok" }],
      sourceGeneration: 1,
    });
    expect(mapped.isError).toBeUndefined();
    expect(mapped.content).toEqual([{ type: "text", text: "ok" }]);
  });

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

  it("maps confirmation_required to isError rather than a resume protocol", () => {
    const mapped = mapInvokeResult({
      status: "confirmation_required",
      confirmationId: "c1",
      summary: "needs approval",
    });
    expect(mapped.isError).toBe(true);
    expect((mapped.content[0] as { text: string }).text).toContain("CONFIRMATION_UNAVAILABLE");
  });

  it("maps INVALID_INPUT to JSON-RPC InvalidParams when used as a protocol error", () => {
    expect(mapErrorCodeToJsonRpc("INVALID_INPUT").jsonRpcCode).toBe(MCP_JSONRPC_INVALID_PARAMS);
  });
});
