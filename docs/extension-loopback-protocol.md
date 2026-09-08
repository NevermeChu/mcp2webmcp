# Extension ↔ Gateway loopback protocol

v0.1 私有 JSON 协议：Chrome/Edge MV3 扩展把页面 WebMCP 工具搬到本机 Gateway。**不是** MCP，**不是** MCP-B 的 WebSocket 协议。

调用路径仍是：

```text
页面 WebMCP → 扩展（发现 + 搬运）→ ExtensionAdapter → Core → stdio MCP → Cursor
```

扩展**不是** MCP server。Gateway 只监听 loopback（默认 `127.0.0.1:9334`，**不要**占用 MCP-B relay 的 `9333`）。

## Transport

- WebSocket，文本帧，每帧一个 JSON 对象。
- Gateway 将单帧限制为 1 MiB；`tools.replace` 每个快照最多 500 个工具。
- 服务端只 bind `127.0.0.1`（或规范化后的 loopback）。非 loopback 远端一律断开。
- 握手 `Origin` 头必须是 `chrome-extension://…`（浏览器对扩展 WebSocket 强制带此头，网页无法伪造）。其他 origin 一律 `4003` 拒绝，挡住网页对 loopback 端口的 drive-by 连接。
- 共享令牌必填：Gateway yaml 配置 `browser.extension.authToken`，或通过环境变量 `MCP2WEBMCP_EXTENSION_TOKEN` 注入；`hello` 必须携带相同 `token`，否则 `4001` 关闭。扩展在 Side Panel「Gateway 鉴权令牌」里粘贴一次，存入 `chrome.storage.local`。
- 协议名：`mcp2webmcp-extension`。版本：`2`。
- 扩展先发 `hello`；Gateway 回 `helloAck` 后才处理业务帧。版本不匹配 `4002`；hello 10 秒内未完成 `4001` 关闭。
- 一条扩展连接对应一个 Gateway 进程。**只有完成 hello 的新连接**才会取代旧连接（旧连接 `4000` 关闭）；未 hello 的新连接不会影响已建立的会话。
- WebSocket 意外断开时，Gateway 保留该连接上的 source 一段宽限期（默认 15 秒，`browser.extension.disconnectGraceMs` 可调，`0` 关闭）。扩展重连并 hello 后快照重放，MCP 客户端看到的工具列表不抖动；宽限期满仍未回来才摘除并广播变更。显式 `source.remove` 不等宽限期。

## 消息

公共字段：`type`（字符串）。

### `hello`（扩展 → Gateway）

```json
{
  "type": "hello",
  "protocol": "mcp2webmcp-extension",
  "protocolVersion": 2,
  "token": "<必填，Gateway authToken>"
}
```

### `helloAck`（Gateway → 扩展）

```json
{
  "type": "helloAck",
  "protocol": "mcp2webmcp-extension",
  "protocolVersion": 2,
  "adapterId": "ext-1"
}
```

### `source.upsert`（扩展 → Gateway）

`sourceId` 建议 `tab:<chromeTabId>`，在同一 `adapterId` 下唯一。

`origin` / `url` 必须以 **`tab.url` 算出的 origin** 为准，不要信页面字符串。`http://localhost` 与 `http://127.0.0.1` 不是同一个 origin。

`reason`：`connect` | `navigate` | `reload`。`navigate` / `reload` 会升高 Core `generation` 并清掉旧工具。

```json
{
  "type": "source.upsert",
  "sourceId": "tab:18",
  "tabId": "18",
  "origin": "http://127.0.0.1:18081",
  "url": "http://127.0.0.1:18081/",
  "title": "echo page",
  "reason": "connect"
}
```

Gateway 对 yaml `allowedOrigins` 非空时，名单外的 origin **不投影**。名单为空且 consent 开启时，扩展发现的 origin 都会进入 Core，由同意账本决定能否调用。

### `source.remove`（扩展 → Gateway）

关 tab 或无法再读 `tab.url` 时发送。

```json
{ "type": "source.remove", "sourceId": "tab:18" }
```

WebSocket 断开时，Gateway 在宽限期内保留该连接上的 source（见 Transport），期满仍未重连才移除。

### `sourceAck`（Gateway → 扩展）

Gateway 接受 `source.upsert` 后返回权威 generation。扩展必须用它覆盖本地计数；这样 MV3 service worker 重启后，后续 invoke/result 仍绑定到正确的 source 代次。

```json
{ "type": "sourceAck", "sourceId": "tab:18", "sourceGeneration": 3 }
```

### `tools.replace`（扩展 → Gateway）

按 source 全量快照。只含工具描述，**禁止**发送 Cookie、Authorization、localStorage 凭证。

```json
{
  "type": "tools.replace",
  "sourceId": "tab:18",
  "tools": [
    {
      "originalName": "echo",
      "description": "Echo the provided message",
      "inputSchema": {
        "type": "object",
        "properties": { "message": { "type": "string" } },
        "required": ["message"]
      },
      "annotations": { "idempotentHint": true }
    }
  ]
}
```

注解是页面自我申报的。Gateway 会剥掉 `readOnlyHint`、`idempotentHint` 以及所有会放宽信任的 false 值；只保留会收紧行为的 `destructiveHint: true` 与 `openWorldHint: true`。

策略 match 的是页面 **`originalName`**（`echo`），不是 MCP 上带哈希的 `mcpName`。

### `invoke`（Gateway → 扩展）

用页面 `originalName` 调用。`requestId` 关联结果。

```json
{
  "type": "invoke",
  "requestId": "r1",
  "sourceId": "tab:18",
  "sourceGeneration": 1,
  "originalName": "echo",
  "args": { "message": "hello" },
  "deadline": 1710000000000
}
```

### `invokeCancel`（Gateway → 扩展）

```json
{ "type": "invokeCancel", "requestId": "r1", "sourceId": "tab:18", "sourceGeneration": 1 }
```

### `invokeResult`（扩展 → Gateway）

```json
{
  "type": "invokeResult",
  "requestId": "r1",
  "sourceId": "tab:18",
  "sourceGeneration": 1,
  "content": [{ "type": "text", "text": "echo:hello" }],
  "isError": false
}
```

出错时 `isError: true`，可带 `error: { "message": "..." }`。若页面在调用期间发生导航，返回 `error.code: "OUTCOME_UNKNOWN"`；Gateway 不会把这种结果误报为确定失败。不要把凭证塞进 `content`。

### `ping` / `pong`

MV3 service worker 会睡。双方均可发 `ping`；对端回相同 `id` 的 `pong`。Gateway 在 `invoke` 前若连接不健康会先 ping。

```json
{ "type": "ping", "id": "p1" }
{ "type": "pong", "id": "p1" }
```

### `log`（扩展 → Gateway）

页面 / 扩展把诊断事件推到 Gateway JSONL。不含调用参数、Cookie、Authorization。未知 `type` 会被丢弃并记 `extension.message.dropped`。

```json
{
  "type": "log",
  "hop": "page",
  "level": "info",
  "event": "runtime.wrapped",
  "data": { "toolCount": 1 }
}
```

## 扩展侧约束

- 隔离世界看不到 `document.modelContext`：MAIN world 先注入可删除的 runtime polyfill（若尚无 `registerTool`），再由 `content-main.js` 钩住 `registerTool` / 可选的 unregister。
- 站点只 `registerTool`。有 runtime 无工具时快照 `runtimePresent: true` 且 `tools: []`（popup `0 tools`）。`no-webmcp-runtime` 仅在非 http(s)、非 secure、或挂载失败时出现。见 [ADR 0009](adr/0009-extension-webmcp-runtime-polyfill.md)。
- 不在扩展里做 allowlist / namespace / audit。那些只在 Gateway yaml 与 Core。
