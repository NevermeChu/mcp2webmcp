# webmcp-extension-demo fixture（无 embed）

给 **ExtensionAdapter** 用的静态页：只 `registerTool({ name: "echo", ... })`，**不**加载 MCP-B embed / `@mcp-b/global`，也**不**自建 `modelContext`。

浏览器未提供 WebMCP 时，由扩展 `webmcp-runtime-polyfill.js` 安装 host。另有 `empty.html`（runtime、零工具）与 `existing-host.html`（页面自带 host，polyfill 不得覆盖）。

```powershell
$env:MCP2WEBMCP_E2E_FIXTURE_PORT = "18081"
pnpm --filter @mcp2webmcp/webmcp-extension-demo-fixture start
```

打开 `http://127.0.0.1:18081`。Gateway 用 `configs/extension-demo.yaml`（loopback **9334**），Extension 模式必须配置共享令牌。加载和配对步骤见 [扩展说明](../../../apps/extension/README.md)，MCP Client 接线见 [连接指南](../../../docs/connect-mcp-client.md)。

yaml 若列出 `allowedOrigins`，必须与地址栏逐字一致（`localhost` ≠ `127.0.0.1`）。当前 extension-demo 默认空名单，发现到的工具进同意账本。
