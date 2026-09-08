# 文档总览

本目录按“当前事实、任务指南、协议规格、历史证据”分层。当前代码、配置 schema 和可执行测试是唯一真相源；文档用于解释和导航，不反向定义未实现能力。

## 当前知识库

[`current/`](current/README.md) 只描述当前实现，并按职责拆分：

| 文档                                                                   | 唯一职责                                         | 不应包含                       |
| ---------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------ |
| [current/architecture.md](current/architecture.md)                     | 系统边界、模块职责、两条接入链路、身份与生命周期 | 安装步骤、逐字段协议、历史方案 |
| [current/configuration.md](current/configuration.md)                   | 配置 schema、环境变量、Extension 配对、同意恢复  | 架构论证、通用故障排查         |
| [current/security.md](current/security.md)                             | 信任边界、授权顺序、不可信数据和失败语义         | 操作教程、测试命令             |
| [current/operations-and-testing.md](current/operations-and-testing.md) | 日志、运维定位、测试层级、发布前验证、已知边界   | 配置字段全集、协议字段全集     |

## 任务与参考文档

| 文档                                                                                                                   | 唯一职责                                               |
| ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| [../README.md](../README.md)                                                                                           | 项目定位、推荐快速开始和知识库入口                     |
| [connect-mcp-client.md](connect-mcp-client.md)                                                                         | Cursor / Claude Desktop 的接线、验证和客户端侧故障排查 |
| [develop.md](develop.md)                                                                                               | 贡献者本地开发流程与按改动类型选择验证项               |
| [extension-loopback-protocol.md](extension-loopback-protocol.md)                                                       | Extension ↔ Gateway 私有 JSON 协议的逐消息规格         |
| [../apps/extension/README.md](../apps/extension/README.md)                                                             | 未打包 MV3 扩展自身的加载与界面说明                    |
| [../packages/test-fixtures/webmcp-demo/README.md](../packages/test-fixtures/webmcp-demo/README.md)                     | cooperative embed 夹具的运行方式                       |
| [../packages/test-fixtures/webmcp-extension-demo/README.md](../packages/test-fixtures/webmcp-extension-demo/README.md) | 无 embed Extension 夹具的运行方式                      |

[`architecture.md`](architecture.md) 仅作为旧链接兼容入口，正文已合并到 `current/architecture.md`，不再维护第二份架构描述。

## 历史决策与实验

- [`adr/`](adr/)：当时的架构决策、约束和后果。除状态变更或事实勘误外不追改为当前教程。
- [`spikes/`](spikes/)：一次性实验结论和证据；对应源码位于仓库根目录 [`spikes/`](../spikes/README.md)。

已接受但尚未实现的产品决策必须在 ADR 中显式标注实现状态。[ADR 0011：Extension 策略控制面，Gateway 保持策略权威](adr/0011-extension-policy-control.md) 已实现，其当前使用方式归入 `current/` 文档。

历史文档与当前实现冲突时，从 `current/` 查当前说明，并回到源码与测试验证。

## 维护规则

1. 同一事实只在一个职责文档中完整描述，其它位置使用链接。
2. 根 README 只保留最短可运行路径，不复制配置 schema、协议字段或完整运维手册。
3. 新增或删除功能时，先更新对应 `current/` 文档；客户端步骤、协议字段和历史决策分别更新各自文档。
4. ADR 和 spike 不用于宣称功能已完成；完成状态必须有当前代码和测试证据。
5. 文档中的仓库相对链接必须通过 `pnpm docs:check`，示例命令必须对应现有 package script、配置文件和入口。
6. 临时计划、会话记录、截图和本机路径放在 `docs/local/` 或仓库外，不进入知识库。
