# ADR 0011：Extension 策略控制面，Gateway 保持策略权威

- Status: Accepted and implemented
- Date: 2026-09-08
- Implementation: Extension protocol v3; Gateway policy override store and confirmation provider implemented

## Context

Extension 模式当前采用 `consent.autoAdmit: true`：页面工具被发现后自动进入同意账本。没有匹配显式规则且未被撤销的普通工具，在 MCP Client 发起调用时可直接执行。注册只授予后续调用资格，不会在注册时执行工具。

协议 v3 已提供交互 provider。Gateway 在调用进入页面之前完成策略判断；命中 confirm 时挂起本次 MCP 调用，Side Panel 返回一次性决定。策略或确认拦截不会到达页面，但原因会回传 Side Panel 活动列表。

产品目标是保留“注册后默认可调用”的低摩擦体验，同时让本机用户在 Side Panel 中把某个精确的 `origin + originalName` 调整为直接调用、每次确认或禁止，并能看到调用未执行的原因。

## Decision

1. **Gateway 始终是策略权威。** allowlist、用户覆盖规则、yaml policy、consent、输入校验、资源限制、调用前审计和最终 `adapter.invokeTool()` 放行都在 Gateway 执行。扩展不得根据自己的 UI 状态直接放行页面调用。
2. **Extension 是本机策略控制面。** Side Panel 展示 Gateway 返回的有效模式和原因；用户操作通过已鉴权的 loopback 会话提交给 Gateway，由 Gateway 校验、持久化并返回确认结果。
3. **每个工具提供三个用户模式：**
   - `allow`：MCP Client 调用时直接执行；
   - `confirm`：每次调用先等待用户确认；
   - `deny`：拒绝调用。
4. **默认行为不变。** 没有用户覆盖时继续使用 yaml policy 与 consent；Extension 默认配置保持自动接纳，所以普通注册工具仍可直接调用。用户覆盖是精确的 `origin + originalName` 规则，不允许通配符。
5. **硬安全检查不可被 UI 覆盖。** loopback 鉴权、静态 origin allowlist、source generation、Schema/大小限制、取消/截止时间以及调用前审计失败始终可以拒绝调用。
6. **覆盖规则由 Gateway 持久化。** 不让扩展改写 yaml；状态文件采用跨进程锁、按更新时间合并和原子替换。每次变更在 Gateway 结构化运行日志记录操作者来源、旧模式、新模式和时间。
7. **确认由 Gateway 挂起和恢复。** Gateway 使用 MCP request ID，把 origin、工具、MCP Client、脱敏参数字段摘要和截止时间发给扩展。Side Panel 只返回本次允许或拒绝；Gateway 校验待处理 ID、已鉴权会话和截止时间，允许后再校验 source generation 才调用页面工具。断线、刷新、超时或 Gateway 重启均 fail-closed；仅关闭 Side Panel 不终止后台等待，到截止时间仍未响应才拒绝。
8. **策略拒绝对用户可见。** 对 Extension 来源的工具，Gateway 将 deny、确认拒绝和确认通道不可用的错误码与原因推给扩展。Side Panel 活动页显示原因；输入校验、审计失败等更早的 Core 错误仍以 MCP 错误和 Gateway 日志为准。
9. **协议与两端一起交付。** v3 同步加入策略快照/修改、决策事件与确认请求/响应，并由真实扩展 E2E 覆盖 allow、confirm、deny。

## Authority and precedence

调用时按以下层次处理：

1. 不可覆盖的传输、来源、generation、Schema、资源和审计安全检查；
2. Gateway 持久化的精确用户模式 `allow | confirm | deny`；
3. 没有用户覆盖时，执行现有 yaml policy 与 consent；页面 annotation 不自行升级或放宽用户模式；
4. 只有最终结果为 `allow` 才进入 BrowserAdapter。

Side Panel 显示的状态必须来自 Gateway，不能只根据页面提供的 `destructiveHint` 推断。页面 annotations 仍是不可信输入。

## Consequences

- 默认使用方式不增加点击步骤；只有用户设为 confirm 的工具才逐次询问。
- 用户可以在浏览器内管理策略，但实际规则仍由 Gateway 保存和执行，重启扩展不会丢失。
- loopback 共享令牌同时保护策略修改入口；任何策略变更都必须审计。
- MCP-B 模式不保证存在 Extension UI，继续依赖 yaml 和本机管理入口；不得为了复用 UI 把策略执行移入扩展。
- 策略操作依赖已鉴权的 Extension 会话；MCP-B 没有该确认 provider，命中 confirm 仍返回 `CONFIRMATION_UNAVAILABLE`。
