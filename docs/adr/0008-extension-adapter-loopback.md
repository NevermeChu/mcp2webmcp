# ADR 0008 — ExtensionAdapter loopback（无 embed）

- Status: Accepted
- Date: 2026-09-03
- Protocol: [docs/extension-loopback-protocol.md](../extension-loopback-protocol.md)

## Context

ADR-0006 把 cooperative embed 定为 MCP-B 真实链路，并把「网站只 `registerTool`」留给扩展。产品不能把 embed E2E 说成 extension 验收，也不能让扩展自己当 MCP server（那会绕过 Core 的策略与审计）。

## Decision

落地 **ExtensionAdapter + 未打包 MV3 扩展**：

- 页面只注册 WebMCP 工具；**不必**加载 MCP-B embed。
- 扩展只做发现与搬运：读 `tab.url` origin、把工具描述送到 Gateway、把 invoke 打回页面。
- Gateway 监听 **loopback JSON WebSocket**（默认 `127.0.0.1:9334`），协议名 `mcp2webmcp-extension`，**不是** MCP，也**不是** MCP-B relay 协议。
- Cursor / Claude 只连 stdio Gateway（`configs/extension-demo.yaml`）。扩展不要写进 `mcpServers`。
- `allowedOrigins` 对 mcpb 必须显式列出；extension 在 consent 开启时可为空（发现即写入同意账本）。禁止 `*`。不在可选 yaml 名单里的 origin 仍不投影。
- 页面工具发现后自动写入本地同意账本；用户可用 `webmcp_revoke_consent` / `webmcp_restore_consent` 撤销或恢复。yaml 精确 allow 不再是 extension 的必填项。
- 页面 WebMCP runtime 由扩展 MAIN world 补一份可删除模块，见 [ADR 0009](0009-extension-webmcp-runtime-polyfill.md)。
- v0.1：一条扩展连接对应一个 Gateway；后连 socket 取代前一个。多 Gateway 共享浏览器连接留到下一步。

## Consequences

- 与 `adapter: mcpb` 并行：demo 用 `9333`，extension 用 `9334`。同一份 `.cursor/mcp.json` 里两条配置不要都指向 extension yaml。
- Core 仍不 import `chrome.*`；策略 / 审计 / namespace 不进扩展。
- Playwright 只作 `pnpm test:e2e:extension` 的测试驱动，不是产品 adapter。

## Related

- [architecture.md](../architecture.md)
- [docs/connect-mcp-client.md](../connect-mcp-client.md)
- [0009-extension-webmcp-runtime-polyfill.md](0009-extension-webmcp-runtime-polyfill.md)
- ADR-0006（embed 与 extension 验收不可互换）
