# 把 WebMCP Gateway 接到桌面 MCP Client

产品对外标题是 **WebMCP Gateway**，仓库、包和 CLI 都是 **mcp2webmcp**。v0.1 只支持 **stdio MCP**；进程入口是 **`mcp2webmcp`**。每个 MCP 客户端对应 **一个 Gateway 进程**；多个客户端可以共享同一套 loopback relay（相同 `host` / `port` / `persistPath` / `relayId`）。

意图：让暂未支持 WebMCP 的 MCP 客户端调用页面工具。调用路径：WebMCP → Gateway → MCP。

两条接入：

1. **cooperative embed**（`configs/demo.yaml`）：页面除了 `registerTool` 还要加载 MCP-B embed。
2. **ExtensionAdapter**（`configs/extension-demo.yaml`）：加载 `apps/extension`，页面只需 `registerTool`（runtime 由扩展补，见 [ADR 0009](adr/0009-extension-webmcp-runtime-polyfill.md)），不要让扩展自己当 MCP server。

默认 Gateway 仍可以是 `adapter: mcpb`。扩展 loopback 默认 `127.0.0.1:9334`，不要占用 MCP-B 的 `9333`。

两条可以写在同一份 `.cursor/mcp.json` 里：**不要**用 extension yaml 覆盖旧的 `mcp2webmcp-demo` 条目。`mcp2webmcp-demo` 必须指向 `configs/demo.yaml`（9333）；`mcp2webmcp-extension-demo` 指向 `configs/extension-demo.yaml`（9334）。两条都指向 extension yaml 会 `EADDRINUSE`。ExtensionAdapter 没有 MCP-B 那种「发现已有 relay 再切 client」的行为。

## 10 分钟 Demo（Windows PowerShell）

仓库根目录：

```powershell
pnpm install
pnpm build
```

终端 1 — Gateway（stdio 由 MCP Client 拉起时也可跳过本终端，见下一节）：

```powershell
node apps/gateway/dist/main.js --config configs/demo.yaml
```

终端 2 — Demo 页（origin 必须是 `http://127.0.0.1:18080`，relay 端口必须是 `9333`，与 `configs/demo.yaml` 一致）：

```powershell
$env:MCP2WEBMCP_E2E_RELAY_PORT = "9333"
$env:MCP2WEBMCP_E2E_FIXTURE_PORT = "18080"
pnpm --filter @mcp2webmcp/webmcp-demo-fixture start
```

浏览器打开 `http://127.0.0.1:18080`，状态变为 `ready`。

终端 3 — 用参考客户端试一次（可选，需已 `pnpm build`）：把 Cursor / Claude 配好后，在对话里让它列出 tools 并调用 `echo`（参数 `{ "message": "hello" }`）。成功时应看到 `echo:hello`。

`configs/demo.yaml` 只 allow：`echo`、`get_page_title`、`add`。其它工具默认 deny。带 `destructiveHint` 的工具在无确认通道时 fail-closed，不会执行。

## Cursor

1. `pnpm build`。
2. 复制 `configs/mcp-client.example.json`。
3. 把其中所有 `REPO_ROOT` 换成仓库**绝对路径**（建议用正斜杠，例如 `D:/src/mcp2webmcp`）。`--config` 必须是绝对路径：Client 拉起进程时的 cwd 不一定是仓库根。
4. 放到 Cursor 的 MCP 配置里（常见为用户级 `mcp.json`，或项目 `.cursor/mcp.json`）。项目级 `.cursor/mcp.json` 含本机绝对路径，已加入 `.gitignore`，不要提交。
5. 启动 fixture 页面并打开 `http://127.0.0.1:18080`。
6. 重载 Cursor MCP 后应看到服务名 `mcp2webmcp-demo`，以及 `echo` / `get_page_title` / `add`（名称带 namespace 哈希，不是裸 `echo`）。

第二个 Cursor 窗口再开一个 Gateway 即可：沿用同一份 `configs/demo.yaml`，第二个进程会按 MCP-B client-mode 挂到已有 relay，不必再绑一个浏览器集群。

## ExtensionAdapter（无 embed）

1. `pnpm build`。
2. 加载未打包扩展：`chrome://extensions` / `edge://extensions` → `apps/extension`。
3. 夹具：

```powershell
$env:MCP2WEBMCP_E2E_FIXTURE_PORT = "18081"
pnpm --filter @mcp2webmcp/webmcp-extension-demo-fixture start
```

打开 `http://127.0.0.1:18081`。
4. 在项目 `.cursor/mcp.json` 里**增加** `mcp2webmcp-extension-demo`（模板 `configs/mcp-client.extension.example.json`），不要改掉已有 `mcp2webmcp-demo` 的 `demo.yaml`。
5. Cursor 服务名 `mcp2webmcp-extension-demo`。页面 `registerTool` 后 `webmcp_list_tools` 应看到该工具（`consented: true`）。不想给 MCP 用时调用 `webmcp_revoke_consent`（`origin` + 可选 `tool`）。

v0.1 扩展只连一个本机端口；多个 Gateway 进程如何共享同一条浏览器连接留到下一步。

协议细节：[extension-loopback-protocol.md](extension-loopback-protocol.md)。

## Claude Desktop

配置文件同样是 JSON 的 `mcpServers` 映射，字段与 `configs/mcp-client.example.json` 相同：`command` + `args`。把 `REPO_ROOT` 换成绝对路径后重启 Claude Desktop。

不要把 `apps/gateway` 配成 HTTP URL。v0.1 没有 HTTP MCP。

## 环境变量

仍使用品牌前缀 `MCP2WEBMCP_*`：

| 变量 | 作用 |
| --- | --- |
| `MCP2WEBMCP_CONFIG` | 等效 `--config` |
| `MCP2WEBMCP_ALLOWED_ORIGINS` | 逗号分隔，覆盖 yaml 里的 allowlist |
| `MCP2WEBMCP_LOG_LEVEL` | `debug` / `info` / `warn` / `error`（日志只应打 stderr，以免破坏 stdio MCP） |

## 常见问题

- **列表里没有页面工具**：mcpb 的 origin 必须与 `allowedOrigins` 逐字一致（含协议和端口）。`localhost` 和 `127.0.0.1` 不是同一个 origin。extension 在 `consent.enabled` 且 `allowedOrigins: []` 时会接入扩展看到的所有 origin。
- **工具在但调用失败 `POLICY_DENIED`**：default deny；若未开启 consent，allow 规则必须是精确 origin + 精确页面工具名。开启 consent 后，发现会自动放行；撤销用 `webmcp_revoke_consent`。yaml deny / `destructiveHint`→confirm 仍然优先。cooperative embed 经 MCP-B 时页面 `destructiveHint` 可能到不了 Gateway，对 `safe_backup` 这类工具要用 yaml 按 **originalName** 写 confirm。
- **`allowedOrigins: "*"`**：`mcpb` 与 `extension` adapter 均拒绝。
- **KnowMesh 等业务站**：用扩展路径时站点只 `registerTool`，runtime 由扩展补（[ADR 0009](adr/0009-extension-webmcp-runtime-polyfill.md)）。`configs/extension-demo.yaml` 默认空 allowlist + 同意账本；也可用 yaml `allowedOrigins` 锁死 origin。cooperative embed 路径仍见 `configs/example.yaml`。
- **relay 端口被占用**：同时改 `configs/demo.yaml` 的 `browser.mcpb.port` 和 fixture 的 `MCP2WEBMCP_E2E_RELAY_PORT`。

## 相关文件

- `configs/demo.yaml` — cooperative embed（fixture `:18080`，relay `:9333`）
- `configs/extension-demo.yaml` — ExtensionAdapter（fixture `:18081`，loopback `:9334`）
- `configs/mcp-client.example.json` / `configs/mcp-client.extension.example.json` — Cursor / Claude 模板
- `configs/example.yaml` — KnowMesh 风格示例（需自行改 origin/工具名）
- `packages/test-fixtures/webmcp-demo` — cooperative embed 页面
- `packages/test-fixtures/webmcp-extension-demo` — 无 embed 夹具
- `apps/extension` — 未打包 MV3 扩展
- [extension-loopback-protocol.md](extension-loopback-protocol.md) — 扩展 ↔ Gateway JSON
- [architecture.md](architecture.md) — 架构
- [develop.md](develop.md) — 测试与配置
- [adr/0009-extension-webmcp-runtime-polyfill.md](adr/0009-extension-webmcp-runtime-polyfill.md) — 扩展补页面 runtime
