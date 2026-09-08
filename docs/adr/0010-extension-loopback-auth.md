# ADR 0010: Extension loopback 鉴权（Origin 校验 + 必填共享令牌）

日期：2026-09-07。状态：Accepted。

## 背景

ExtensionAdapter 在 `127.0.0.1:9334` 上接受任意 loopback 连接，且新连接会无条件顶替旧会话。两个后果：

1. 任意网页可以用 `new WebSocket("ws://127.0.0.1:9334")` 打进本机端口（浏览器只禁网页伪造 `Origin: chrome-extension://`，不禁连接本身），冒充扩展注册源与工具、接收调用结果。
2. 任何本机进程同样可以连上并抢在真扩展之前完成握手，把合法扩展顶下线。

同时，MV3 service worker 休眠导致的秒级断线会立即清空工具并广播 `tools/list_changed`，客户端（Cursor）表现为工具闪断甚至 server 判红（见 PROBLEMS 问题 3）。

## 决策

1. **Origin 校验（默认开启，不可关闭）**：握手 `Origin` 必须匹配 `chrome-extension://`，否则 `4003`。浏览器保证网页无法伪造该头，这挡住了远程网页 drive-by 这个现实威胁；Node 脚本可以伪造，但那已是本地恶意软件，超出本工具威胁模型。
2. **共享令牌（必填）**：yaml `browser.extension.authToken` / 环境变量 `MCP2WEBMCP_EXTENSION_TOKEN` 必须二选一设置，`hello` 必须携带相同 `token`，否则 `4001`；缺少令牌时 Gateway 拒绝以 extension 模式启动。扩展侧在 Side Panel 粘贴一次并存入 `chrome.storage.local`。不做自动配对（扩展读不了本地文件，native messaging 过重）。
3. **hello 之后才能接替会话**：新连接只有完成合法 hello 才会顶替旧连接；未 hello 的连接 10 秒超时关闭，不影响既有会话。
4. **断线宽限期**：hello 过的连接意外断开时，source 保留默认 15 秒（`disconnectGraceMs`，`0` 关闭），重连重放快照即恢复；期满才摘除工具。显式 `source.remove` 不等宽限。

## 后果

- 网页 drive-by 与"第二连接抢会话"被关死；令牌让介意本机其他进程的用户有可用闸门。
- extension 模式升级后必须同时配置 Gateway 和扩展令牌；协议版本提升为 2，旧扩展连接会以版本不匹配失败。
- 残余风险：本机恶意进程可伪造 Origin 头，但还必须获得共享令牌；宽限期内已断开的 source 仍会被投影，调用会以 `OUTCOME_UNKNOWN` 失败而不是静默消失。

实现见 `packages/browser-adapter/src/extension-adapter.ts`；协议说明见 `docs/extension-loopback-protocol.md`。
