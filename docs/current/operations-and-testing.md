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
pnpm format:check
```

测试层级：

- `pnpm test`：包级单元测试、真实 stdio 子进程集成、Extension 协议投影集成；运行前先 build。
- `pnpm test:e2e`：真实浏览器 cooperative MCP-B 路径。
- `pnpm test:e2e:extension`：真实 Chrome/Edge MV3 扩展、无 embed 页面、picker、调用、撤销、tab 关闭等行为。

没有跑浏览器 E2E 时，不能把“单元/集成通过”表述为浏览器链路已验收。CI 当前包含 build、lint、test、cooperative E2E 与 extension E2E。

## 快速定位

- 启动即失败：先看 strict 配置错误；Extension 模式还必须检查 Gateway 与 Side Panel 令牌一致。
- `EADDRINUSE`：确认旧 MCP 客户端拉起的 Gateway 已随 stdio 关闭，检查 9333/9334 是否混用。
- 工具未出现：核对地址栏精确 origin、同意账本、policy，以及 `webmcp_list_sources` / `webmcp_list_tools`。
- 调用失败：用 `webmcp_recent_logs` 按 `traceId` 查看 hop；进程已退出时直接读取 JSONL。
- `OUTCOME_UNKNOWN`：页面可能已执行，不应直接重试有副作用的工具。

## 已知边界

- 一个 Extension WebSocket 会话对应一个 Gateway；多 MCP 客户端不会共享同一扩展连接。
- 当前无 HTTP MCP transport，也没有远程管理面。
- confirm 尚无交互审批 provider，因此需要确认的调用会 fail-closed。
- 同意账本锁提供本机文件级并发保护，不等同于分布式存储。
