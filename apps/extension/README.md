# WebMCP Gateway 浏览器扩展（未打包 MV3）

Chrome / Edge 扩展：看见页面 `registerTool`，连本机 Gateway loopback，把 invoke 打回页面。

**不是** MCP server，也不要把它接到 Cursor。Cursor 只连 stdio Gateway（`mcp2webmcp`）。

## 加载

1. `pnpm build`（Gateway）。
2. 打开 `chrome://extensions` 或 `edge://extensions`，打开「开发者模式」。
3. 「加载已解压的扩展程序」→ 选本目录 `apps/extension`。
4. Gateway：`node apps/gateway/dist/main.js --config configs/extension-demo.yaml`（默认 `ws://127.0.0.1:9334`，不要占用 MCP-B 的 9333）。
5. 打开无 embed 夹具：`http://127.0.0.1:18081`（见 `packages/test-fixtures/webmcp-extension-demo`）。

Popup 只显示是否连上 Gateway、当前 tab origin / 工具数。策略 UI 不在扩展里。

缺页面 WebMCP runtime 时扩展**不会**充当 polyfill；popup 会显示 `no-webmcp-runtime`。

协议：[docs/extension-loopback-protocol.md](../../docs/extension-loopback-protocol.md)。接线：[docs/connect-mcp-client.md](../../docs/connect-mcp-client.md)。
