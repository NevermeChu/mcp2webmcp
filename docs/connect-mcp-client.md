# 连接桌面 MCP Client

本文只说明 Cursor 与 Claude Desktop 的接线、验证和客户端侧故障排查。配置字段见 [当前配置](current/configuration.md)，系统边界见 [当前架构](current/architecture.md)。

## 前置条件

```powershell
pnpm install
pnpm build
```

当前对外传输只有 stdio MCP。MCP Client 应启动 `apps/gateway/dist/main.js` 或安装后的 `mcp2webmcp` CLI，不要配置 HTTP URL。源码方式必须使用配置文件的绝对路径，因为 Client 启动子进程时的工作目录不一定是仓库根目录。

## 选择浏览器接入

| 方式              | 适用场景                      | MCP 配置模板                                                                                | 浏览器侧                                       |
| ----------------- | ----------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| ExtensionAdapter  | 推荐；业务页面或无 embed 页面 | [`configs/mcp-client.extension.example.json`](../configs/mcp-client.extension.example.json) | 加载 `apps/extension`，页面调用 `registerTool` |
| cooperative embed | MCP-B 兼容与真实链路验证      | [`configs/mcp-client.example.json`](../configs/mcp-client.example.json)                     | 页面显式加载 MCP-B embed                       |

两种配置可同时存在，但服务名、yaml 和端口必须分别对应。不要让两个服务都使用 `configs/extension-demo.yaml`，否则会争用 9334。

## Cursor

1. 复制所选模板中的 `mcpServers` 条目到用户级或项目级 MCP 配置。
2. 把所有 `REPO_ROOT` 换成仓库绝对路径，Windows 也可使用正斜杠，例如 `D:/src/mcp2webmcp`。
3. Extension 模式还要把 `REPLACE_WITH_A_RANDOM_TOKEN` 换成随机长令牌。
4. 重载对应 MCP 服务。

项目级 `.cursor/mcp.json` 含本机路径和可能的令牌，已被忽略，不应提交。

## Claude Desktop

Claude Desktop 同样使用 `mcpServers` 映射以及 `command`、`args`、`env` 字段。复制相同模板、替换绝对路径和令牌后重启客户端。

## ExtensionAdapter

1. 在 `chrome://extensions` 或 `edge://extensions` 打开开发者模式，加载未打包目录 `apps/extension`。
2. 在扩展底部“连接设置”中保存 MCP 配置里的同一个共享令牌。
3. 打开会调用 `registerTool` 的页面。需要本地验证时启动夹具：

   ```powershell
   $env:MCP2WEBMCP_E2E_FIXTURE_PORT = "18081"
   pnpm --filter @mcp2webmcp/webmcp-extension-demo-fixture start
   ```

4. 访问 `http://127.0.0.1:18081`，重载 MCP 服务 `mcp2webmcp-extension-demo`。
5. 调用 `webmcp_list_sources` 和 `webmcp_list_tools`。示例页的 `echo` 工具应出现，并可接受 `{ "message": "hello" }`。

Extension Gateway 通常由 MCP Client 拉起，不需要再从终端启动第二份相同配置的进程。当前一个 Extension WebSocket 会话只对应一个 Gateway；它不具备 MCP-B relay 的多进程共享模式。

`configs/extension-demo.yaml` 使用空 `allowedOrigins`、本地同意账本和自动接纳。撤销使用 `webmcp_revoke_consent`；恢复是本机 CLI 管理动作，见 [同意管理](current/configuration.md#同意管理)。

扩展的安装与界面说明见 [apps/extension/README.md](../apps/extension/README.md)，协议字段见 [extension-loopback-protocol.md](extension-loopback-protocol.md)。

## Cooperative embed

该路径仍由产品代码支持，但主要用于 MCP-B 兼容和真实链路测试。页面实现及运行说明位于 [cooperative fixture README](../packages/test-fixtures/webmcp-demo/README.md)。

1. 启动 cooperative fixture：

   ```powershell
   $env:MCP2WEBMCP_E2E_RELAY_PORT = "9333"
   $env:MCP2WEBMCP_E2E_FIXTURE_PORT = "18080"
   pnpm --filter @mcp2webmcp/webmcp-demo-fixture start
   ```

2. 访问 `http://127.0.0.1:18080`，页面状态应变为 `ready`。
3. 使用 `configs/mcp-client.example.json` 配置并重载 `mcp2webmcp-demo`。
4. `webmcp_list_tools` 应列出 `echo`、`get_page_title`、`add` 对应的带命名空间工具。

`configs/demo.yaml` 的 origin、页面地址和 relay 端口必须一致。第二个 MCP-B Gateway 进程可按 client mode 加入已有 relay；这一行为只属于 MCP-B 路径。

## 验收标准

- MCP Client 显示 Gateway 已连接。
- `webmcp_runtime_status` 返回运行状态。
- `webmcp_list_sources` 能看到目标页面的精确 origin。
- `webmcp_list_tools` 能看到目标工具；投影名称带命名空间，不保证等于裸 `echo`。
- 调用示例 `echo` 返回 `echo:hello`。

## 客户端侧常见问题

- **启动时报缺少 Extension token**：MCP 配置的 `MCP2WEBMCP_EXTENSION_TOKEN` 未设置，或使用了 Extension yaml 却没有注入令牌。
- **扩展显示未连接**：检查扩展“连接设置”中的令牌与 MCP 配置一致，并确认没有旧进程占用 9334。
- **工具列表为空**：核对页面地址栏的精确 origin、同意账本和 policy；`localhost` 与 `127.0.0.1` 不是同一 origin。
- **`POLICY_DENIED`**：查看 Side Panel 的工具模式、同意状态和 yaml policy；插件活动页会显示 Gateway 拦截原因。
- **`CONFIRMATION_UNAVAILABLE`**：调用需要确认，但扩展已断线、没有可用确认通道或等待超时；工具未执行。
- **`EADDRINUSE`**：不要手动和 MCP Client 同时启动相同 Extension 配置；9333 属于 MCP-B relay，9334 属于 Extension loopback。
- **`OUTCOME_UNKNOWN`**：页面可能已经产生副作用，不要自动重试非幂等操作。

更完整的日志定位见 [运维与测试](current/operations-and-testing.md#快速定位)。
