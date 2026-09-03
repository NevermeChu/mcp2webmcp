# 架构

WebMCP Gateway（**mcp2webmcp**）从支持 WebMCP 的页面发现工具，经 stdio MCP 交给桌面客户端。策略、命名空间和审计在 Gateway Core；浏览器接入可替换。

## 两条接入

| 路径 | 配置 | 页面 | 本机端口 |
| --- | --- | --- | --- |
| cooperative embed | `adapter: mcpb`，`configs/demo.yaml` | `registerTool` + MCP-B embed | relay `127.0.0.1:9333` |
| 扩展 | `adapter: extension`，`configs/extension-demo.yaml` | 只 `registerTool` | loopback `127.0.0.1:9334` |

扩展**不是** MCP server。Cursor / Claude 只连 Gateway。缺页面 WebMCP runtime 时扩展失败，不偷偷做 polyfill。

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

## 仓库

```text
apps/gateway                 stdio Gateway（CLI: mcp2webmcp）
apps/extension               Chrome/Edge MV3（发现 + 搬运）
packages/protocol            类型与 Zod schema
packages/core                注册表、命名空间、路由、策略、审计
packages/browser-adapter     FakeBrowserAdapter / McpBAdapter / ExtensionAdapter
packages/mcp-transport       stdio MCP 与管理工具
packages/test-fixtures/      演示页
configs/                     yaml 与 MCP 客户端模板
```

`allowedOrigins` 必须显式列出，禁止 `*`。默认策略是否认。`confirm` 在无审批通道时 fail-closed。

详细接线见 [connect-mcp-client.md](connect-mcp-client.md)。决策记录在 [adr/](adr/)。
