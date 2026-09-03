# WebMCP Gateway

**mcp2webmcp** 让暂未支持 [WebMCP](https://github.com/webmachinelearning/webmcp) 的 MCP 客户端（Cursor、Claude、Codex）调用页面工具。

这是桥 / runtime，**不是**第二个 WebMCP polyfill，也**不是** MCP-B 的 fork。调用路径：**WebMCP → Gateway → MCP**。

需要 Node.js 22+ 与 [pnpm](https://pnpm.io/) 11。

```powershell
pnpm install
pnpm build
```

Gateway 开发入口：`node apps/gateway/dist/main.js`。安装后的 CLI 是 **`mcp2webmcp`**。v0.1 只提供 **stdio MCP**。

不要把带本机绝对路径的 `.cursor/mcp.json` 提交进 Git。

## 协作页（embed）

页面除了 `registerTool` 还要加载 MCP-B embed。origin / relay 必须与 `configs/demo.yaml` 一致（`http://127.0.0.1:18080`，relay `9333`）。

```powershell
$env:MCP2WEBMCP_E2E_RELAY_PORT = "9333"
$env:MCP2WEBMCP_E2E_FIXTURE_PORT = "18080"
pnpm --filter @mcp2webmcp/webmcp-demo-fixture start
```

打开 [http://127.0.0.1:18080](http://127.0.0.1:18080)。复制 `configs/mcp-client.example.json`，把 `REPO_ROOT` 换成仓库绝对路径，写入 Cursor / Claude 的 MCP 配置。服务名是 `mcp2webmcp-demo`。

列出 tools，对 echo 传入 `{ "message": "hello" }`，应返回 `echo:hello`。MCP 上的名字带命名空间，不是裸的 `echo`；可用 `webmcp_list_tools` 对照。

## 浏览器扩展（无 embed）

页面只 `registerTool`。Chrome 尚未提供 `document.modelContext` 时，由扩展 MAIN world 补一份可删除的页面 runtime（[ADR 0009](docs/adr/0009-extension-webmcp-runtime-polyfill.md)）。扩展只做发现与搬运，**不是** MCP server；客户端只连 stdio Gateway。

1. 加载未打包扩展：`chrome://extensions` / `edge://extensions` → `apps/extension`。
2. 改过 Gateway 配置或 TypeScript 后先 `pnpm build`，再重载 Cursor 里的 MCP。
3. 夹具（可选）：

```powershell
$env:MCP2WEBMCP_E2E_FIXTURE_PORT = "18081"
pnpm --filter @mcp2webmcp/webmcp-extension-demo-fixture start
```

打开 [http://127.0.0.1:18081](http://127.0.0.1:18081)，或打开任何会 `registerTool` 的业务页（如 KnowMesh）。

4. 在 MCP 配置里**增加** `mcp2webmcp-extension-demo`（模板 `configs/mcp-client.extension.example.json`），不要改掉已有的 `mcp2webmcp-demo`。Gateway 监听 `127.0.0.1:9334`。

`configs/extension-demo.yaml` 默认 `allowedOrigins: []`：扩展发现到的工具会写入本地同意账本，MCP 可直接调用。不想暴露时用 `webmcp_revoke_consent`。yaml 里若仍列出 origin，则必须与地址栏逐字一致（`localhost` ≠ `127.0.0.1`）。

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/connect-mcp-client.md](docs/connect-mcp-client.md) | 接到 Cursor / Claude |
| [docs/architecture.md](docs/architecture.md) | 架构与仓库结构 |
| [docs/extension-loopback-protocol.md](docs/extension-loopback-protocol.md) | 扩展 ↔ Gateway 协议 |
| [docs/develop.md](docs/develop.md) | 测试与配置 |
| [docs/README.md](docs/README.md) | 文档索引 |
| [docs/adr/0009-extension-webmcp-runtime-polyfill.md](docs/adr/0009-extension-webmcp-runtime-polyfill.md) | 扩展页面 WebMCP runtime polyfill |

## License

[MIT](LICENSE)
