# WebMCP Gateway

**mcp2webmcp** 把浏览器页面注册的 WebMCP 工具投影为 stdio MCP 工具，让 Cursor、Claude Desktop、Codex 等尚未直接接入 WebMCP 的客户端调用页面能力。

```text
页面 WebMCP → 浏览器接入 → Gateway Core → stdio MCP → MCP Client
```

Gateway 负责工具身份、生命周期、策略权威、同意、输入校验、审计和错误语义；浏览器扩展负责发现、搬运，并为本机用户提供 allow/confirm/deny 操作界面。规则仍由 Gateway 持久化和执行。项目当前没有 HTTP MCP 或远程管理面。需要 Node.js 22+ 与 [pnpm](https://pnpm.io/) 11。

## 快速开始：浏览器扩展

这是业务页面和日常使用的推荐路径，页面不需要加载 MCP-B embed。

1. 安装并构建：

   ```powershell
   pnpm install
   pnpm build
   ```

2. 在 `chrome://extensions` 或 `edge://extensions` 打开开发者模式，加载未打包目录 [`apps/extension`](apps/extension)。
3. 复制 [`configs/mcp-client.extension.example.json`](configs/mcp-client.extension.example.json) 到 MCP Client 配置，把 `REPO_ROOT` 换成仓库绝对路径，把令牌占位符换成随机长令牌。
4. 打开扩展底部“连接设置”，保存同一个令牌。Gateway 缺少令牌会拒绝启动。
5. 打开会调用 `registerTool` 的业务页面。也可启动无 embed 夹具：

   ```powershell
   $env:MCP2WEBMCP_E2E_FIXTURE_PORT = "18081"
   pnpm --filter @mcp2webmcp/webmcp-extension-demo-fixture start
   ```

   然后访问 [http://127.0.0.1:18081](http://127.0.0.1:18081)。

6. 重载 MCP Client 中的 `mcp2webmcp-extension-demo`，使用 `webmcp_list_tools` 检查页面工具。

完整的 Cursor / Claude Desktop 接线、验证和故障排查见 [连接 MCP Client](docs/connect-mcp-client.md)。不要把包含本机绝对路径或真实令牌的 `.cursor/mcp.json` 提交到 Git。

## 两种浏览器接入

| 接入方式                | 当前定位                     | 页面要求                                                                     | 示例与说明                                                                                                                    |
| ----------------------- | ---------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| MV3 Extension           | 推荐的业务接入               | 页面调用 `registerTool`；浏览器尚无原生 API 时由扩展提供可删除的兼容 runtime | [扩展说明](apps/extension/README.md)、[Extension fixture](packages/test-fixtures/webmcp-extension-demo/README.md)             |
| MCP-B cooperative embed | 保留的兼容与真实链路测试路径 | 页面显式加载 `@mcp-b/global` 和 MCP-B local-relay embed                      | [Cooperative fixture](packages/test-fixtures/webmcp-demo/README.md)、[接线说明](docs/connect-mcp-client.md#cooperative-embed) |

cooperative embed 并未删除：产品适配器位于 `packages/browser-adapter/src/mcpb-adapter.ts`，可运行夹具位于 `packages/test-fixtures/webmcp-demo`，配置是 [`configs/demo.yaml`](configs/demo.yaml)。它与扩展路径并行，但不是业务页面的默认推荐方案。

## 配置与边界

- Gateway 必须显式接收 `--config <yaml>` 或 `MCP2WEBMCP_CONFIG`，没有内置默认配置。
- 安装后的 CLI 名称是 `mcp2webmcp`，当前对外传输只有 stdio MCP。
- Extension loopback 默认监听 `127.0.0.1:9334`，同时校验 `chrome-extension://` Origin 和共享令牌。
- MCP-B relay 示例使用 `127.0.0.1:9333`；两个端口和配置不能混用。
- 页面 annotations 属于不可信自我申报，授权、schema 校验和审计在 Gateway 内执行。

## 文档

从 [文档总览](docs/README.md) 进入完整知识库。常用入口：

| 文档                                                           | 唯一职责                                   |
| -------------------------------------------------------------- | ------------------------------------------ |
| [当前架构](docs/current/architecture.md)                       | 系统边界、模块职责、接入链路和身份生命周期 |
| [当前配置](docs/current/configuration.md)                      | 配置 schema、环境变量、令牌与同意管理      |
| [当前安全模型](docs/current/security.md)                       | 信任边界、授权顺序与失败语义               |
| [运维与测试](docs/current/operations-and-testing.md)           | 日志、验证层级、故障定位与已知边界         |
| [连接 MCP Client](docs/connect-mcp-client.md)                  | Cursor / Claude Desktop 接线和验收         |
| [Extension loopback 协议](docs/extension-loopback-protocol.md) | 扩展与 Gateway 的 JSON 协议字段            |
| [开发指南](docs/develop.md)                                    | 贡献者本地工作流和变更验证矩阵             |

`docs/adr/` 与 `docs/spikes/` 是历史决策和实验记录，不表示当前功能状态；发生冲突时，以当前代码、配置 schema 和可执行测试为准。

## License

[MIT](LICENSE)
