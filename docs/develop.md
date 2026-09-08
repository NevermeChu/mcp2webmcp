# 开发指南

本文只描述贡献者工作流。系统设计见 [当前架构](current/architecture.md)，配置与环境变量见 [当前配置](current/configuration.md)，运行日志和故障定位见 [运维与测试](current/operations-and-testing.md)。

## 本地准备

需要 Node.js 22+ 与 pnpm 11：

```powershell
pnpm install
pnpm build
```

`pnpm test` 中有测试会启动 `packages/mcp-transport/dist/fake-stdio-main.js`，首次运行或修改 TypeScript 后应先构建。

## 验证命令

```powershell
pnpm build
pnpm lint
pnpm test
pnpm test:e2e
pnpm test:e2e:extension
pnpm docs:check
pnpm format:check
```

- `pnpm test:e2e` 验证真实浏览器 cooperative MCP-B 链路。
- `pnpm test:e2e:extension` 验证加载未打包 MV3 扩展的无 embed 链路。
- 没有可用的 Edge/Chromium 时，先运行 `pnpm exec playwright install chromium`。

## 按改动选择验证

| 改动范围                             | 至少验证                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------- |
| `packages/protocol`、配置 schema     | `pnpm build`、`pnpm test`，并核对 `configs/` 和配置文档                           |
| Core、策略、路由、审计               | `pnpm build`、`pnpm test`；涉及浏览器生命周期时补对应 E2E                         |
| MCP transport 或 Gateway CLI         | `pnpm build`、`pnpm test`、`pnpm test:e2e`、`pnpm test:e2e:extension`             |
| `apps/extension` 或 Extension 协议   | `pnpm lint`、`pnpm test`、`pnpm test:e2e:extension`；协议字段变化同步更新协议文档 |
| MCP-B adapter 或 cooperative fixture | `pnpm test`、`pnpm test:e2e`                                                      |
| 仅文档                               | `pnpm docs:check`、`pnpm format:check`，并人工核对命令与当前脚本                  |

## 本地文件边界

- `.cursor/mcp.json`、`.env*`、日志、Playwright 产物和 `docs/local/` 不应提交。
- 不在 stdout 输出诊断信息，避免破坏 stdio MCP；运行日志写入 JSONL，详见 [运维与测试](current/operations-and-testing.md)。
- 修改 `packages/protocol`、Gateway TypeScript 或配置 schema 后重新构建；MCP Client 运行的是 `apps/gateway/dist`。
