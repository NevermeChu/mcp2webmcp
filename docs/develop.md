# 开发

```powershell
pnpm test                 # 单测 + 集成（不含浏览器）
pnpm test:e2e             # cooperative embed；Windows 优先 Edge
pnpm test:e2e:extension   # 未打包扩展 + 无 embed 夹具
pnpm lint
```

`pnpm test` 会 spawn `packages/mcp-transport/dist/fake-stdio-main.js`，请先 `pnpm build`。没有 Edge 时：

```powershell
pnpm exec playwright install chromium
pnpm test:e2e
```

不经过浏览器、只测 stdio：

```powershell
$env:MCP2WEBMCP_FAKE_ECHO = "1"
node apps/gateway/dist/main.js
```

环境变量：`MCP2WEBMCP_CONFIG`、`MCP2WEBMCP_ALLOWED_ORIGINS`、`MCP2WEBMCP_LOG_LEVEL`（过滤 stderr）、`MCP2WEBMCP_LOG_PATH`（覆盖 JSONL 路径）。改 `packages/protocol` 或 yaml schema 后必须 `pnpm build`，Cursor 读的是 `apps/gateway/dist`。`mcp2webmcp-extension-demo` 由 Cursor 按 `.cursor/mcp.json` spawn，不要另外再开一份同样的 `node ... extension-demo.yaml`。Reload MCP 会关 stdio；Gateway 必须随之退出并放开 `9334`，否则下一次会 `EADDRINUSE`。

进程启动后会自动写 JSONL（默认 `~/.mcp2webmcp/logs/<runtime.name>.jsonl`），覆盖页面 → 扩展 → Gateway → MCP 投影。不写 stdout。Cursor 把 MCP 标红时仍可读该文件。MCP 还活着时可用 `webmcp_recent_logs`。`logLevel` 只影响 stderr；文件始终记录 info/warn/error。调用参数和 Cookie 不会进日志。

| 文件 | 用途 |
| --- | --- |
| `configs/demo.yaml` | embed demo（`:18080` / `9333`） |
| `configs/extension-demo.yaml` | 扩展 demo（`:18081` / `9334`）；空 `allowedOrigins` + 同意账本 |
| `configs/example.yaml` | 业务站骨架（mcpb 仍要 origin） |
| `~/.mcp2webmcp/*-consent.json` | 发现后自动放行的 origin/工具；撤销不入库 |
| `~/.mcp2webmcp/logs/<name>.jsonl` | 端到端运行日志（哪一跳失败看 `hop` + `event`） |
