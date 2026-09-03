import { LocalRelayMcpServer, RelayBridgeServer } from "@mcp-b/webmcp-local-relay";
import fs from "node:fs";

const port = Number(process.env.MCP2WEBMCP_SPIKE_RELAY_PORT ?? "19333");
const persistPath = process.env.MCP2WEBMCP_SPIKE_PERSIST;
const origins = (process.env.MCP2WEBMCP_SPIKE_ORIGINS ?? "http://127.0.0.1")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const denyTools = new Set(
  (process.env.MCP2WEBMCP_SPIKE_DENY_TOOLS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const auditPath = process.env.MCP2WEBMCP_SPIKE_AUDIT;

function writeAudit(record) {
  if (!auditPath) return;
  fs.appendFileSync(auditPath, `${JSON.stringify(record)}\n`);
}

const bridge = new RelayBridgeServer({
  host: "127.0.0.1",
  port,
  portExplicitlySet: true,
  allowedOrigins: origins,
  persistPath,
  invokeTimeoutMs: 65_000,
  maxPayloadBytes: 1_000_000,
  label: "mcp2webmcp-spike-0001",
  relayId: process.env.MCP2WEBMCP_SPIKE_RELAY_ID ?? "spike-0001",
});

const originalInvoke = bridge.invokeTool.bind(bridge);
bridge.invokeTool = async (toolName, args, options) => {
  const started = Date.now();
  if (denyTools.has(toolName)) {
    writeAudit({
      toolName,
      decision: "deny",
      timestamp: started,
      success: false,
      errorCode: "POLICY_DENIED",
    });
    return {
      content: [{ type: "text", text: `POLICY_DENIED:${toolName}` }],
      isError: true,
    };
  }
  try {
    const result = await originalInvoke(toolName, args, options);
    writeAudit({
      toolName,
      decision: "allow",
      timestamp: started,
      durationMs: Date.now() - started,
      success: result?.isError !== true,
    });
    return result;
  } catch (error) {
    writeAudit({
      toolName,
      decision: "allow",
      timestamp: started,
      durationMs: Date.now() - started,
      success: false,
      errorCode: "INVOCATION_FAILED",
    });
    throw error;
  }
};

const server = new LocalRelayMcpServer({
  serverName: "mcp2webmcp-spike-0001",
  serverVersion: "0.0.0",
  bridge,
});

await server.start();
await server.startStdio();

const shutdown = async () => {
  await server.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
