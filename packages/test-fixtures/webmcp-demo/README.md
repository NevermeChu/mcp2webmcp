# webmcp-demo fixture（cooperative embed）

WebMCP Gateway（mcp2webmcp）的 v0.1 演示页。

页面注册 `echo`、`get_page_title`、`add`，并**显式加载** MCP-B local-relay embed 与 `@mcp-b/global`。

这是 **协作式页面** 夹具，**不是** Extension 验收。无 embed 路径见 `packages/test-fixtures/webmcp-extension-demo` 与 `apps/extension`。

手工 Demo 时 origin / relay 必须与 `configs/demo.yaml` 一致：

```powershell
$env:MCP2WEBMCP_E2E_RELAY_PORT = "9333"
$env:MCP2WEBMCP_E2E_FIXTURE_PORT = "18080"
pnpm --filter @mcp2webmcp/webmcp-demo-fixture start
```

然后打开 `http://127.0.0.1:18080`。项目定位见 [根 README](../../../README.md)，完整接线见 [连接指南](../../../docs/connect-mcp-client.md#cooperative-embed)。
