# WebMCP Gateway 浏览器扩展（未打包 MV3）

Chrome / Edge 扩展：看见页面 `registerTool`，连本机 Gateway loopback，把 invoke 打回页面。

**不是** MCP server，也不要把它接到 Cursor。Cursor 只连 stdio Gateway（`mcp2webmcp`）。

## 加载

1. `pnpm build`（Gateway）。
2. 打开 `chrome://extensions` 或 `edge://extensions`，打开「开发者模式」。
3. 「加载已解压的扩展程序」→ 选本目录 `apps/extension`。
4. MCP Client 通常按 `configs/mcp-client.extension.example.json` 拉起 Gateway。若要在终端单独验证，必须先设置共享令牌：

   ```powershell
   $env:MCP2WEBMCP_EXTENSION_TOKEN = "替换为随机长令牌"
   node apps/gateway/dist/main.js --config configs/extension-demo.yaml
   ```

5. 在扩展底部“连接设置”中保存同一个令牌。
6. 打开无 embed 夹具：`http://127.0.0.1:18081`（见 `packages/test-fixtures/webmcp-extension-demo`）。默认 loopback 是 `ws://127.0.0.1:9334`，不要占用 MCP-B 的 9333。

Side Panel 显示 Gateway 连接、当前 tab origin、工具和最近调用。点 **从页面创建** 后页面进入框选：点按钮或输入框会直接 `registerTool`（不是第三层）。共享令牌位于底部 **连接设置**；同意账本与撤销仍在 Gateway（`webmcp_list_consent` / `webmcp_revoke_consent`）。

每个工具展开后可选择 **允许 / 每次确认 / 禁止**。未手动修改时，Extension 默认配置通过 `autoAdmit` 保持“注册即可调用”；选择按精确 `origin + originalName` 提交，由 Gateway 持久化并在调用前执行。`confirm` 会把本次调用挂起到 Side Panel，只有“仅本次允许”才继续；拒绝、超时或扩展断线均不执行。Gateway 侧拒绝及原因会进入活动列表。设计边界见 [ADR 0011](../../docs/adr/0011-extension-policy-control.md)。

浏览器尚未提供 `document.modelContext` 时，扩展 MAIN world 会注入一份可整文件删除的 runtime（`webmcp-runtime-polyfill.js`）。站点只 `registerTool`。有 runtime 但未注册工具时 Side Panel 显示 `0 tools`，不是 `no-webmcp-runtime`。原生 API 稳定后的卸除步骤见 [ADR 0009](../../docs/adr/0009-extension-webmcp-runtime-polyfill.md)。

协议：[docs/extension-loopback-protocol.md](../../docs/extension-loopback-protocol.md)。接线：[docs/connect-mcp-client.md](../../docs/connect-mcp-client.md)。
