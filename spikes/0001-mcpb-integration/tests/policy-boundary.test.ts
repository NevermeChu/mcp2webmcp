import { describe, expect, it } from "vitest";
import { RelayBridgeServer } from "@mcp-b/webmcp-local-relay";

describe("policy and audit insertion boundary", () => {
  it("can fail closed on the public invokeTool method without deep imports", async () => {
    const bridge = new RelayBridgeServer({
      host: "127.0.0.1",
      port: 19335,
      portExplicitlySet: true,
      allowedOrigins: ["http://127.0.0.1"],
    });

    let forwarded = false;
    const original = bridge.invokeTool.bind(bridge);
    bridge.invokeTool = async (toolName, args, options) => {
      if (toolName === "delete_all") {
        return {
          content: [{ type: "text", text: "POLICY_DENIED:delete_all" }],
          isError: true,
        };
      }
      forwarded = true;
      return original(toolName, args, options);
    };

    const denied = await bridge.invokeTool("delete_all", {});
    expect(denied.isError).toBe(true);
    expect(denied.content[0]).toMatchObject({ text: "POLICY_DENIED:delete_all" });
    expect(forwarded).toBe(false);
  });
});
