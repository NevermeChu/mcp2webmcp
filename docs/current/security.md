# 当前安全模型

## 信任边界

- 页面、页面声明的工具描述、JSON Schema、annotations 和调用返回值均不可信。
- Extension 只负责发现和搬运；allowlist、同意、策略、输入校验、资源限制与审计只在 Gateway 执行。
- MCP 客户端身份目前是进程实例与自报名称，不是强认证身份；安全边界主要依赖本机进程边界、配置与策略。

## Extension loopback

- 仅允许 loopback bind。
- WebSocket 握手 Origin 必须为 `chrome-extension://...`。
- `browser.extension.authToken` 或 `MCP2WEBMCP_EXTENSION_TOKEN` 必填，长度 1–512；扩展底部“连接设置”保存相同令牌。
- 协议版本为 3；单帧最大 1 MiB，单次工具快照最多 500 项。
- 新连接只有通过 hello 后才替换旧会话。意外断线默认保留 source 15 秒，显式 `source.remove` 立即生效。

Origin 校验阻止普通网页直接连接；共享令牌进一步阻止仅伪造 Origin 的本机进程。令牌保存在扩展本地存储中，因此它不是对已攻陷浏览器配置文件的防护。

## 授权顺序

1. 适配器 origin allowlist 决定 source 是否进入 Core；
2. 精确的 Side Panel 用户覆盖（`origin + originalName`）优先；
3. 没有用户覆盖时取第一条匹配的 yaml policy 规则；
4. 没有规则匹配时，本地同意账本才可把默认 deny 提升为 allow；
5. confirm 仅在已鉴权 Extension 会话中等待一次性响应，否则以 `CONFIRMATION_UNAVAILABLE` fail-closed；
6. 放行前再次校验 source generation、输入大小和 schema；
7. 调用前审计写入失败则不执行。

Extension 默认配置启用 `autoAdmit`。工具发现时只会自动授予后续调用资格，不会立即执行；普通工具随后由 MCP Client 调用时通常直接放行。显式 yaml 规则优先于 consent，因此 yaml 中明确 allow 的工具不会因 consent revoke 而改变决策。

同意账本每次操作重新读取磁盘；写入使用跨进程锁、状态合并和原子替换。账本损坏或不可读时 fail-closed，且不会被自动接纳流程覆盖。MCP 可 revoke，但不能 restore。恢复命令见 [configuration.md](configuration.md)。

Extension Side Panel 是策略操作界面，但不是策略权威：它提交精确工具模式与一次性确认响应，Gateway 校验、持久化并最终裁决。策略拒绝与确认失败会回传活动页；参数只传字段摘要，不传值。见 [ADR 0011](../adr/0011-extension-policy-control.md)。

## 页面 annotations

页面不能自证安全。Gateway 丢弃 `readOnlyHint`、`idempotentHint` 和所有会放宽信任的 false 值，只保留 `destructiveHint: true` 与 `openWorldHint: true`。MCP-B 的 server/client 两条桥接分支采用相同清洗规则。

## Schema 与调用结果

- 输入按 JSON Schema 2020-12 校验。
- schema 受字节数、深度和 2048 节点上限约束。
- 不可信页面 schema 禁止 `pattern` 和 `patternProperties`，避免 JavaScript 正则阻塞事件循环。
- 输入、输出、每 source 队列和工具总数均有配置上限。
- 超时、传输断开或调用期间页面导航可能已经产生副作用，统一报告 `OUTCOME_UNKNOWN`，调用方不得自动重试非幂等操作。
