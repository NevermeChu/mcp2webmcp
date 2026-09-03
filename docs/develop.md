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

环境变量：`MCP2WEBMCP_CONFIG`、`MCP2WEBMCP_ALLOWED_ORIGINS`、`MCP2WEBMCP_LOG_LEVEL`（日志只打 stderr）。

| 文件 | 用途 |
| --- | --- |
| `configs/demo.yaml` | embed demo（`:18080` / `9333`） |
| `configs/extension-demo.yaml` | 扩展 demo（`:18081` / `9334`） |
| `configs/example.yaml` | 业务站骨架，需改 origin / 工具 |
| `configs/mcp-client.example.json` | embed 客户端模板 |
| `configs/mcp-client.extension.example.json` | 扩展客户端模板 |
