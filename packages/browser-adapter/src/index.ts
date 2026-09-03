export type { BrowserAdapter } from "@mcp2webmcp/protocol";
export { discoveredTool, FakeBrowserAdapter } from "./fake-browser-adapter.js";
export type { FakeToolHandler } from "./fake-browser-adapter.js";
export { McpBAdapter } from "./mcpb-adapter.js";
export type { McpBAdapterOptions } from "./mcpb-adapter.js";
/** Test doubles. Not used by the Gateway process. */
export { FakeRelayBridge, demoRelaySource, demoRelayTool } from "./fake-relay-bridge.js";
export type { McpbRelayBridge, McpbRelaySnapshot, McpbRelaySnapshotSource, McpbRelaySnapshotTool } from "./mcpb-bridge.js";
export { assertExplicitOrigins, assertLoopbackHost } from "./mcpb-safety.js";
