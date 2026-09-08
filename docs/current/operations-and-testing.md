# 运维与测试

## 日志与审计

- 运行日志是 JSONL，记录 `page`、`extension`、`gateway`、`mcp` 各 hop；默认位于 `~/.mcp2webmcp/logs/<runtime.name>.jsonl`。
- 运行日志不写 MCP stdout，避免破坏 stdio 协议；文件记录 info/warn/error，`logLevel` 控制 stderr。
- 审计日志只记录调用决策与结果元数据，不记录原始参数。
- 两类日志达到上限后保留一个 `.1` 备份；后续轮转会替换旧备份，不会因目标已存在而停止轮转。

## 常用验证

```powershell
pnpm build
pnpm lint
pnpm test
pnpm test:e2e
pnpm test:e2e:extension
pnpm docs:check
pnpm format:check
```

测试层级：

- `pnpm test`：包级单元测试、真实 stdio 子进程集成、Extension 协议投影集成；运行前先 build。
- `pnpm test:e2e`：真实浏览器 cooperative MCP-B 路径。
- `pnpm test:e2e:extension`：真实 Chrome/Edge MV3 扩展、无 embed 页面、picker、调用、页面注销工具和 tab 关闭等行为。
- `pnpm docs:check`：检查 Git 跟踪 Markdown 的本地链接，拒绝缺失、越出仓库或指向未跟踪文件的目标。

没有跑浏览器 E2E 时，不能把“单元/集成通过”表述为浏览器链路已验收。CI 当前包含 build、lint、test、cooperative E2E 与 extension E2E。

## 快速定位

- 启动即失败：先看 strict 配置错误；Extension 模式还必须检查 Gateway 与扩展“连接设置”中的令牌一致。
- `EADDRINUSE`：确认旧 MCP 客户端拉起的 Gateway 已随 stdio 关闭，检查 9333/9334 是否混用。
- 工具未出现：核对地址栏精确 origin、同意账本、policy，以及 `webmcp_list_sources` / `webmcp_list_tools`。
- 调用失败：用 `webmcp_recent_logs` 按 `traceId` 查看 hop；进程已退出时直接读取 JSONL。
- `POLICY_DENIED`：调用被用户模式或 yaml policy 拒绝，或没有规则/consent 允许；检查 Side Panel 活动页、`webmcp_list_consent` 和 Gateway 日志。
- `CONFIRMATION_DENIED`：用户在 Side Panel 拒绝了本次调用；工具没有执行。
- `CONFIRMATION_UNAVAILABLE`：扩展断线、确认等待超时或没有确认通道；工具没有执行。
- `OUTCOME_UNKNOWN`：页面可能已执行，不应直接重试有副作用的工具。

Side Panel 活动页记录页面调用结果，也接收 Gateway 的策略拒绝、确认拒绝与确认通道不可用原因。输入 schema、资源限制或调用前审计等 Core 内部失败仍以 MCP 错误和 Gateway JSONL 为准。见 [ADR 0011](../adr/0011-extension-policy-control.md)。

## 已知边界

- 一个 Extension WebSocket 会话对应一个 Gateway；多 MCP 客户端不会共享同一扩展连接。
- 当前无 HTTP MCP transport，也没有远程管理面。
- confirm 依赖已鉴权且在线的 Extension 会话；Side Panel 未打开时后台仍保留请求至截止时间，用户未响应则 fail-closed。
- MCP-B 模式没有 Extension Side Panel，命中 confirm 时仍以 `CONFIRMATION_UNAVAILABLE` fail-closed。
- 同意账本锁提供本机文件级并发保护，不等同于分布式存储。
