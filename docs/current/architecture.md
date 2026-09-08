# 当前架构

## 目标与边界

WebMCP Gateway 把浏览器页面注册的 WebMCP 工具投影为 stdio MCP 工具。它不是 WebMCP polyfill，也不让浏览器扩展充当 MCP Server。当前对外传输只有 stdio。

```text
页面 WebMCP
  -> MCP-B embed 或 MV3 Extension
  -> BrowserAdapter
  -> Core（注册、生命周期、命名、策略、同意、校验、审计）
  -> MCP transport（管理工具 + 动态投影工具）
  -> MCP Client
```

## 模块职责

| 目录                       | 当前职责                                                                  |
| -------------------------- | ------------------------------------------------------------------------- |
| `apps/gateway`             | CLI、配置加载、适配器装配、stdio 生命周期                                 |
| `apps/extension`           | MV3 页面发现、可删除 runtime polyfill、工具快照和调用搬运                 |
| `packages/protocol`        | 跨包类型、Zod 配置 schema、错误与调用结果模型                             |
| `packages/browser-adapter` | Fake、MCP-B 与 Extension 三种适配器                                       |
| `packages/core`            | source/tool registry、生命周期、策略、同意、路由、schema 校验、日志与审计 |
| `packages/mcp-transport`   | MCP 管理工具、动态工具投影、错误映射                                      |
| `packages/test-fixtures`   | cooperative 与 extension 浏览器验收页面                                   |

## 两条浏览器接入

- `adapter: mcpb`：页面加载 MCP-B embed，Gateway 可作为 relay server 或既有 relay 的 client。`allowedOrigins` 必须显式配置。
- `adapter: extension`：页面只需提供 `registerTool`；扩展通过 `127.0.0.1:9334` 的私有 WebSocket 协议连接 Gateway。共享令牌必填，`allowedOrigins: []` 仅表示不再加一层静态 origin allowlist，同意账本仍参与授权。

## 生命周期与身份

- source 身份由 `adapterId + sourceId` 确定；导航/重载提升 `generation`。
- tool 调用绑定 `adapterId + sourceId + sourceGeneration + originalName`。Extension 协议 v3 用 `sourceAck` 把 Gateway 的权威 generation 同步回扩展，并在 invoke、cancel、result 与确认消息中携带或复核 generation，同时校验页面实例。
- `mcpName` 是稳定、带命名空间的 MCP 名称；策略匹配使用页面 `originalName`。
- attach 先订阅事件，再获取稳定快照；快照期间出现事件会重试，避免用旧快照覆盖新事件。
- source generation 变化时，旧 generation 的工具和延迟结果不能进入当前状态。

## MCP 表面

管理工具为：`webmcp_list_sources`、`webmcp_list_tools`、`webmcp_get_tool`、`webmcp_runtime_status`、`webmcp_call_tool`、`webmcp_list_consent`、`webmcp_revoke_consent`、`webmcp_recent_logs`。可调用页面工具还会动态投影为独立 MCP 工具。

恢复同意不是 MCP 工具，必须由本机 CLI 执行；这保证调用端不能自行撤销管理员的 revoke。

## 策略控制边界

Side Panel 是 Extension 模式的本机策略操作界面，可为精确 `origin + originalName` 选择 allow、confirm 或 deny，并显示等待确认与 Gateway 拦截原因。扩展只提交选择和一次性确认响应；Gateway Core 仍负责持久化、规则优先级、校验、结构化日志、审计和最终执行。见 [ADR 0011](../adr/0011-extension-policy-control.md)。
