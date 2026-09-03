# ADR 0009 — 扩展 MAIN world 提供一份可删除的 WebMCP runtime polyfill

- Status: Accepted
- Date: 2026-09-03
- Replaces: ADR 0008 中「缺 runtime 则失败、不 polyfill」
- Protocol: [docs/extension-loopback-protocol.md](../extension-loopback-protocol.md)

## Context

Chrome 尚未提供 `document.modelContext`。KnowMesh 与未来业务站只调用 `registerTool`，不会加载 `@mcp-b/global` 或 MCP-B embed。ADR 0008 曾要求缺页面 runtime 时扩展失败；那样站点必须自建 host，与「页面只注册」矛盾。

扩展仍然**不是** MCP server：策略、审计、allowlist 留在 Gateway。本决策只补页面 WebMCP 的最小 host。

## Decision

在 `apps/extension/webmcp-runtime-polyfill.js` **只放一份** runtime，作为未打包 MV3 的第二个 MAIN world 脚本（`manifest.json` 中排在 `content-main.js` 之前，`document_start`）。不用打包器，不用 `import`（MAIN world ES module 还要 `web_accessible_resources`）。

- **原生优先：** 已有 `document.modelContext.registerTool` 或 `navigator.modelContext.registerTool` 则不安装。
- **Secure Context：** 非 secure context 不安装（`https` 与 `http://127.0.0.1` 可用）。
- **一份 host：** 同一对象赋给 `document.modelContext` 与 `navigator.modelContext`；brand `Symbol.for("mcp2webmcp.webmcp-runtime-polyfill")` 防止二次安装；描述符 `configurable: true`。
- **最小 API：** `registerTool(def, { signal })` 与 `getTools()`。不实现 `unregisterTool`、`executeTool`、declarative HTML tools、跨 frame `fromOrigins`。invoke 仍由 `content-main.js` 记住页面 `def.execute` 再调用。
- **发现层不内联第二份 runtime：** `content-main.js` 只 `intercept` / `wrapContext` / 轮询「谁提供的」`registerTool`（原生 / polyfill / 页面后挂）。禁止在 wrap 里 `new` 一个 host。polyfill 的内部 Map 不与发现用的 tools Map 合并。
- **产品变化：** 有 runtime 无工具时 popup / 快照为 `runtimePresent: true` 且 `0 tools`，不再把「未 registerTool 的站」显示成 `no-webmcp-runtime`。`no-webmcp-runtime` 只应出现在非 http(s)、非 secure、或 `defineProperty` 失败且轮询也没有。
- **站点后挂：** 页面之后赋值自己的 `modelContext` 时，现有 setter 换 host 并重新 wrap；polyfill 是缺省，不是永久占领。

不做：`postMessage`、`chrome.*`、Gateway 用的 tools Map、策略/审计、加载 `@mcp-b/global` / embed。不在 `background.js`、`content-isolated.js`、`popup.js` 再造 runtime。

## 移除条件

同时满足即可一次 PR 卸掉本模块（`content-main.js` / isolated / background **不改行为**）：

1. 目标浏览器上 `typeof document.modelContext?.registerTool === "function"` 稳定为真。
2. E2E（`pnpm test:e2e:extension`）在**不加载** `webmcp-runtime-polyfill.js` 时仍能发现夹具工具。

卸除步骤：manifest `js` 数组去掉该文件 → 删除文件及其单测 → 本 ADR 标 Superseded → README 不再提 polyfill → 夹具保持「只 `registerTool`」。

## Consequences

- 夹具与 KnowMesh 都只 `await document.modelContext.registerTool(...)`。Gateway 同意账本自动放行发现到的工具；可选 yaml `allowedOrigins` 仍须与地址栏 origin 逐字一致。
- 浏览器原生后删除成本是整文件 + manifest 一行 + 本文档状态，而不是从发现代码里拆 runtime。

## Related

- [0008-extension-adapter-loopback.md](0008-extension-adapter-loopback.md)
- [architecture.md](../architecture.md)
- [connect-mcp-client.md](../connect-mcp-client.md)
