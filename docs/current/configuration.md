# 当前配置

Gateway 必须通过 `--config <yaml>` 或 `MCP2WEBMCP_CONFIG` 指定配置文件。配置对象及所有嵌套对象均为 strict schema，未知字段会导致启动失败；环境变量覆盖后会再次校验。

## 关键段落

| 路径                     | 作用                                           |
| ------------------------ | ---------------------------------------------- |
| `runtime`                | 名称、日志级别/路径/轮转大小、绝对调用截止时间 |
| `mcp.stdio.enabled`      | 是否启动 stdio MCP                             |
| `browser.adapter`        | `fake`、`mcpb` 或 `extension`                  |
| `browser.allowedOrigins` | 精确 origin；禁止 `*`                          |
| `browser.mcpb`           | relay 地址、持久化和 payload 限制              |
| `browser.extension`      | loopback 地址、必填令牌、调用超时、断线宽限期  |
| `policy`                 | 默认动作和 origin/tool/destructive 规则        |
| `consent`                | 是否启用、是否自动接纳、账本路径               |
| `audit`                  | 调用审计开关、路径和轮转大小                   |
| `limits`                 | 工具数、输入/输出、schema、队列限制            |

完整可运行示例位于 `configs/`。不要把真实令牌写入版本库。

## 环境变量

- `MCP2WEBMCP_CONFIG`：配置文件路径。
- `MCP2WEBMCP_ALLOWED_ORIGINS`：逗号分隔，覆盖 yaml allowlist。
- `MCP2WEBMCP_EXTENSION_TOKEN`：Extension 必填共享令牌，覆盖/补充 yaml。
- `MCP2WEBMCP_LOG_LEVEL`：`debug|info|warn|error`。
- `MCP2WEBMCP_LOG_PATH`：运行日志路径。

Extension 示例：

```powershell
$env:MCP2WEBMCP_EXTENSION_TOKEN = "生成一个随机长令牌"
node apps/gateway/dist/main.js --config configs/extension-demo.yaml
```

随后在扩展 Side Panel 保存同一个令牌。`configs/mcp-client.extension.example.json` 展示了由 MCP 客户端注入环境变量的结构。

## 同意管理

MCP 客户端可用 `webmcp_revoke_consent` 撤销 origin 或单个工具。恢复是本机管理动作：

```powershell
node apps/gateway/dist/main.js --config configs/extension-demo.yaml `
  --consent-restore-origin "https://example.com" `
  --consent-tool "tool_name"
```

省略 `--consent-tool` 可恢复整个 origin。命令修改共享账本；已运行 Gateway 会在下一次授权读取时看到新状态。若需要让已撤销的动态工具重新出现在 MCP `tools/list`，重启 Gateway 或让浏览器 source 重新建立。
