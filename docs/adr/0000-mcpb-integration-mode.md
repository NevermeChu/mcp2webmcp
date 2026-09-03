# ADR 0000 — MCP-B integration mode

- Status: Accepted
- Date: 2026-09-02
- Spike: [docs/spikes/0001-mcpb-integration.md](../spikes/0001-mcpb-integration.md)

## Context

WebMCP Gateway (**mcp2webmcp**) is a runtime/gateway so MCP clients that do not speak WebMCP can call page tools. The invoke path is WebMCP → Gateway → MCP. It is not a second WebMCP polyfill or a fork of MCP-B. Phase -1 required a real-chain proof that policy and audit can be inserted on a **stable public** boundary, and that v0.1 multi-stdio-client sharing of one browser relay is possible without copying MCP-B internals.

Three candidate modes were allowed:

1. In-process composition of MCP-B public API
2. Thin wrap of the public MCP / relay WebSocket protocol
3. Stop and revise the architecture if neither works

## Decision

**Mode 1: in-process public API composition of `RelayBridgeServer`.**

- Depend on `@mcp-b/webmcp-local-relay@5.1.0` (and later compatible releases) as a browser-transport backend.
- Construct `RelayBridgeServer` with explicit `host: "127.0.0.1"`, `allowedOrigins`, `invokeTimeoutMs`, and a spike/product-owned `persistPath`.
- Map `registry` / `list*FromRelay` / `stateChanged` / `invokeTool` into `BrowserAdapter`. Adapter-specific types stay in `packages/browser-adapter`.
- Own the MCP stdio server in `packages/mcp-transport`. Do **not** expose `LocalRelayMcpServer` to Claude/Cursor/Codex as the product server.
- Insert PolicyEngine and AuditLogger on the Core call path **before** `bridge.invokeTool`.
- Rely on MCP-B client-mode promotion so a second stdio Gateway joins an existing relay instead of binding a second browser cluster.

Mode 2 remains a documented fallback if a future MCP-B release removes `RelayBridgeServer` from the public export map. Mode 3 is not required for v0.1.

## Evidence

Verified 2026-09-02 in `spikes/0001-mcpb-integration` without deep imports:

- Package `exports` expose only `.` → `dist/index.mjs` / `dist/index.d.mts`.
- `RelayBridgeServer.invokeTool` can be wrapped; denied tools never reach the original method (`tests/policy-boundary.test.ts` and E2E `extra_ping`).
- Real chain: cooperative page + `@mcp-b/global` + embed → relay → stdio → `@modelcontextprotocol/client@2.0.0` → `echo:hello-spike`.
- Two stdio processes share the relay; the second client invoked `echo` successfully.
- `tools.listChanged: true` and the reference Client received `notifications/tools/list_changed`.

## Consequences

### Follow

- Product `McpBAdapter` may import only `@mcp-b/webmcp-local-relay` root exports.
- MCP-B naming (`echo_943b` tab suffixes, `_2` collision suffixes) is **not** the WebMCP Gateway namespace. Core still implements `NamespaceResolver` and `runtimeId`.
- MCP-B `sourceId` currently equals `connectionId` and changes on reconnect. Core still implements `generation` and must not treat relay source ids as stable workspace identity.
- Default MCP-B `allowedOrigins: ["*"]` is rejected for production config.
- v0.1 E2E remains cooperative embed; do not describe it as extension zero-integration.

### Avoid

- Deep imports such as `@mcp-b/webmcp-local-relay/dist/...` or copying `registry.ts` / `naming.ts` / `bridgeServer.ts`.
- Using `LocalRelayMcpServer` as the long-term MCP facade (it would register tools and invoke the browser before WebMCP Gateway policy unless the bridge instance is patched).
- Building a second WebSocket relay “because we need events”; listen to `stateChanged` and snapshot.
- Global `--auto-approve`.

## Alternatives considered

**Wrap only the stdio MCP protocol of a stock `webmcp-local-relay` CLI.**  
Would get discovery and invoke, but policy would sit outside in-process invoke and could not share a typed `RelayBridgeServer` snapshot. Rejected for v0.1 Core.

**Copy MCP-B registry/naming into this repo.**  
Forbidden by the architecture and unnecessary given public `RelayRegistry` / `invokeTool`.

## Related

- Architecture: [docs/architecture.md](../architecture.md)
- ADR-0003 (use MCP-B as compatibility layer) — confirmed
- ADR-0005 (per-client stdio Gateway, shared browser relay) — confirmed by client-mode promotion
- ADR-0006 (embed E2E is not extension acceptance) — confirmed
- ADR-0008 (ExtensionAdapter + MV3 loopback) — shipped as the parallel no-embed path
