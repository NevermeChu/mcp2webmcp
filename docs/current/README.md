# 当前知识库

本目录描述当前实现，不替代 `docs/adr/` 与 `docs/spikes/` 中的历史决策记录。发生冲突时，以当前代码、配置 schema 与可执行测试为唯一真相源。

最后核对：2026-09-08，基于工作区实现。

| 文档                                                   | 内容                                         |
| ------------------------------------------------------ | -------------------------------------------- |
| [architecture.md](architecture.md)                     | 系统边界、组件职责、两条数据链路与关键不变量 |
| [security.md](security.md)                             | 信任边界、授权、页面元数据、调用结果语义     |
| [configuration.md](configuration.md)                   | 配置模型、环境变量、Extension 配对与同意恢复 |
| [operations-and-testing.md](operations-and-testing.md) | 日志、故障定位、测试层级与发布检查           |

协议字段的逐项说明见 [../extension-loopback-protocol.md](../extension-loopback-protocol.md)，桌面 MCP 客户端接线见 [../connect-mcp-client.md](../connect-mcp-client.md)。
