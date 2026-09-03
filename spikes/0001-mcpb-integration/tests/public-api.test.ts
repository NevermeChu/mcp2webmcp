import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import * as relay from "@mcp-b/webmcp-local-relay";

describe("MCP-B local relay public API contract", () => {
  it("exports the documented in-process composition surface", () => {
    expect(relay.LocalRelayMcpServer).toBeTypeOf("function");
    expect(relay.RelayBridgeServer).toBeTypeOf("function");
    expect(relay.RelayRegistry).toBeTypeOf("function");
    expect(relay.sanitizeName).toBeTypeOf("function");
    expect(relay.buildPublicToolName).toBeTypeOf("function");
    expect(relay.extractSanitizedDomain).toBeTypeOf("function");
    expect(relay.parseCliOptions).toBeTypeOf("function");
    expect(relay.BrowserToRelayMessageSchema).toBeDefined();
    expect(relay.RelayClientToServerMessageSchema).toBeDefined();
  });

  it("does not require deep imports for bridge, registry, invoke, or protocol schemas", () => {
    const deepPaths = Object.keys(relay).filter((name) => name.includes("/"));
    expect(deepPaths).toEqual([]);
  });

  it("exposes RelayBridgeServer as an EventEmitter with invokeTool", () => {
    const bridge = new relay.RelayBridgeServer({
      host: "127.0.0.1",
      port: 19334,
      portExplicitlySet: true,
      allowedOrigins: ["http://127.0.0.1"],
    });
    expect(bridge).toBeInstanceOf(EventEmitter);
    expect(bridge.invokeTool).toBeTypeOf("function");
    expect(bridge.registry).toBeInstanceOf(relay.RelayRegistry);
    expect(typeof bridge.on).toBe("function");
  });

  it("keeps MCP-B public names registration-order-sensitive for collisions", () => {
    const a = relay.buildPublicToolName({
      originalToolName: "search",
      tabId: "18",
      disambiguate: true,
    });
    const b = relay.buildPublicToolName({
      originalToolName: "search",
      tabId: "19",
      disambiguate: true,
    });
    expect(a).not.toEqual(b);
    expect(a.length).toBeLessThanOrEqual(128);
    expect(relay.sanitizeName("search-documents!")).toMatch(/^[a-zA-Z0-9_]+$/);
  });
});
