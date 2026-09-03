# webmcp-extension-demo fixture（无 embed）

给 **ExtensionAdapter** 用的静态页：只 `registerTool({ name: "echo", ... })`，**不**加载 MCP-B embed / `@mcp-b/global`。

页面自己提供最小 `document.modelContext`（站点侧 WebMCP，不是扩展 polyfill）。扩展缺 runtime 时会失败，而不是偷偷补一个。

```powershell
$env:MCP2WEBMCP_E2E_FIXTURE_PORT = "18081"
pnpm --filter @mcp2webmcp/webmcp-extension-demo-fixture start
```

打开 `http://127.0.0.1:18081`。Gateway 用 `configs/extension-demo.yaml`（loopback **9334**）。加载未打包扩展：`apps/extension`。

`localhost` 与 `127.0.0.1` 不是同一个 origin；allowlist 必须与地址栏逐字一致。
