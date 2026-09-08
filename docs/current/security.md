# 当前安全模型

## 信任边界

- 页面、页面声明的工具描述、JSON Schema、annotations 和调用返回值均不可信。
- Extension 只负责发现和搬运；allowlist、同意、策略、输入校验、资源限制与审计只在 Gateway 执行。
- MCP 客户端身份目前是进程实例与自报名称，不是强认证身份；安全边界主要依赖本机进程边界、配置与策略。

## Extension loopback

- 仅允许 loopback bind。
- WebSocket 握手 Origin 必须为 `chrome-extension://...`。
- `browser.extension.authToken` 或 `MCP2WEBMCP_EXTENSION_TOKEN` 必填，长度 1–512；扩展 Side Panel 保存相同令牌。
- 协议版本为 2；单帧最大 1 MiB，单次工具快照最多 500 项。
- 新连接只有通过 hello 后才替换旧会话。意外断线默认保留 source 15 秒，显式 `source.remove` 立即生效。

Origin 校验阻止普通网页直接连接；共享令牌进一步阻止仅伪造 Origin 的本机进程。令牌保存在扩展本地存储中，因此它不是对已攻陷浏览器配置文件的防护。

## 授权顺序

1. 适配器 origin allowlist；
2. 本地同意账本；
3. yaml policy 的 allow/deny/confirm；
4. 无确认通道时 confirm fail-closed；
5. 调用前再次校验 source generation、输入大小和 schema；
6. 调用前审计写入失败则不执行。

同意账本每次操作重新读取磁盘；写入使用跨进程锁、状态合并和原子替换。账本损坏或不可读时 fail-closed，且不会被自动接纳流程覆盖。MCP 可 revoke，但不能 restore。恢复命令见 [configuration.md](configuration.md)。

## 页面 annotations

页面不能自证安全。Gateway 丢弃 `readOnlyHint`、`idempotentHint` 和所有会放宽信任的 false 值，只保留 `destructiveHint: true` 与 `openWorldHint: true`。MCP-B 的 server/client 两条桥接分支采用相同清洗规则。

## Schema 与调用结果

- 输入按 JSON Schema 2020-12 校验。
- schema 受字节数、深度和 2048 节点上限约束。
- 不可信页面 schema 禁止 `pattern` 和 `patternProperties`，避免 JavaScript 正则阻塞事件循环。
- 输入、输出、每 source 队列和工具总数均有配置上限。
- 超时、传输断开或调用期间页面导航可能已经产生副作用，统一报告 `OUTCOME_UNKNOWN`，调用方不得自动重试非幂等操作。
