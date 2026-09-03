# Documentation

WebMCP Gateway（**mcp2webmcp**）：让暂未支持 WebMCP 的 MCP 客户端调用页面工具。调用路径是 WebMCP → Gateway → MCP。

| Document | Purpose |
| --- | --- |
| [architecture.md](architecture.md) | Design spec (identity, namespace, policy, audit, adapters, phases) |
| [connect-mcp-client.md](connect-mcp-client.md) | Wire Cursor / Claude Desktop to the stdio Gateway |
| [extension-loopback-protocol.md](extension-loopback-protocol.md) | MV3 extension ↔ ExtensionAdapter JSON protocol |
| [adr/0000-mcpb-integration-mode.md](adr/0000-mcpb-integration-mode.md) | Why v0.1 wraps MCP-B `RelayBridgeServer` |
| [spikes/0001-mcpb-integration.md](spikes/0001-mcpb-integration.md) | Phase -1 real-chain gate notes |

The disposable spike source lives in `spikes/0001-mcpb-integration`. It is evidence, not the product Core.
