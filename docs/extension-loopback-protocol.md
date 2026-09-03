# Extension ↔ Gateway loopback protocol

v0.1 私有 JSON 协议：Chrome/Edge MV3 扩展把页面 WebMCP 工具搬到本机 Gateway。**不是** MCP，**不是** MCP-B 的 WebSocket 协议。

调用路径仍是：

```text
页面 WebMCP → 扩展（发现 + 搬运）→ ExtensionAdapter → Core → stdio MCP → Cursor
```

扩展**不是** MCP server。Gateway 只监听 loopback（默认 `127.0.0.1:9334`，**不要**占用 MCP-B relay 的 `9333`）。

## Transport

- WebSocket，文本帧，每帧一个 JSON 对象。
- 服务端只 bind `127.0.0.1`（或规范化后的 loopback）。非 loopback 远端一律断开。
- 协议名：`mcp2webmcp-extension`。版本：`1`。
- 扩展先发 `hello`；Gateway 回 `helloAck` 后才处理业务帧。版本不匹配则关闭。
- v0.1：一条扩展连接对应一个 Gateway 进程。后连上的 socket 取代前一个。多 Gateway 共享浏览器连接留到下一步。

## 消息

公共字段：`type`（字符串）。

### `hello`（扩展 → Gateway）

```json
{
  "type": "hello",
  "protocol": "mcp2webmcp-extension",
  "protocolVersion": 1
}
```

### `helloAck`（Gateway → 扩展）

```json
{
  "type": "helloAck",
  "protocol": "mcp2webmcp-extension",
  "protocolVersion": 1,
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

WebSocket 断开时，Gateway 会把该连接上的全部 source 标为 disconnected。

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
      "annotations": { "readOnlyHint": true, "idempotentHint": true }
    }
  ]
}
```

策略 match 的是页面 **`originalName`**（`echo`），不是 MCP 上带哈希的 `mcpName`。

### `invoke`（Gateway → 扩展）

用页面 `originalName` 调用。`requestId` 关联结果。

```json
{
  "type": "invoke",
  "requestId": "r1",
  "sourceId": "tab:18",
  "originalName": "echo",
  "args": { "message": "hello" },
  "deadline": 1710000000000
}
```

### `invokeCancel`（Gateway → 扩展）

```json
{ "type": "invokeCancel", "requestId": "r1", "sourceId": "tab:18" }
```

### `invokeResult`（扩展 → Gateway）

```json
{
  "type": "invokeResult",
  "requestId": "r1",
  "sourceId": "tab:18",
  "content": [{ "type": "text", "text": "echo:hello" }],
  "isError": false
}
```

出错时 `isError: true`，可带 `error: { "message": "..." }`。不要把凭证塞进 `content`。

### `ping` / `pong`

MV3 service worker 会睡。双方均可发 `ping`；对端回相同 `id` 的 `pong`。Gateway 在 `invoke` 前若连接不健康会先 ping。

```json
{ "type": "ping", "id": "p1" }
{ "type": "pong", "id": "p1" }
```

## 扩展侧约束

- 隔离世界看不到 `document.modelContext`：MAIN world 先注入可删除的 runtime polyfill（若尚无 `registerTool`），再由 `content-main.js` 钩住 `registerTool` / 可选的 unregister。
- 站点只 `registerTool`。有 runtime 无工具时快照 `runtimePresent: true` 且 `tools: []`（popup `0 tools`）。`no-webmcp-runtime` 仅在非 http(s)、非 secure、或挂载失败时出现。见 [ADR 0009](adr/0009-extension-webmcp-runtime-polyfill.md)。
- 不在扩展里做 allowlist / namespace / audit。那些只在 Gateway yaml 与 Core。
