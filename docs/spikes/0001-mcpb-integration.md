# Spike 0001 — MCP-B / WebMCP / MCP SDK real-chain Gate

Captured: 2026-09-02  
Machine: Windows 10.0.26200 x64, Node.js v24.18.1  
Spike directory: `spikes/0001-mcpb-integration`  
Architecture source: [docs/architecture.md](../architecture.md) §27 Phase -1 / §33

## Gate conclusion

**GO — in-process public API composition.**

`@mcp-b/webmcp-local-relay@5.1.0` exports `RelayBridgeServer`, `RelayRegistry`, `LocalRelayMcpServer`, protocol Zod schemas, and `invokeTool` without any deep import. Policy and audit can wrap `RelayBridgeServer.invokeTool` before a browser call is dispatched. Two independent stdio MCP clients share one browser relay via documented server/client promotion.

Do **not** use `LocalRelayMcpServer` as the product MCP surface. It registers dynamic tools and invokes the bridge directly, so WebMCP Gateway naming, generation, and policy would be bypassed unless the instance method is monkey-patched. Product Core should own stdio MCP and call `invokeTool` only after ToolRouter.

## How to repeat

```bash
cd spikes/0001-mcpb-integration
npm install
npx playwright install chromium   # optional; E2E uses Edge channel msedge on this machine
npm test
```

This is a disposable spike. It is not the product monorepo.

## Task results

### 1. Dependency / public interface snapshot

| Component | Version / note |
| --- | --- |
| `@mcp-b/webmcp-local-relay` | **5.1.0** (public `exports["."]` only) |
| `@mcp-b/global` | **5.1.0** (page WebMCP runtime / polyfill) |
| `@mcp-b/webmcp-polyfill` | 5.1.0 (relay peer/dev; not loaded by the fixture) |
| `@modelcontextprotocol/server` | **2.0.0** (2026-07-28 spec; used by the relay) |
| `@modelcontextprotocol/client` | **2.0.0** (reference Client) |
| `@modelcontextprotocol/core` | **2.0.0** |
| Node.js | v24.18.1 (relay requires >=22) |
| Host browser | Microsoft Edge **152.0.4191.53** via Playwright `channel: "msedge"` (test harness only) |
| Google Chrome | not installed at the default path |
| Native WebMCP | not used; fixture loads `@mcp-b/global` then `document.modelContext.registerTool` |
| WebMCP spec | W3C WebML CG draft: `document.modelContext`, `registerTool`, `getTools`, `toolchange` |

Public relay exports used by the spike (complete list in `versions.snapshot.json`):

- Classes: `LocalRelayMcpServer`, `RelayBridgeServer` (extends `EventEmitter`), `RelayRegistry`
- Invoke / identity: `invokeTool`, `listSources` / `listTools` on the registry, `listSourcesFromRelay` / `listToolsFromRelay` in client mode
- Events: `stateChanged` (untyped `EventEmitter` event; confirmed in shipped `dist`)
- Protocol: `BrowserToRelayMessageSchema`, `RelayClientToServerMessageSchema`, `ServerHelloMessageSchema`, …
- Naming helpers: `sanitizeName`, `buildPublicToolName`, `extractSanitizedDomain`

### 2. Cooperative page fixture

`fixture/index.html`:

- Loads local `/vendor/global.iife.js` (`@mcp-b/global`)
- Registers `echo` on `document.modelContext`
- Loads local `/vendor/embed.js` + sibling `widget.html` (`@mcp-b/webmcp-local-relay`)
- Supports add/remove `extra_ping` via `AbortSignal` (WebMCP has no `unregisterTool`)

This proves **cooperative embed** access, not extension zero-integration.

### 3. Real call chain (CI contract test)

```text
Playwright Edge tab
  -> @mcp-b/global document.modelContext
  -> MCP-B embed.js / widget.html
  -> RelayBridgeServer WebSocket 127.0.0.1:<ephemeral>
  -> LocalRelayMcpServer stdio
  -> @modelcontextprotocol/client StdioClientTransport
  -> callTool(echo) => "echo:hello-spike"
```

Test: `tests/real-chain.test.ts` — **passed** (2026-09-02, ~8s).

### 4. Dynamic add/remove, reload, tab close, Client refresh

Observed against `@modelcontextprotocol/client@2.0.0`:

| Check | Result |
| --- | --- |
| Server advertises `tools.listChanged` | **true** |
| Client `notifications/tools/list_changed` | **12** notifications during the scenario |
| Add `extra_ping` then list | tool appears |
| Remove `extra_ping` then list | tool disappears |
| Reload tab | `echo` recovers |
| Close both tabs | echo tools disappear from `tools/list` |

Fallback `webmcp_list_tools` / `webmcp_list_sources` remain available. Product still must keep those management tools for clients that do not refresh.

### 5. Two stdio clients, shared browser connection

Two `stdio-relay.mjs` processes used the same explicit port, `relayId`, and `persistPath`.

- First process bound the WebSocket server.
- Second process joined in MCP-B **client mode** and proxied through the first.
- Second client called `echo` successfully (`echo:from-client-2`).

This matches v0.1 topology: shared browser relay, isolated stdio processes. Each process still has its own MCP session, policy wrap, and audit file handle.

### 6. Policy / audit insertion boundary

Stable public insertion point:

```text
RelayBridgeServer.invokeTool(toolName, args, options?)
```

Spike wrap (in `src/stdio-relay.mjs`): deny `extra_ping` and append JSONL **before** the original method. The E2E call returned `isError` with `POLICY_DENIED` and wrote audit records (3 lines: allow echo, deny extra_ping, allow second-client echo).

`RelayBridgeServer` does **not** expose a typed `subscribe()` matching WebMCP Gateway `BrowserAdapter`. Core must listen to `stateChanged` and then snapshot `registry.listSources()` / `listTools()` (server mode) or `listSourcesFromRelay()` / `listToolsFromRelay()` (client mode). That is enough for Path 1; polling is a valid reconcile strategy.

## Capability matrix

| Capability | MCP-B 5.1.0 | WebMCP Gateway must still own |
| --- | --- | --- |
| Browser WebMCP discovery (cooperative embed) | yes | adapter mapping only |
| Dynamic tool sync + `listChanged` | yes | projection + budget |
| Multi-tab aggregation | yes | stable source identity |
| stdio MCP | yes (`LocalRelayMcpServer`) | **own** MCP server (policy, names, management tools) |
| Tool name conflict suffix (`echo_943b`) | yes, tab-id / `_2` style | deterministic hash namespace (`adapterId/sourceId/generation/name`) |
| localhost bind | default `127.0.0.1` | keep; never default `0.0.0.0` |
| Origin restriction | `--widget-origin` / `allowedOrigins` (default `*`) | production must set explicit origins; never `*` |
| Multi-client relay share / promotion | yes | per-process Core/policy/audit |
| Invoke timeout / max payload | 65s / 10MB defaults | remaining-budget mapping, smaller product limits |
| Stable sourceId across reconnect | **no** (`sourceId` == `connectionId`) | SourceRegistry + generation |
| Policy / confirmation / audit | **no** | PolicyEngine, fail-closed confirm, JSONL audit |
| `runtimeId` as internal PK | **no** | ToolRegistry |
| Event revision / generation | **no** | Core reconciliation |

## Security observations

1. Relay default `allowedOrigins: ["*"]` is unsafe for production. Spike and product config must pass explicit fixture/app origins.
2. `--widget-origin` checks the WebSocket Origin (blob iframe inherits the host page). Origin-less clients fall back to claimed `hello.origin`. Keep loopback bind.
3. Loopback is not local-process authentication. MCP `initialize` client name is informational only.
4. Page annotations (`readOnlyHint` on `echo`) must never be an allow rule. Spike deny of `extra_ping` is name-based wrap only; product allow requires origin + exact original name + local policy.
5. Do not log raw tool input; spike audit records name/decision/timing only.
6. Chrome Local Network Access may prompt for public sites; localhost fixtures did not block this run.

## Compatibility observations

1. Reference Client 2.0 **does** honor `notifications/tools/list_changed` (12 events in one scenario). Handler API is `setNotificationHandler("notifications/tools/list_changed", handler)`, not a Zod schema as the first argument.
2. When two origins both register `echo`, MCP-B public names became `echo_943b` and `echo_c769` (short tab suffix). These are not stable across reload and are not WebMCP Gateway `mcpName`.
3. Client mode of a second Gateway can invoke tools, but MCP-B documents weaker source metadata on relayed dynamic tool descriptions. Product `McpBAdapter` must snapshot sources in both modes.
4. Playwright is **only** the spike/E2E harness. It is not `PlaywrightAdapter`.

## What this spike did not do (by design)

- Product monorepo / Core registries
- Chrome Extension
- Playwright or CDP as a BrowserAdapter
- HTTP MCP
- AgentMesh / Web UI
- Deep import or copy of MCP-B `src/`
- Claiming extension-based zero-integration acceptance

## Next round (only after this GO)

Phase 0–5: pnpm workspace, `packages/protocol`, registries, `NamespaceResolver`, `FakeBrowserAdapter`, `ToolRouter` + Policy + Audit unit tests. Phase 7 `McpBAdapter` must wrap `RelayBridgeServer` only.
