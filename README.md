# WebMCP Gateway

**mcp2webmcp** — 给暂未支持 [WebMCP](https://github.com/webmachinelearning/webmcp) 的 MCP 客户端（Cursor、Claude、Codex）接上页面工具。这是桥 / runtime，**不是**第二个 WebMCP polyfill，也**不是** MCP-B 的 fork。

产品意图是「让 MCP 客户端用上 WebMCP」；调用路径是 **WebMCP → Gateway → MCP**。

| 用法 | 名称 |
| --- | --- |
| 对外标题 | **WebMCP Gateway** |
| 仓库 / 包 / CLI / 配置 | **mcp2webmcp**（`@mcp2webmcp/*`、命令 `mcp2webmcp`） |

**v0.1** 仅 **cooperative embed**：页面必须加载 MCP-B 本机 relay embed。Chrome Extension / 零接入尚未实现。

设计规格：[docs/architecture.md](docs/architecture.md)。

## 10 分钟 Demo

需要 Node.js 22+ 与 [pnpm](https://pnpm.io/) 11。在仓库根目录：

```powershell
pnpm install
pnpm build
```

**终端 A — 演示页**（origin / relay 必须与 `configs/demo.yaml` 一致）：

```powershell
$env:MCP2WEBMCP_E2E_RELAY_PORT = "9333"
$env:MCP2WEBMCP_E2E_FIXTURE_PORT = "18080"
pnpm --filter @mcp2webmcp/webmcp-demo-fixture start
```

浏览器打开 [http://127.0.0.1:18080](http://127.0.0.1:18080)，状态为 `ready`。

**接到 Cursor / Claude：** 复制 `configs/mcp-client.example.json`，把 `REPO_ROOT` 换成本仓库绝对路径，写入 MCP 配置。步骤见 [docs/connect-mcp-client.md](docs/connect-mcp-client.md)。

Gateway 进程开发时用 `node apps/gateway/dist/main.js`；安装后的 CLI 是 **`mcp2webmcp`**。

不要把带本机绝对路径的 `.cursor/mcp.json` 提交进 Git。模板只保留 `configs/mcp-client.example.json`。

配好后让客户端列出 tools，并对 echo 传入 `{ "message": "hello" }`。成功返回 `echo:hello`。

页面工具名经过 Gateway 命名空间，MCP 上不会是裸的 `echo`。`webmcp_list_tools` 可用来对照 `originalName` 与 `mcpName`。Cursor 里 MCP 服务名仍是配置键 `mcp2webmcp-demo`。

## 这套 Demo 证明了什么

```text
协作页 registerTool
  → MCP-B embed（本机 WebSocket）
  → McpBAdapter / Core（策略、审计、runtimeId）
  → stdio MCP（mcp2webmcp）
  → Cursor / Claude / 参考 Client
```

默认策略是否认。`configs/demo.yaml` 只允许 `echo`、`get_page_title`、`add`。

## 仓库结构

```text
apps/gateway                 YAML + stdio Gateway（CLI: mcp2webmcp）
packages/protocol            类型与 Zod schema
packages/core                注册表、命名空间、路由、策略、审计
packages/browser-adapter     FakeBrowserAdapter + McpBAdapter（只包 MCP-B 公开 API）
packages/mcp-transport       stdio MCP、ToolProjector、管理工具
packages/test-fixtures/...   cooperative embed 演示页
configs/                     demo / example YAML 与 MCP 客户端模板
docs/                        规格、接线、ADR、spike 记录
spikes/0001-mcpb-integration Phase -1 一次性验证（不是产品 Core）
tests/                       集成测试；真实浏览器 E2E 在 tests/e2e/
```

## 开发

```powershell
pnpm test          # 单测 + 集成（不含浏览器）
pnpm test:e2e      # 真实浏览器 cooperative embed；Windows 优先 Edge
pnpm lint
```

`pnpm test` 里的 stdio 集成测试会 spawn `packages/mcp-transport/dist/fake-stdio-main.js`，请先 `pnpm build`。没有 Edge 时：

```powershell
pnpm exec playwright install chromium
pnpm test:e2e
```

不经过浏览器、只测 stdio 的假适配器：

```powershell
$env:MCP2WEBMCP_FAKE_ECHO = "1"
node apps/gateway/dist/main.js
```

文档索引：[docs/README.md](docs/README.md)。

## 配置

| 文件 | 用途 |
| --- | --- |
| `configs/demo.yaml` | loopback demo（配合 fixture `:18080`） |
| `configs/example.yaml` | KnowMesh 风格骨架，需改成真实 origin / 工具 |
| `configs/mcp-client.example.json` | Cursor / Claude `mcpServers` 模板 |

环境变量仍用品牌前缀：`MCP2WEBMCP_CONFIG`、`MCP2WEBMCP_ALLOWED_ORIGINS`、`MCP2WEBMCP_LOG_LEVEL`（只打 stderr）。

## 阶段状态

| Phase | Status |
| --- | --- |
| -1 External spike | Done — `docs/spikes/0001-mcpb-integration.md` |
| 0–8 Gateway + cooperative E2E | Done |
| ExtensionAdapter | 未开始 |

## 明确不做（v0.1）

- Chrome Extension / 零接入发现
- HTTP MCP
- 确认 UI（`confirm` 在无通道时 fail-closed）
- 把 `allowedOrigins` 设为 `*`

## License

[MIT](LICENSE)
