# WebMCP Gateway 浏览器扩展（未打包 MV3）

Chrome / Edge 扩展：看见页面 `registerTool`，连本机 Gateway loopback，把 invoke 打回页面。

**不是** MCP server，也不要把它接到 Cursor。Cursor 只连 stdio Gateway（`mcp2webmcp`）。

## 加载

1. `pnpm build`（Gateway）。
2. 打开 `chrome://extensions` 或 `edge://extensions`，打开「开发者模式」。
3. 「加载已解压的扩展程序」→ 选本目录 `apps/extension`。
4. Gateway：`node apps/gateway/dist/main.js --config configs/extension-demo.yaml`（默认 `ws://127.0.0.1:9334`，不要占用 MCP-B 的 9333）。
5. 打开无 embed 夹具：`http://127.0.0.1:18081`（见 `packages/test-fixtures/webmcp-extension-demo`）。

Popup 显示 Gateway 连接、当前 tab origin / 工具数。点 **Register tool** 后页面进入框选：点按钮或输入框会直接 `registerTool`（不是第三层）。同意账本与撤销在 Gateway（`webmcp_list_consent` / `webmcp_revoke_consent`），策略 UI 不在扩展里。

浏览器尚未提供 `document.modelContext` 时，扩展 MAIN world 会注入一份可整文件删除的 runtime（`webmcp-runtime-polyfill.js`）。站点只 `registerTool`。有 runtime 但未注册工具时 popup 显示 `0 tools`，不是 `no-webmcp-runtime`。原生 API 稳定后的卸除步骤见 [ADR 0009](../../docs/adr/0009-extension-webmcp-runtime-polyfill.md)。

协议：[docs/extension-loopback-protocol.md](../../docs/extension-loopback-protocol.md)。接线：[docs/connect-mcp-client.md](../../docs/connect-mcp-client.md)。
