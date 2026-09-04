# 架构

WebMCP Gateway（**mcp2webmcp**）从支持 WebMCP 的页面发现工具，经 stdio MCP 交给桌面客户端。策略、命名空间和审计在 Gateway Core；浏览器接入可替换。

## 两条接入

| 路径 | 配置 | 页面 | 本机端口 |
| --- | --- | --- | --- |
| cooperative embed | `adapter: mcpb`，`configs/demo.yaml` | `registerTool` + MCP-B embed | relay `127.0.0.1:9333` |
| 扩展 | `adapter: extension`，`configs/extension-demo.yaml` | 只 `registerTool` | loopback `127.0.0.1:9334` |

扩展**不是** MCP server。Cursor / Claude 只连 Gateway。页面 WebMCP runtime 由扩展 MAIN world 补一份可删除模块（[ADR 0009](adr/0009-extension-webmcp-runtime-polyfill.md)）；发现与 Gateway 协议仍在现有扩展代码里。

多个 MCP 客户端各自一个 stdio Gateway。embed 路径可共享 MCP-B relay；扩展路径当前一条 WebSocket 对应一个 Gateway。

调用链：

```text
页面 WebMCP
  → embed 或 MV3 扩展
  → BrowserAdapter（McpBAdapter / ExtensionAdapter）
  → Core（policy / audit / runtimeId）
  → stdio MCP（mcp2webmcp）
  → Cursor / Claude / Codex
```

投影到 MCP 的 `mcpName` 对同一 tab 上的同一页面工具保持稳定（不含页面 generation）。generation 只用于拒绝过期 invoke。详见 [PROBLEMS.md](PROBLEMS.md) 问题 3。

## 仓库

```text
apps/gateway                 stdio Gateway（CLI: mcp2webmcp）
apps/extension               Chrome/Edge MV3（发现 + 搬运；可删除的页面 runtime 见 ADR 0009）
packages/protocol            类型与 Zod schema
packages/core                注册表、命名空间、路由、策略、审计、运行日志
packages/browser-adapter     FakeBrowserAdapter / McpBAdapter / ExtensionAdapter
packages/mcp-transport       stdio MCP 与管理工具
packages/test-fixtures/      演示页
configs/                     yaml 与 MCP 客户端模板
```

调用链上每一跳都会写 JSONL（`hop`: `page` / `extension` / `gateway` / `mcp`）。默认路径 `~/.mcp2webmcp/logs/<runtime.name>.jsonl`。审计 JSONL 仍只记 invoke。

`allowedOrigins` 对 **mcpb** 仍须显式列出。**extension** 在 `consent.enabled` 时可以留空，表示扩展发现的 origin 都会进同意账本。禁止 `*`。默认策略是否认；发现后的工具靠同意账本自动放行，yaml 规则可覆盖（deny / confirm）。`destructiveHint` 仍升为 confirm，无审批通道时 fail-closed。

详细接线见 [connect-mcp-client.md](connect-mcp-client.md)。决策记录在 [adr/](adr/)。
