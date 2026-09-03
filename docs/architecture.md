# WebMCP Gateway（mcp2webmcp）— 初步实现架构文档

> 目标读者：Coding Agent / 项目实现者  
> 文档目的：用于直接启动 WebMCP Gateway 第一阶段工程实现，而不是仅作为概念设计说明。  
> 当前定位：**WebMCP interoperability runtime & compatibility gateway**，不是第二个 WebMCP polyfill，也不是单纯的协议转换器。  
> 命名：对外标题 **WebMCP Gateway**；仓库 / 包 / CLI / 配置 **mcp2webmcp**（`@mcp2webmcp/*`、命令 `mcp2webmcp`、`~/.mcp2webmcp`）。规格与图中统一称 **WebMCP Gateway**。  
> 意图：让暂未支持 WebMCP 的 MCP 客户端调用页面工具。调用路径：**WebMCP → Gateway → MCP**。

---

## 1. 项目定位

### 1.1 一句话定义

WebMCP Gateway（mcp2webmcp）是一个面向多 Agent、多浏览器上下文的 **WebMCP Runtime / Gateway**：

- 从支持 WebMCP 的网页发现和同步 tools；
- 管理多 browser / profile / tab / origin 下的 tool 生命周期；
- 为 tool 提供稳定、可预测的 namespace；
- 通过标准 MCP 暴露给 Claude Code、Codex、Cursor、OpenCode、AgentMesh 等 Agent；
- 在调用前执行权限、确认、路由和审计策略；
- 将具体 WebMCP 兼容实现尽量交给 MCP-B 等现有组件，而把项目重点放在 runtime、routing、policy 和 multi-agent integration 上。

### 1.2 核心原则

1. **网站的业务工具只按 WebMCP 定义，不依赖 WebMCP Gateway 私有 SDK。** v0.1 允许测试页显式加载 MCP-B embed 作为 transport bridge；长期产品形态由浏览器扩展建立连接，使业务网站无需感知 WebMCP Gateway。
2. **协议兼容尽量复用，不重复实现 WebMCP 标准细节。**
3. **Runtime Core 与 Browser 接入方式解耦。**
4. **Runtime Core 与 MCP Transport 解耦。**
5. **多来源 tool 必须拥有稳定身份，不允许只靠 tool name 判断来源。**
6. **权限控制必须发生在 tool invocation 之前。**
7. **所有动态注册、注销、tab reload、disconnect 都必须可观测且可恢复。**
8. **MVP 优先打通真实链路，再扩展远程、多浏览器、策略中心等能力。**
9. **先验证真实兼容层，再固化 Core。** MCP-B 的公共 API、进程模型和真实浏览器链路必须在大规模实现前完成可行性验证。
10. **页面提供的 tool descriptor 和 annotations 均属于不可信输入。** 它们可以帮助提高风险等级，但不能单独成为自动放行依据。

---

## 2. 非目标

第一阶段不要做：

- 不重新实现完整 WebMCP specification。
- 不自行维护一套 WebMCP polyfill，优先复用 MCP-B。
- 不做通用浏览器自动化平台。
- 不做网页 DOM agent / computer-use agent。
- 不做完整 AgentMesh orchestrator。
- 不做云端 SaaS 控制台。
- 不支持所有浏览器。
- 不在 MVP 中实现复杂 RBAC/ABAC UI。
- 不在 MVP 中实现远程浏览器集群。

---

## 3. 目标架构

```text
┌─────────────────────────────────────────────────────────────┐
│                      Web Applications                       │
│                                                             │
│   KnowMesh           GitHub-like App        Other WebMCP   │
│       │                    │                      │          │
│       └──── document.modelContext / WebMCP ──────┘          │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                   Browser Integration Layer                 │
│                                                             │
│  ExtensionAdapter   CDPAdapter   PlaywrightAdapter          │
│        │                │               │                    │
│        └────────────────┴───────────────┘                    │
│                         │                                   │
│                  BrowserEventStream                         │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                   WebMCP Gateway Core                       │
│                                                             │
│  SourceRegistry                                             │
│  ToolRegistry                                               │
│  NamespaceResolver                                          │
│  ToolRouter                                                 │
│  LifecycleManager                                           │
│  PolicyEngine                                               │
│  ConfirmationManager                                        │
│  AuditLogger                                                │
│  RuntimeEventBus                                            │
│                                                             │
└─────────────────────────┬───────────────────────────────────┘
                          │
              ┌───────────┼───────────────┐
              │           │               │
              ▼           ▼               ▼
         MCP stdio   Streamable HTTP   Runtime API
              │           │               │
              ▼           ▼               ▼
        Claude Code     Codex         AgentMesh
        Cursor          OpenCode      Custom Agent
```

### 3.1 v0.1 进程拓扑

v0.1 采用“每个 MCP Client 一个 stdio Gateway、共享浏览器 relay 连接”的拓扑：

```text
Claude / Codex / Cursor
        │ each client owns one stdio process
        ▼
WebMCP Gateway process
        │ policy and audit are isolated per client process
        ▼
shared MCP-B relay / browser connection cluster
        │
        ▼
Browser tabs
```

因此 v0.1 的“多 Agent”准确含义是：多个 Agent 可以共享同一组浏览器连接，但每个 Agent 的策略、审计和 Runtime 内存状态仍由自己的 Gateway 进程持有。统一的常驻 Runtime daemon、跨进程集中策略和统一审计属于第二阶段。

如果 MCP-B 当前的 client/server promotion 机制不能在不泄漏其私有协议的前提下支持上述拓扑，必须停在 Phase -1 重新选择接入方式，不得用复制 MCP-B 内部实现的方式绕过。

---

## 4. 推荐技术栈

### 4.1 Runtime

- TypeScript
- Node.js 22+
- pnpm workspace
- Zod：运行时 schema validation
- Vitest：单元测试
- Playwright：E2E / fallback adapter
- `ws`：本地 WebSocket transport（如需要）
- MCP SDK：优先采用当前官方 `@modelcontextprotocol/*` 组件
- MCP-B：优先用于 WebMCP compatibility / polyfill / relay 能力

### 4.2 第一阶段建议

不要一开始把 MCP-B 的 local relay 完整 fork 进来。

建议：

```text
WebMCP Gateway Core
        │
        ├── MCP-B Runtime Adapter
        │
        ├── Extension Adapter
        │
        └── Playwright Adapter
```

MCP-B 是一个 dependency / backend，而不是 WebMCP Gateway 自身架构中心。

---

## 5. Monorepo 目录结构

建议初始目录：

```text
mcp2webmcp/
├─ apps/
│  ├─ gateway/
│  │  ├─ src/
│  │  │  ├─ main.ts
│  │  │  ├─ bootstrap.ts
│  │  │  └─ config.ts
│  │  └─ package.json
│  │
│  └─ extension/
│     ├─ src/
│     └─ package.json
│
├─ packages/
│  ├─ core/
│  │  ├─ src/
│  │  │  ├─ registry/
│  │  │  │  ├─ source-registry.ts
│  │  │  │  └─ tool-registry.ts
│  │  │  ├─ routing/
│  │  │  │  ├─ namespace-resolver.ts
│  │  │  │  └─ tool-router.ts
│  │  │  ├─ lifecycle/
│  │  │  │  └─ lifecycle-manager.ts
│  │  │  ├─ policy/
│  │  │  │  ├─ policy-engine.ts
│  │  │  │  └─ confirmation-manager.ts
│  │  │  ├─ audit/
│  │  │  │  └─ audit-logger.ts
│  │  │  ├─ events/
│  │  │  │  └─ runtime-event-bus.ts
│  │  │  └─ index.ts
│  │  └─ package.json
│  │
│  ├─ protocol/
│  │  ├─ src/
│  │  │  ├─ source.ts
│  │  │  ├─ tool.ts
│  │  │  ├─ events.ts
│  │  │  ├─ invoke.ts
│  │  │  └─ schemas.ts
│  │  └─ package.json
│  │
│  ├─ browser-adapter/
│  │  ├─ src/
│  │  │  ├─ browser-adapter.ts
│  │  │  ├─ extension-adapter.ts
│  │  │  ├─ playwright-adapter.ts
│  │  │  └─ mcpb-adapter.ts
│  │  └─ package.json
│  │
│  ├─ mcp-transport/
│  │  ├─ src/
│  │  │  ├─ stdio-server.ts
│  │  │  ├─ http-server.ts
│  │  │  ├─ tool-projector.ts
│  │  │  └─ management-tools.ts
│  │  └─ package.json
│  │
│  └─ test-fixtures/
│     ├─ webmcp-demo/
│     └─ fake-adapter/
│
├─ configs/
│  └─ example.yaml
├─ docs/
├─ tests/
│  ├─ integration/
│  └─ e2e/
├─ package.json
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
└─ README.md
```

MVP 不必一次创建全部包，但 `core / protocol / browser-adapter / mcp-transport` 四层边界应从第一天保留。

---

## 6. 核心领域模型

### 6.1 Browser Source

一个 source 表示一个能够暴露 WebMCP tools 的具体运行上下文。

```ts
export interface BrowserSource {
  // Core-visible adapter instance identity. Multiple adapters of the same
  // type must still have different adapterId values.
  adapterId: string;
  sourceId: string;

  // Incremented whenever reload, navigation, reconnect, or frame recreation
  // invalidates previously discovered descriptors.
  generation: number;

  browserId: string;
  profileId?: string;

  tabId: string;
  frameId?: string;

  origin: string;
  url: string;
  title?: string;

  adapterType:
    | "extension"
    | "cdp"
    | "playwright"
    | "mcpb";

  connectedAt: number;
  updatedAt: number;

  state:
    | "connected"
    | "stale"
    | "disconnected";
}
```

### 6.2 Tool Identity

不要直接使用 WebMCP 原始 `name` 作为内部主键。

```ts
export interface ToolIdentity {
  sourceId: string;
  sourceGeneration: number;
  originalName: string;

  runtimeId: string;
  mcpName: string;
}
```

建议：

```text
runtimeId =
  hash(<adapterId>/<sourceId>/<sourceGeneration>/<toolName>)
```

`sourceId` 表示 adapter 观察到的逻辑 browser context，`generation` 表示该 context 当前可调用的连接世代。reload、跨 origin 导航、frame 重建或重连必须递增 generation；旧 generation 上的 tool 不允许继续执行。

MCP 暴露名使用“可读前缀 + canonical identity 的短 hash”，必须 deterministic、能够反向定位当前 source，且不超过 MCP tool name 的 128 字符建议上限。v0.1 不承诺跨 reload 保持同一个 MCP 名称；稳定 workspace alias 放到第二阶段。

示例：

```text
原始：
search_documents

内部：
rt_a81f2c9e...

MCP：
knowmesh__tab18__search_documents
```

后续可以增加 workspace 级别 alias：

```text
knowmesh__workspace_123__search_documents
```

---

## 7. Tool Descriptor

```ts
export interface RuntimeTool {
  identity: ToolIdentity;

  // BrowserSource is authoritative in SourceRegistry. Do not embed a mutable
  // source snapshot here.
  sourceId: string;
  sourceGeneration: number;

  description?: string;
  inputSchema: Record<string, unknown>;

  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };

  discoveredAt: number;
  updatedAt: number;

  status:
    | "available"
    | "stale"
    | "unavailable";
}
```

不能假设所有 WebMCP runtime 都能提供完全一致的 annotation，因此 annotations 应全部 optional。

---

## 8. Browser Adapter 接口

所有 Browser backend 必须实现相同接口。

```ts
export interface BrowserAdapter {
  readonly adapterId: string;
  readonly type: string;

  start(): Promise<void>;
  stop(): Promise<void>;

  listSources(): Promise<BrowserSource[]>;
  listTools(sourceId: string): Promise<RuntimeTool[]>;

  invokeTool(
    request: BrowserToolInvokeRequest,
    options: {
      signal: AbortSignal;
      deadline: number;
    }
  ): Promise<BrowserToolInvokeResult>;

  subscribe(
    handler: (event: BrowserAdapterEvent) => void
  ): () => void;
}
```

Core 还必须维护 adapter instance 路由，不能只根据 `adapterType` 找 adapter：

```ts
export interface AdapterRegistry {
  register(adapter: BrowserAdapter): void;
  unregister(adapterId: string): void;
  get(adapterId: string): BrowserAdapter | undefined;
}
```

`sourceId` 必须在 `adapterId` 命名空间内唯一；Core 对外使用的 source key 应由两者共同组成。

事件定义：

```ts
export interface BrowserAdapterEventMeta {
  adapterId: string;
  sourceId: string;
  sourceGeneration: number;
  revision: number;
}

export type BrowserAdapterEvent = BrowserAdapterEventMeta & (
  | {
      type: "source.connected";
      source: BrowserSource;
    }
  | {
      type: "source.updated";
      source: BrowserSource;
    }
  | {
      type: "source.disconnected";
      sourceId: string;
    }
  | {
      type: "tool.registered";
      tool: RuntimeTool;
    }
  | {
      type: "tool.updated";
      tool: RuntimeTool;
    }
  | {
      type: "tool.unregistered";
      runtimeId: string;
    }
);
```

### 8.1 Adapter 产品化顺序

Phase -1 真实链路 Gate 通过后的实现优先级：

1. `FakeBrowserAdapter`
2. `McpBAdapter`（v0.1 cooperative page mode）
3. `ExtensionAdapter`（长期 zero-integration 产品路径）
4. `PlaywrightAdapter`
5. CDPAdapter
6. RemoteBrowserAdapter

先用 FakeAdapter 把 Core 和 MCP server 测通，再接真实 WebMCP。

---

## 9. SourceRegistry

职责：

- 保存当前所有 browser source；
- 去重；
- 跟踪 connected / disconnected；
- 维护更新时间；
- 提供按 origin / browser / tab 查询。

接口：

```ts
export interface SourceRegistry {
  upsert(source: BrowserSource): void;
  remove(sourceId: string): void;

  get(sourceId: string): BrowserSource | undefined;
  list(): BrowserSource[];

  findByOrigin(origin: string): BrowserSource[];
}
```

---

## 10. ToolRegistry

职责：

- 保存所有 tool；
- 根据 source 动态增删；
- 保证 `runtimeId` 唯一；
- 负责 MCP tool projection 的上游数据；
- tool reload 后替换 descriptor；
- source disconnect 后批量失效。

```ts
export interface ToolRegistry {
  register(tool: RuntimeTool): void;

  unregister(runtimeId: string): void;

  unregisterBySource(sourceId: string): void;

  get(runtimeId: string): RuntimeTool | undefined;

  getByMcpName(mcpName: string): RuntimeTool | undefined;

  list(): RuntimeTool[];
}
```

必须维护：

```text
runtimeId -> RuntimeTool
mcpName   -> runtimeId
sourceId  -> Set<runtimeId>
```

---

## 11. NamespaceResolver

这是 WebMCP Gateway 的核心差异化组件之一。

### 11.1 必须解决

不同 tab 可能同时注册：

```text
search
create
delete
update
```

不能简单 suffix 一个随机 ID 后就结束。

### 11.2 MVP 命名策略

输入：

```text
origin = https://knowmesh.app
tabId = 18
tool = search_documents
```

输出：

```text
knowmesh__tab18__search_documents
```

实际实现必须在规范化名称末尾保留 canonical identity 的短 hash，例如：

```text
knowmesh__tab18__search_documents__a81f2c
```

这样即使域名、tab label、截断结果或非法字符归一化后相同，也不会依赖注册顺序生成 `_2`、`_3`。hash 输入至少包含 `adapterId / sourceId / sourceGeneration / originalName`。

域名归一化规则：

```text
app.knowmesh.com -> app_knowmesh
docs.google.com  -> docs_google
github.com       -> github
```

如果只有一个来源，管理 API 可以显示较短的 display alias：

```text
knowmesh__search_documents
```

但 v0.1 不把会随来源数量变化的 alias 注册成第二个可调用 MCP tool，避免第二个 tab 出现时已有名称发生歧义或 churn。

同时：

**内部 routing 只能使用 runtimeId，不能依赖 alias。**

---

## 12. ToolRouter

完整调用流程：

```text
MCP Client
   │
   │ call_tool(name, input)
   ▼
MCP Transport
   │
   ▼
ToolRouter
   │
   ├─ Resolve MCP name
   ├─ Validate tool state
   ├─ Validate source state
   ├─ PolicyEngine.evaluate()
   ├─ ConfirmationManager
   ├─ BrowserAdapter.invokeTool()
   ├─ Normalize result
   └─ Audit
```

接口：

```ts
export interface ToolRouter {
  invoke(
    request: RuntimeInvokeRequest,
    options: {
      signal: AbortSignal;
      deadline: number;
    }
  ): Promise<RuntimeInvokeResult>;
}
```

最小 request / result contract：

```ts
export interface RuntimeInvokeRequest {
  requestId: string;
  target:
    | { mcpName: string }
    | { runtimeId: string };
  input: unknown;
  client: {
    // Generated by this Gateway process; not supplied by the page.
    processInstanceId: string;
    // Informational only in v0.1 and not a trusted authorization identity.
    claimedName?: string;
  };
}

export type RuntimeInvokeResult =
  | {
      status: "success";
      content: unknown[];
      structuredContent?: unknown;
      sourceGeneration: number;
    }
  | {
      status: "error";
      error: {
        code: RuntimeErrorCode;
        message: string;
      };
      outcome: "not_executed" | "executed_failed" | "unknown";
    }
  | {
      // Reserved for a future supported approval channel.
      status: "confirmation_required";
      confirmationId: string;
      summary: string;
    };
```

MCP Transport 负责把内部结果映射为 MCP protocol error 或 `CallToolResult.isError`，映射表必须集中定义并测试，不能由各 BrowserAdapter 自行决定。

---

## 13. Policy Engine

MVP 就要存在，但第一版可以很简单。

### 13.1 策略结果

```ts
export type PolicyDecision =
  | {
      action: "allow";
    }
  | {
      action: "deny";
      reason: string;
    }
  | {
      action: "confirm";
      reason: string;
    };
```

### 13.2 Policy Context

```ts
export interface PolicyContext {
  client?: {
    clientId?: string;
    name?: string;
  };

  tool: RuntimeTool;

  // Resolved from SourceRegistry for this exact generation.
  source: BrowserSource;

  input: unknown;
}
```

### 13.3 MVP 决策语义

v0.1 的执行面只存在两个最终结果：

```text
allow -> execute
deny  -> do not execute
```

`confirm` 保留在领域模型中，表示该调用原则上需要人工确认；但在没有受支持的确认通道时必须 fail closed，最终按 `deny` 处理并返回 `CONFIRMATION_UNAVAILABLE`。不得把自定义 `confirmation_required` 当作所有 MCP Client 都能恢复的标准交互流程。

### 13.4 示例配置

```yaml
policy:
  default: deny

  rules:
    - match:
        origin: "https://knowmesh.app"
        tool: "search_documents"
      action: allow

    - match:
        origin: "https://knowmesh.app"
        tool: "get_document"
      action: allow

    - match:
        destructive: true
      action: confirm

    - match:
        tool: "delete_*"
      action: confirm
```

MVP 可以只支持：

- origin
- exact original tool name
- destructiveHint

tool glob 只能用于 `deny` 或 `confirm` 规则，不能用于自动 `allow`。`readOnlyHint`、`destructiveHint` 等页面声明只能将风险升级，不能把原本未授权的调用降级为 allow。

自动 allow 至少必须同时匹配：

```text
backend-observed exact origin
        +
exact original tool name
        +
explicit local policy rule
```

后续再加入可信 agent identity / workspace / profile / time / schema digest / input-sensitive policy。

---

## 14. ConfirmationManager

不要把“确认”写死在 MCP transport。

未来存在受支持的审批 UI、MCP elicitation 或本地审批 API 时，Core 可以返回：

```ts
{
  status: "confirmation_required",
  confirmationId: "...",
  summary: "..."
}
```

由上层 integration 决定如何确认。

v0.1 没有确认 UI，因此所有 `confirm` decision 必须按 deny 结束。v0.1 不提供全局 `--auto-approve`。

未来启用确认时，`confirmationId` 必须：

- 绑定可信 client identity；
- 绑定 `runtimeId`、`sourceGeneration` 和规范化 input digest；
- 单次使用并在短时间内过期；
- 执行前再次验证 source generation、descriptor 和 policy；
- 不允许通过修改参数复用已经批准的 confirmation。

---

## 15. AuditLogger

每次调用至少记录：

```ts
export interface AuditRecord {
  requestId: string;

  timestamp: number;

  clientId?: string;

  runtimeToolId: string;
  mcpToolName: string;

  sourceId: string;
  origin: string;

  decision:
    | "allow"
    | "deny"
    | "confirm";

  durationMs?: number;
  success?: boolean;

  errorCode?: string;

  // Never store raw input. An optional digest can correlate an approval and
  // execution without exposing its content.
  inputDigest?: string;
}
```

默认禁止记录：

- Cookie
- Authorization header
- 页面 localStorage 内容
- 未经处理的敏感 tool input
- tool 原始返回全文

MVP 输出 JSONL：

```text
~/.mcp2webmcp/logs/audit.jsonl
```

AuditLogger 还必须定义：

- 文件仅当前用户可读写；
- 单条记录通过 JSON serializer 写入，不允许字符串拼接产生 JSONL injection；
- 文件大小上限和轮转策略；
- invalid input、unknown tool、policy deny、timeout、cancel 和 outcome unknown 都必须留痕；
- 日志失败不能静默放行高风险调用，并且不能导致 tool 被重复执行。

---

## 16. Runtime Event Bus

Runtime 内部所有动态变化都通过统一事件总线传播。

```ts
export interface RuntimeEventMeta {
  runtimeRevision: number;
  timestamp: number;
}

export type RuntimeEvent = RuntimeEventMeta & (
  | { type: "source.added"; source: BrowserSource }
  | {
      type: "source.removed";
      sourceId: string;
      sourceGeneration: number;
    }
  | { type: "tool.added"; tool: RuntimeTool }
  | { type: "tool.updated"; tool: RuntimeTool }
  | {
      type: "tool.removed";
      runtimeId: string;
      sourceId: string;
      sourceGeneration: number;
    }
);
```

用途：

- MCP dynamic tool sync
- 日志
- DevTools
- AgentMesh integration
- Web UI

MVP 可以使用轻量 in-process event emitter。

---

## 17. MCP Transport

### 17.1 MVP

只实现：

```text
stdio MCP Server
```

不要一开始做 HTTP。

### 17.2 固定管理工具

建议始终暴露：

```text
webmcp_list_sources
webmcp_list_tools
webmcp_get_tool
webmcp_runtime_status
```

后续增加：

```text
webmcp_connect_source
webmcp_disconnect_source
webmcp_refresh_source
```

### 17.3 Dynamic Tools

RuntimeTool 应投影成真正的 MCP tool。

例如：

```text
knowmesh__tab18__search_documents
```

MCP Client 可直接调用，而不是强制：

```text
webmcp_call_tool({
  name: "...",
  args: ...
})
```

后者可以保留作为 debug / fallback management tool，但不应成为主要 UX。

---

## 18. MCP Dynamic Tool Synchronization

MCP dynamic tool synchronization 是 capability-gated 能力。Server 必须声明并发送 tool-list change；Client 是否实际订阅并刷新必须通过兼容性测试确认。对于不支持动态刷新或未建立对应订阅的 Client，固定管理工具 `webmcp_list_tools` 和 `webmcp_call_tool` 是明确的 fallback，而不是假设 dynamic tool 一定立即出现。

发生：

```text
tool.registered
```

时：

```text
ToolRegistry
   ↓
MCP ToolProjector
   ↓
MCP Server tool list changed
```

发生：

```text
tab reload
```

必须：

1. 将旧 source 标记 stale；
2. 暂停 invocation；
3. 新 connection 建立；
4. 对比 tool set；
5. 更新 registry；
6. 发布 MCP tools changed。

绝不能在 tab reload 后继续持有旧 descriptor 并直接调用。

### 18.1 Snapshot / Event 一致性

`listSources()` / `listTools()` 与 `subscribe()` 之间存在竞态。Adapter 必须提供可实现下列任一策略的 revision：

1. 原子 snapshot + 从该 revision 之后开始订阅；或
2. 先订阅、再获取带 revision 的 snapshot，随后按 revision 去重并 reconcile。

所有 adapter event 至少携带 `adapterId`、`sourceId`、`sourceGeneration` 和单调递增的 `revision`。Core 必须忽略旧 generation 或旧 revision 的迟到事件。

每次调用在 policy evaluate 时捕获 source generation，并在真正 dispatch 前再次比较。generation 已变化时返回 `TOOL_UNAVAILABLE`，不得把调用发送给新页面上的同名工具。

### 18.2 Tool exposure budget

Runtime 可以发现的工具不等于必须全部投影给 MCP Client。v0.1 必须支持：

- allowed origin 过滤；
- 每个 source 和整个 server 的最大动态 tool 数量；
- `tools/list` 分页；
- 超限时保留固定管理工具并给出可观测错误；
- 不为 display alias 重复注册同一个可调用 tool。

---

## 19. Error Model

定义内部统一错误：

```ts
export type RuntimeErrorCode =
  | "TOOL_NOT_FOUND"
  | "TOOL_UNAVAILABLE"
  | "SOURCE_NOT_FOUND"
  | "SOURCE_DISCONNECTED"
  | "POLICY_DENIED"
  | "CONFIRMATION_REQUIRED"
  | "CONFIRMATION_UNAVAILABLE"
  | "INVALID_INPUT"
  | "CANCELLED"
  | "INVOCATION_TIMEOUT"
  | "OUTCOME_UNKNOWN"
  | "RESULT_TOO_LARGE"
  | "RATE_LIMITED"
  | "BROWSER_ERROR"
  | "WEBMCP_ERROR"
  | "INTERNAL_ERROR";
```

Browser Adapter 错误必须先归一化，再进入 MCP transport。

---

## 20. Timeout

推荐外部 deadline 上限：

```text
total invocation deadline: 65 s
```

必须支持 config。

如果底层 MCP-B relay 自身已有 60/65 秒两级 timeout，Gateway 不应再机械叠加一套独立计时器。`ToolRouter` 应计算一个 absolute deadline 并把剩余预算传给 adapter，由 adapter 映射为底层 timeout。

调用 timeout 后：

- 标记 request failed；
- 不直接将 source 判定 disconnected；
- 连续 N 次 browser transport error 才改变 source health。

同时必须：

- 触发 AbortSignal，尽最大可能取消浏览器执行；
- 如果无法证明副作用尚未发生，返回 `OUTCOME_UNKNOWN` 而不是普通失败；
- 不自动重试非明确只读且幂等的调用；
- v0.1 默认同一 source 串行执行 tool invocation，并对排队数量设置上限；
- Client 取消、Gateway shutdown、source disconnect 都必须传播 cancellation。

---

## 21. 配置文件

示例：

```yaml
runtime:
  name: mcp2webmcp
  logLevel: info

mcp:
  stdio:
    enabled: true

browser:
  adapter: mcpb

  allowedOrigins:
    - "https://knowmesh.app"

policy:
  default: deny

  rules:
    - match:
        origin: "https://knowmesh.app"
        tool: "search_documents"
      action: allow

    - match:
        origin: "https://knowmesh.app"
        tool: "get_document"
      action: allow

audit:
  enabled: true
  path: "~/.mcp2webmcp/logs/audit.jsonl"

limits:
  maxToolsPerSource: 100
  maxToolsTotal: 500
  maxInputBytes: 1048576
  maxOutputBytes: 4194304
  maxSchemaBytes: 262144
  maxQueuePerSource: 16
```

环境变量覆盖：

```text
MCP2WEBMCP_LOG_LEVEL
MCP2WEBMCP_ALLOWED_ORIGINS
MCP2WEBMCP_CONFIG
```

---

## 22. 安全边界

### 22.1 默认原则

Gateway 默认：

```text
loopback only
```

不要默认监听：

```text
0.0.0.0
```

### 22.2 Origin

Web source 必须有真实 origin。

生产模式默认不接受：

```text
allowedOrigins: "*"
```

### 22.3 Source 身份

不要信任网页主动提交的：

```text
origin
url
tabId
```

如果 browser backend 能从浏览器 API / Extension / CDP 获取这些信息，应优先使用 backend-observed metadata。

### 22.4 Tool 输入

调用前：

```text
MCP input
   ↓
JSON Schema validation
   ↓
Policy
   ↓
WebMCP
```

Zod 用于验证外部 descriptor 和 Runtime protocol envelope；它不等同于任意 JSON Schema 参数验证器。v0.1 必须明确支持的 JSON Schema dialect，并使用 MCP SDK 提供的 validator 或 Ajv 等专用实现校验 tool arguments。Schema 编译必须缓存，并受 schema 大小、递归深度和编译时间限制。

### 22.5 Tool 输出

MVP 做结构化透传/归一化，但 maximum output size、允许的 content type、嵌套深度和序列化失败处理必须从第一版存在。超限结果返回 `RESULT_TOO_LARGE`，不得先把完整内容写入 audit 或 debug log。

内容过滤和 secret masking 可以后续增加，但不得把它们描述为可靠的数据泄漏防线；真正的防线仍是 origin allowlist、tool policy 和最小权限。

### 22.6 Local relay 不是认证边界

loopback bind 只能阻止局域网直接访问，不能认证本机进程，也不能自动阻止浏览器中任意网站尝试连接 localhost。生产配置必须：

- 显式配置 allowed origins，禁止 `*`；
- 使用 browser backend 观察到的 WebSocket Origin / tab metadata；
- secure mode 拒绝 Origin 缺失后退到页面自报 origin 的连接；
- 不把 MCP initialize 中客户端自报的 name 当作可信 agent identity；
- 在引入集中 daemon 或 HTTP transport 时增加独立的本地客户端认证和 session binding。

---

## 23. MCP-B 集成原则

截至开始实现前的依赖验证快照，MCP-B WebMCP Local Relay 已经提供：

- Browser WebMCP tool discovery
- 动态 tool synchronization
- 多 tab tool aggregation
- stdio MCP
- tool name conflict disambiguation
- localhost relay
- origin restrictions
- multi-client relay sharing / promotion
- payload and invocation timeout limits

因此不要把这些现成功能重新实现一遍作为 MVP 的主要工作，也不得在没有差异化需求和契约测试的情况下维护第二套 registry、naming 或 relay。

### WebMCP Gateway 应优先在 MCP-B 之上增加：

```text
稳定 Source Identity
      +
稳定 Tool Identity
      +
Namespace
      +
Routing
      +
Policy
      +
Audit
      +
Multi-agent abstraction
      +
多 BrowserAdapter
```

### 推荐实现方式

先通过 Phase -1 验证以下优先顺序：

1. 使用 MCP-B 已发布的稳定 public API 在进程内组合；
2. 如果没有足够的 public API，通过其公开 MCP/relay protocol 做薄包装；
3. 如果两者都不能满足身份、策略和审计要求，形成 ADR 并重新评估上游扩展或自有最薄 transport。

只有第一或第二条验证成立后才实现：

```ts
class McpBAdapter implements BrowserAdapter
```

把 MCP-B 作为一个 WebMCP source backend。

未来即使 MCP-B API 改变，Core 不需要跟着改。

---

## 24. KnowMesh 接入原则

KnowMesh 不导入 WebMCP Gateway SDK。

KnowMesh 只需要：

```ts
document.modelContext.registerTool({
  name: "search_documents",
  description: "Search documents in current workspace",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string"
      }
    },
    required: ["query"]
  },
  execute: async ({ query }) => {
    // Reuse KnowMesh's existing authenticated frontend/backend APIs.
  }
});
```

上述代码负责**定义和暴露 WebMCP tool**，不负责把 tool 传给桌面 MCP Client。

v0.1 采用 cooperative page mode：测试页或明确选择接入的应用额外加载 MCP-B embed transport。embed 只负责发现已注册工具并连接本机 relay，不应包含 KnowMesh 业务逻辑：

```html
<script src=".../@mcp-b/webmcp-local-relay/.../embed.js"></script>
```

这意味着 v0.1 的真实 E2E 证明的是“协作式页面接入”。长期正式产品路径是 ExtensionAdapter 在浏览器侧发现工具并建立 transport，使业务网站只保留标准 WebMCP 注册，不加载 MCP-B / Gateway bridge。

然后：

```text
KnowMesh
   │
WebMCP
   │
Browser
   │
WebMCP Gateway
   │
MCP
   │
Claude / Codex / Cursor / AgentMesh
```

KnowMesh 不应该：

- 自己启动 MCP server；
- 感知 Claude / Codex；
- 维护 bridge session；
- 将业务登录 Cookie 交给 Agent；
- 重复实现 backend API。

KnowMesh 现有登录 session 只决定网页业务 API 是否授权；它不能替代 Gateway 的 agent/tool policy。Gateway 也不得导出、读取或记录业务 Cookie、Authorization header 或 localStorage credential。

---

## 25. MVP Scope

第一版只完成：

### 浏览器侧

- 一个 top-level 真实 WebMCP source
- cooperative page 显式加载 MCP-B embed transport
- 能发现 tools
- 能收到 tool add/remove/reload
- 能调用 tool

### Core

- SourceRegistry
- ToolRegistry
- AdapterRegistry
- NamespaceResolver
- ToolRouter
- RuntimeEventBus
- 简单 PolicyEngine
- JSONL AuditLogger
- source generation / event revision reconciliation
- cancellation / deadline / per-source execution queue
- tool / schema / input / output resource limits

### MCP

- stdio server
- `webmcp_list_sources`
- `webmcp_list_tools`
- dynamic MCP tools
- 不支持 dynamic refresh 时的固定 fallback tool

### 测试

- fake adapter unit tests
- registry tests
- namespace collision tests
- policy tests
- stdio integration test
- 一个真实 WebMCP E2E
- 一个目标 MCP Client 的 dynamic-tool compatibility test
- 两个独立 stdio Client 共享同一 browser relay 的 integration test

---

## 26. MVP 明确不做

```text
HTTP MCP
Remote browser
Multi-machine
Web UI
OAuth
Cloud service
Full RBAC
AgentMesh SDK
CDP + Playwright 同时支持
复杂 confirmation UI
可恢复的人工 confirmation flow
cross-origin iframe / delegated tools
WebMCP task execution / multi-round input_required
统一 Runtime daemon
```

这些放到第二阶段。

---

## 27. 第一阶段实现顺序

Coding Agent 按以下顺序执行。

### Phase -1 — External Dependency / Real-chain Spike

在创建完整 monorepo 骨架前，先建立最小 disposable spike，验证：

1. 当前 WebMCP `document.modelContext` / `registerTool` / `toolchange` 行为；
2. 当前 MCP-B Local Relay 的版本、public exports、embed、origin restriction 和 multi-client 模式；
3. 当前 MCP SDK stdio server、dynamic tool registration、tool-list change 和 Client refresh；
4. 一个真实页面 tool 能完成 discover、list、call、reload recovery、close cleanup；
5. 两个独立 stdio MCP Client 能否通过预定拓扑共享 browser connection；
6. 能否在不 deep import、不复制 MCP-B 源码的前提下插入 policy 和 audit。

交付物：

```text
docs/spikes/0001-mcpb-integration.md
docs/adr/0000-mcpb-integration-mode.md
最小可重复运行的 spike / contract test
依赖版本与兼容性矩阵
```

Gate：只有“进程内 public API composition”或“公开 protocol 薄包装”至少一种路径被真实验证后，才进入 Phase 0。失败时先修改架构，不允许依据假接口继续搭建 Core。

---

### Phase 0 — Bootstrap

创建：

```text
pnpm workspace
TypeScript strict mode
ESLint
Prettier
Vitest
```

要求：

```text
pnpm build
pnpm test
pnpm lint
```

全部可运行。

---

### Phase 1 — Protocol Types

实现：

```text
packages/protocol
```

包含：

- BrowserSource
- RuntimeTool
- ToolIdentity
- BrowserAdapterEvent
- RuntimeInvokeRequest
- RuntimeInvokeResult
- RuntimeError
- Zod schemas
- adapter/source generation and revision
- cancellation/deadline contract
- normalized result and outcome-unknown semantics

验收：

- TypeScript compile
- schema unit tests

---

### Phase 2 — Core Registry

实现：

```text
SourceRegistry
ToolRegistry
RuntimeEventBus
AdapterRegistry
```

必须测试：

1. source register
2. duplicate source update
3. source disconnect
4. tool register
5. duplicate tool update
6. unregister by source
7. MCP name reverse lookup
8. same adapter type / different adapterId
9. stale generation and out-of-order revision rejection
10. subscribe/list snapshot reconciliation

---

### Phase 3 — Namespace

实现：

```text
NamespaceResolver
```

必须覆盖：

```text
same tool / different tab
same tool / different origin
same origin / different profile
invalid MCP characters
very long names
collision
normalization/truncation collision independent of registration order
128-character maximum
generation change
```

必须保证 deterministic。

---

### Phase 4 — Fake Adapter

实现：

```text
FakeBrowserAdapter
```

支持：

```ts
connectSource()
disconnectSource()
registerTool()
unregisterTool()
invokeTool()
```

目的：

在不依赖浏览器的情况下测试整个 Runtime。

---

### Phase 5 — ToolRouter

实现：

```text
ToolRouter
PolicyEngine
AuditLogger
```

调用链必须完整：

```text
resolve
→ validate
→ policy
→ invoke adapter
→ normalize
→ audit
```

必须覆盖：

```text
exact allow / default deny
confirm without channel -> deny
generation changes between policy and dispatch
client cancel / shutdown / disconnect
timeout with outcome unknown
per-source serialization and queue limit
input/schema/output size limits
audit write failure
```

---

### Phase 6 — MCP stdio

实现：

```text
McpStdioServer
ToolProjector
```

先暴露：

```text
webmcp_list_sources
webmcp_list_tools
```

再实现 dynamic tools。

使用 FakeBrowserAdapter 验证：

```text
Fake WebMCP tool
        ↓
Runtime
        ↓
MCP stdio
        ↓
MCP test client
        ↓
call tool
        ↓
successful result
```

这个链路必须成为 CI integration test。

---

### Phase 7 — MCP-B Adapter

实现：

```text
McpBAdapter
```

此阶段是把 Phase -1 已验证的 integration mode 产品化，不允许重新发明另一种未经验证的接入路径。

目标不是修改 MCP-B，而是：

```text
MCP-B events / registry
       ↓
BrowserAdapter abstraction
       ↓
WebMCP Gateway Core
```

adapter-specific 逻辑必须留在 `packages/browser-adapter`。禁止 deep import 未导出的源码路径、复制 registry/naming/relay 源码或把 MCP-B-specific 数据结构泄漏进 Core。

---

### Phase 8 — Real Browser E2E

创建：

```text
packages/test-fixtures/webmcp-demo
```

页面注册：

```text
echo
get_page_title
add
```

fixture 在 v0.1 cooperative page mode 下显式加载 MCP-B embed；测试名称和 README 必须标明这一前提，不能把它表述为 extension-based zero-integration acceptance。

E2E：

```text
launch page
→ source appears
→ 3 tools appear
→ MCP lists tools
→ call echo
→ success
→ reload
→ tools recover
→ close tab
→ tools disappear
```

还必须覆盖：

```text
two clients share one browser source
same-name tools in two tabs and two origins
rapid reload / reconnect with delayed old events
navigation to another origin
disconnect or reload during invocation
timeout after a side effect may have started
oversized schema / input / output
untrusted destructiveHint or misleading tool name cannot auto-allow
origin not on allowlist cannot register or invoke
```

v0.1 只验收 top-level browsing context。same-origin iframe、cross-origin iframe、`exposedTo` 和 delegated tools 明确留到后续版本。

---

## 28. MVP 验收标准

满足以下条件才算 MVP 完成。

### 功能

- [ ] WebMCP 页面工具可被发现
- [ ] MCP Client 可直接看到 dynamic tools
- [ ] MCP Client 可调用真实 WebMCP tool
- [ ] 页面 reload 后恢复
- [ ] tab 关闭后 tools 自动消失
- [ ] 两个 tab 同名 tool 不冲突
- [ ] 两个不同 origin 同名 tool 不冲突
- [ ] denied tool 不会执行
- [ ] confirm decision 在无确认通道时不会执行
- [ ] 每次 invocation 有 audit record
- [ ] reload/navigation 后旧 generation 无法调用
- [ ] timeout/cancel 不会触发自动重复写操作
- [ ] 工具、schema、input、output 和队列上限生效
- [ ] 两个独立 stdio Client 可按 v0.1 拓扑共享 browser connection

### 架构

- [ ] Core 不依赖具体 Chrome Extension API
- [ ] Core 不依赖 Playwright
- [ ] Core 不依赖 MCP-B 私有数据结构
- [ ] MCP transport 不直接调用 browser
- [ ] Browser adapter 不负责 policy
- [ ] ToolRegistry 不执行 tool
- [ ] Core 只通过 adapterId 路由具体 adapter instance
- [ ] Core 不持有与 SourceRegistry 分叉的 mutable source snapshot
- [ ] MCP-B integration 不使用 deep import 或复制其私有实现

### 工程

- [ ] strict TypeScript
- [ ] unit tests
- [ ] integration tests
- [ ] real browser E2E
- [ ] target MCP Client dynamic-tool compatibility test
- [ ] cancellation / timeout / stale-event integration tests
- [ ] origin spoof / untrusted annotation / payload-limit security tests
- [ ] CI
- [ ] README 能在 10 分钟内跑起 demo

---

## 29. 第二阶段

MVP 完成后再做：

### Transport

```text
Streamable HTTP MCP
Runtime HTTP API
```

### Browser

```text
ExtensionAdapter
CDPAdapter
PlaywrightAdapter
RemoteBrowserAdapter
```

### Runtime

```text
multiple browser profiles
workspace abstraction
stable source alias
health checking
retry
circuit breaker
persistent registry metadata
central Runtime daemon
authenticated local IPC
```

### Policy

```text
per-agent rules
per-origin rules
per-workspace rules
read/write/destructive levels
interactive approval
single-use confirmation binding
```

### Observability

```text
metrics
structured tracing
invocation history
runtime dashboard
```

---

## 30. AgentMesh 集成

AgentMesh 不应通过特殊协议直接访问 BrowserAdapter。

正确路径：

```text
AgentMesh
    │
Runtime API / MCP
    │
WebMCP Gateway Core
    │
BrowserAdapter
```

这样 WebMCP Gateway 可独立运行，也可以嵌入 AgentMesh。

未来可增加：

```ts
export interface RuntimeClient {
  listSources(): Promise<BrowserSource[]>;
  listTools(): Promise<RuntimeTool[]>;
  invoke(request: RuntimeInvokeRequest): Promise<RuntimeInvokeResult>;
}
```

AgentMesh 内嵌模式直接使用此接口。

---

## 31. 推荐 CLI

MVP：

```bash
mcp2webmcp start

mcp2webmcp status

mcp2webmcp sources

mcp2webmcp tools
```

参数：

```bash
mcp2webmcp start \
  --config ~/.mcp2webmcp/config.yaml
```

Debug：

```bash
mcp2webmcp tools --source <sourceId>

mcp2webmcp inspect <toolName>
```

不要在 MVP 加太多 CLI command。

---

## 32. 推荐开发模式

```bash
pnpm install

pnpm dev
```

另一个 shell：

```bash
pnpm test:client
```

浏览器：

```text
http://localhost:<fixture-port>
```

最终测试：

```text
fixture
  ↓
adapter
  ↓
runtime
  ↓
stdio MCP
  ↓
test MCP client
```

---

## 33. Coding Agent 首轮任务

Coding Agent 收到本文档后，第一轮只完成 Phase -1，不直接建立完整产品骨架。

### Task 1

记录当前 WebMCP、MCP-B Local Relay、MCP SDK 和目标浏览器/Client 的确切版本与公开接口。

### Task 2

创建最小 cooperative page fixture：注册一个 `echo` tool，并显式加载 MCP-B embed。

### Task 3

证明真实链路：

```text
fixture
  -> MCP-B browser transport / relay
  -> stdio MCP
  -> reference MCP client
  -> echo result
```

### Task 4

验证 dynamic tool add/remove、reload、tab close 和 target Client refresh 行为。

### Task 5

启动两个独立 stdio Client，验证它们是否按 v0.1 拓扑共享 browser connection，并记录 registry、命名和并发行为。

### Task 6

检查 MCP-B public exports / public protocol，证明 policy 和 audit 可以在哪个稳定边界插入；输出 integration-mode ADR。

### 本轮不要实现

- Chrome Extension
- 完整 monorepo / Core Runtime
- 自有 registry / namespace / relay
- MCP-B 私有源码复制或 deep import
- Playwright
- HTTP MCP
- AgentMesh
- Web UI

第一轮完成后，项目必须做到：

```text
real WebMCP echo tool
        -> real browser transport
        -> real stdio MCP
        -> reference Client success

plus documented:
public integration boundary
multi-client topology result
dynamic-tool compatibility result
security defaults
go / revise architecture decision
```

Gate 通过后，第二轮才执行 Phase 0～5：monorepo、protocol、registries、FakeBrowserAdapter、NamespaceResolver、最小 ToolRouter 及其单元测试。

---

## 34. Coding Agent 实现约束

Coding Agent 必须遵守：

1. 不把所有逻辑写在一个 `server.ts`。
2. 不为了 MVP 删除 BrowserAdapter abstraction。
3. 不直接复制 MCP-B 源码进项目。
4. 不自行实现 WebMCP polyfill。
5. 不将 tab ID 当作唯一 tool identity。
6. 不把 MCP tool name 当内部 primary key。
7. 不在 BrowserAdapter 中实现权限规则。
8. 不在 MCP transport 中直接处理 browser invocation。
9. 所有 public protocol types 必须集中定义。
10. 所有 external payload 必须 runtime validate。
11. 所有核心注册表必须有测试。
12. Tool namespace 必须 deterministic。
13. 对 reload/disconnect 必须显式建模。
14. 默认不允许 remote bind。
15. 默认不自动批准 destructive tool。
16. 不把页面提供的 tool name 或 annotations 单独作为 allow 依据。
17. 不用 `adapterType` 替代 `adapterId` 做实例路由。
18. 不在 timeout 后自动重试可能产生副作用的调用。
19. 不省略 tool/schema/input/output/queue 的资源上限。
20. v0.1 不把 cooperative embed E2E 宣称为 extension zero-integration acceptance。

---

## 35. Architecture Decision Records

建议从项目建立时开始维护：

```text
docs/adr/
├─ 0000-mcpb-integration-mode.md
├─ 0001-runtime-core-browser-adapter-separation.md
├─ 0002-runtime-tool-identity.md
├─ 0003-use-mcpb-as-compatibility-layer.md
├─ 0004-policy-before-routing-execution.md
├─ 0005-v0.1-stdio-process-topology.md
├─ 0006-cooperative-embed-to-extension-migration.md
└─ 0007-confirm-fails-closed-without-approval-channel.md
```

### ADR-0001

**Decision**

Core 不直接访问 Chrome / Playwright / CDP。

### ADR-0002

**Decision**

Tool identity 使用 source + original tool identity，而不是 MCP name。

### ADR-0003

**Decision**

WebMCP compatibility 优先复用 MCP-B，不自行维护 polyfill。

### ADR-0004

**Decision**

Tool invocation 必须经过 PolicyEngine 后才允许调用 BrowserAdapter。

### ADR-0005

**Decision**

v0.1 每个 MCP Client 持有一个 stdio Gateway；多个 Gateway 只共享 browser relay connection，不共享 Core 内存、策略或审计状态。

### ADR-0006

**Decision**

v0.1 使用 cooperative page embed 打通真实链路；长期通过 ExtensionAdapter 达到网站只实现标准 WebMCP 的目标。

### ADR-0007

**Decision**

在没有受支持的人工审批通道时，`confirm` fail closed 为 deny；不提供全局 `--auto-approve`。

---

## 36. 成功定义

WebMCP Gateway（mcp2webmcp）的价值不是：

```text
“我也能把 WebMCP tool 变成 MCP tool”
```

而是：

```text
“我提供一个与具体 Agent、浏览器 backend 和 WebMCP compatibility
实现解耦的 runtime，使多个 Agent 能在明确的进程与信任边界下安全、稳定地共享和调用
浏览器中的 WebMCP capabilities。”
```

最终理想架构：

```text
                  Websites
                      │
                    WebMCP
                      │
             ┌────────┴────────┐
             │                 │
       Native Web Agent   WebMCP Gateway
                               │
               ┌───────────────┼──────────────┐
               │               │              │
             Claude           Codex        AgentMesh
               │               │              │
               └───────────────┴──────────────┘
                        Agent Ecosystem
```

当未来 Agent 普遍原生支持 WebMCP 时：

- 网站无需修改；
- WebMCP Gateway 不阻塞迁移；
- Runtime 仍可继续提供 policy、audit、multi-browser routing 和 AgentMesh integration；
- 单纯的 compatibility bridge 可以逐渐退化或退出。

---

## 37. 首个可交付版本

建议版本：

```text
v0.1.0
```

必须包含：

```text
Core Runtime
Fake Adapter
MCP-B/WebMCP Adapter
stdio MCP
Dynamic tools
Namespace
Policy
Audit
Real WebMCP demo
E2E
cooperative MCP-B embed transport
reference MCP Client compatibility result
two-client shared-relay integration result
```

README 开头应能做到：

```bash
pnpm install
pnpm build
pnpm test
pnpm dev
```

然后配置一个 MCP Client 后，即可调用 demo 页面暴露的 WebMCP tools。

---

## 38. 实现时需要优先验证的外部依赖

WebMCP 仍处于演进阶段。因此 Coding Agent 开始真实 Browser Adapter 实现前，应先验证当前版本：

- W3C WebMCP / Web Machine Learning Community Group draft
- `document.modelContext`
- `registerTool`
- 当前 Chromium WebMCP preview 行为
- `@mcp-b/webmcp-local-relay`
- `@mcp-b/webmcp-polyfill`
- MCP SDK 当前 server / dynamic tools API

这些外部细节不得硬编码进 Core。

---

## 39. 当前参考

MCP-B Local Relay：

https://www.npmjs.com/package/@mcp-b/webmcp-local-relay

MCP-B packages：

https://github.com/WebMCP-org/npm-packages

W3C WebMCP proposal：

https://github.com/webmachinelearning/webmcp

MCP：

https://modelcontextprotocol.io/

---

## 40. Coding Agent 启动指令

可以把本文档直接交给 Coding Agent，并附加以下指令：

```text
请以本架构文档作为当前项目的实现规范。

先阅读完整文档，不要一次性实现全部功能。

第一轮只完成：
1. 记录当前 WebMCP、MCP-B Local Relay、MCP SDK、Chrome 和 reference MCP Client 版本；
2. 创建一个注册 echo tool 并加载 MCP-B embed 的最小 cooperative page fixture；
3. 打通 real browser -> relay -> stdio MCP -> reference Client -> echo result；
4. 验证 dynamic add/remove、reload、tab close 和 Client tool-list refresh；
5. 验证两个独立 stdio Client 共享 browser relay connection；
6. 检查 MCP-B public API / public protocol，确定 policy 和 audit 的稳定插入边界；
7. 输出 dependency matrix、contract test 和 0000-mcpb-integration-mode ADR；
8. 明确给出 go 或 revise architecture 结论。

Gate 通过前不要建立完整 Core，不要实现 Chrome Extension、Playwright、
HTTP MCP、AgentMesh 或 Web UI；不要 deep import 或复制 MCP-B 私有实现。

完成后输出：
- 新建/修改的文件；
- 真实数据与调用链；
- 测试结果；
- MCP-B 可复用能力与 WebMCP Gateway 差异化能力矩阵；
- 安全与兼容性观察；
- integration-mode ADR；
- Gate 结论和下一轮任务。

如果仓库已经存在代码，请先检查现有结构，在尽可能保留现有工程约定的
前提下映射本架构，不要机械重建项目。
```
