# webmcp-demo fixture（cooperative embed）

WebMCP Gateway（mcp2webmcp）的 v0.1 演示页。

页面注册 `echo`、`get_page_title`、`add`，并**显式加载** MCP-B local-relay embed 与 `@mcp-b/global`。

这是 v0.1 **协作式页面** 夹具，**不是** Extension 零接入验收。生产站点不应长期内嵌该 embed；那是后续 ExtensionAdapter 的路径。

手工 Demo 时 origin / relay 必须与 `configs/demo.yaml` 一致：

```powershell
$env:MCP2WEBMCP_E2E_RELAY_PORT = "9333"
$env:MCP2WEBMCP_E2E_FIXTURE_PORT = "18080"
pnpm --filter @mcp2webmcp/webmcp-demo-fixture start
```

然后打开 `http://127.0.0.1:18080`。完整接线见仓库根 README 与 `docs/connect-mcp-client.md`。
