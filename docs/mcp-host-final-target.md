# Mutsumi MCP 宿主、注册及 Agent 接入最终状态

> 状态：最终目标状态（Final Target State）  
> 适用范围：首期 MCP Tools 接入  
> 目标版本：VS Code `^1.108.0` 及当前 Mutsumi Agent/Tool 架构

## 1. 目的

Mutsumi 应能够从自身的 VS Code 设置中读取 MCP Server 配置，作为 MCP Client 连接这些 Server，发现其 Tools，并将用户为某个 Agent 会话启用的 MCP Tools 注入该 Agent 的工具集合。

本设计同时满足以下目标：

- 复用现有 `ITool`、`ToolSet`、`ToolExecutor` 和审批系统；
- 保持 MCP Tools 与 AgentType 的内置 `toolSets` 权限体系相互独立；
- AgentType 只声明新 Agent 默认使用哪些 MCP Servers；
- Agent 文件创建时冻结具体 MCP Tool 选择，后续由用户在 ContextTree 中按 Tool 调整；
- 保持 `task_finish` 继续作为子 Agent 生命周期工具单独注入；
- 使用简单、可预测的扩展级 MCP 生命周期，不引入连接池、引用计数、会话级连接或自动重连状态机；
- MCP Server 或 Tool 暂时不可用时局部降级，不阻断 Mutsumi 其余功能。

本文档是该功能的唯一权威目标状态。实现中的局部选择不得改变这里定义的数据语义、模块边界和失败行为。

---

## 2. 已确认的产品决策

### 2.1 配置来源

MCP 配置只来自 Mutsumi 自身的 VS Code 设置项，不读取或复用 VS Code 原生 `mcp.json`。

配置入口为：

- `mutsumi.mcpServers`

读取方式遵循现有设置模式，通过 `vscode.workspace.getConfiguration("mutsumi")` 获取。VS Code 自身负责用户级、远程级和工作区级设置的合并结果。

### 2.2 AgentType 与会话选择

- AgentType 配置的是 MCP Server ID，而不是具体 Tool。
- AgentType 字段为可选的 `defaultMcpServers`。
- 创建 Agent 文件时，使用这些 Server 当时已经发现的 Tools 生成一次具体工具快照。
- Agent 创建后不再动态跟随 AgentType 的 `defaultMcpServers`。
- 用户可在 ContextTree 中按 Server 批量开关，也可按 Tool 单独开关。

### 2.3 连接与信任

- 用户手工写入 `mutsumi.mcpServers` 即视为允许 Mutsumi 启动或连接对应 Server。
- Server 启动不增加额外信任确认。
- Tool 调用审批与 Server 启动信任是两个不同概念。
- `readOnlyHint === true` 的 Tool 在全局 AutoApprove 关闭时仍可自动执行。
- 未声明 `readOnlyHint` 或其值不是严格布尔值 `true` 时，按非只读 Tool 处理。
- 非只读 Tool 在 AutoApprove 关闭时必须进入现有 permission/approval 流程。

### 2.4 简化原则

首期明确不实现：

- per-Agent MCP 连接；
- MCP 连接池、引用计数、空闲回收或配置指纹；
- 指数退避、健康检查和后台自动重连；
- 因 Agent 是否启用某 Tool 而启动或停止 Server；
- 不同 Agent 创建入口各自不同的连接失败交互；
- 自动响应 MCP 动态 Tool 列表变化通知；
- VS Code `mcp.json` 的 `${input:...}`、SecretStorage、trust、sandbox 或自动发现语义；
- MCP prompts、resources、sampling、elicitation、Apps；
- OAuth；
- legacy SSE，除非所选 SDK 的稳定接口可零成本兼容且不增加分支设计。

---

## 3. 当前架构及接入位置

现有内置工具链路为：

```text
ToolRegistry
    → ToolSetRegistry
    → AgentTypeRegistry
    → createToolSetForAgent
    → ToolSet
    → AgentRunner / ToolExecutor
```

其职责保持不变：

- `ToolRegistry`：内置、静态工具的全局注册；
- `ToolSetRegistry`：具名内置工具集合；
- `AgentTypeRegistry`：AgentType 到内置工具集合及角色默认值的映射；
- `createToolSetForAgent`：为一次 Agent 运行构建最终工具集合；
- `ToolSet`：向模型暴露 definition，并按名称执行工具；
- `task_finish`：仅在存在 `parent_agent_id` 时额外注入。

MCP 不进入 `ToolSetRegistry`，也不允许在 `agentConfig.toolSets` 中引用动态 MCP Tool 名称。MCP 的接入链路为：

```text
mutsumi.mcpServers
    → McpRegistry（扩展级连接、发现、状态和调用）
    → AgentMetadata.enabledMcpTools（会话工具选择快照）
    → McpToolAdapter（ITool）
    → createToolSetForAgent
    → ToolSet
```

最终工具集合由三部分组成：

```text
AgentType 内置 ToolSets
    + 当前可用且被会话快照启用的 MCP Tools
    + 子 Agent 专属 task_finish
```

---

## 4. 配置模型

### 4.1 `mutsumi.mcpServers`

该设置是以稳定 Server ID 为键的对象，而不是数组：

```text
McpServersConfig = Record<McpServerId, McpServerConfig>
```

首期 Server 类型：

```text
McpServerConfig = McpStdioServerConfig | McpHttpServerConfig
```

抽象字段约定：

```text
McpStdioServerConfig
- type: "stdio"
- command: non-empty string
- args?: string[]
- cwd?: string
- env?: Record<string, string | number>
- timeout?: positive number

McpHttpServerConfig
- type: "http"
- url: non-empty absolute HTTP(S) URL
- headers?: Record<string, string>
- timeout?: positive number
```

约束：

- Server ID 必须非空且唯一；
- 配置必须按 `type` 进行判别联合验证；
- 未知字段是否拒绝由统一配置校验策略决定，但不能在执行路径中临时猜测配置形态；
- `env` 与扩展宿主环境合并，不能无意清空宿主环境；
- 未设置 `cwd` 时，以工作区 `[0]` 作为优先默认；若当前 URI scheme 无法作为本地/远程扩展宿主进程工作目录，应省略 cwd 或给出明确配置错误，不做字符串路径猜测；
- 不展开 VS Code 原生 MCP 配置变量；
- timeout 同时约束初始连接和工具发现，避免扩展激活无限等待。

`package.json` 中必须为该设置提供准确 JSON Schema 和本地化说明。

### 4.2 AgentType 配置

`AgentTypeConfig` 增加：

```text
defaultMcpServers?: string[]
```

语义：

- 只在创建 Agent 文件时使用；
- 表示应从哪些 Server 取得当前 Tool 列表并生成初始快照；
- 缺省等价于 `[]`；
- 不改变内置 `toolSets`；
- 不控制 Server 是否连接；
- 不用于已存在 Agent 的每次运行。

配置 loader、merge、validator、resolver 和 `package.json` schema 必须共同理解该字段，不能只扩展接口而遗漏运行路径。

校验规则：

- 必须是字符串数组；
- Server ID 去重；
- 引用必须存在于当前合并后的 `mutsumi.mcpServers`；
- 内置默认 AgentType 缺省使用空数组，保持现有行为。

Agent 配置和 MCP Server 配置应作为一个一致候选状态完成校验后再替换运行时 registry，避免某个 registry 已更新而另一个仍为旧状态。连接失败不是配置校验失败；结构错误和未知 Server 引用才是配置错误。

### 4.3 Resolved defaults

`ResolvedAgentDefaults` 增加清晰命名的 MCP Server 默认列表，例如：

```text
mcpServers: string[]
```

该结果只服务 Agent 创建流程。不得把它误用为已存在 Agent 的实时权限来源。

---

## 5. Agent 文件持久化模型

`AgentMetadata` 增加：

```text
enabledMcpTools?: McpToolSelection[]

McpToolSelection
- serverId: string
- toolNames: string[]
```

推荐持久化形态：

```json
{
  "enabledMcpTools": [
    {
      "serverId": "playwright",
      "toolNames": ["browser_navigate", "browser_snapshot"]
    }
  ]
}
```

规范化规则：

- `undefined`：旧 Agent 文件，等价于没有启用 MCP Tool；
- `[]`：没有启用 MCP Tool；
- 同一 `serverId` 最多出现一次；
- `toolNames` 去重并保持稳定顺序；
- 空 `toolNames` 的 Server 条目从持久化结果中移除；
- 保存原始 MCP Server ID 和原始 MCP Tool name，不保存面向模型的规范化工具名；
- 不复制 command、URL、headers、schema 或 description 到 Agent 文件；
- Tool 选择快照冻结，但连接参数始终读取当前 `mutsumi.mcpServers`。

旧 Agent 文件无需迁移。Notebook serializer 继续透明保存未知/新增 metadata 字段，但所有创建、复制、压缩及 adapter metadata 合并路径必须确认不会主动丢弃该字段。

复制 Agent 文件时保留快照；创建新根 Agent 或新子 Agent 时根据其 AgentType 重新生成快照，不继承父 Agent 的手动 MCP 选择。

---

## 6. MCP Registry

### 6.1 单一职责

新增扩展级 `McpRegistry`，负责：

- 接收已经校验的 `mutsumi.mcpServers`；
- 为每个 Server 建立一个 MCP Client；
- 完成 initialize 和 `tools/list`；
- 保存 Server 的连接状态、错误和当前 Tool definitions；
- 按 `{serverId, toolName}` 执行 `tools/call`；
- 完整 reload；
- dispose 全部 Client；
- 发出 registry 状态变化事件供 Sidebar 刷新。

它不负责：

- AgentType 权限；
- Agent metadata 读写；
- ToolSet 组合；
- Tool 调用审批；
- Notebook UI；
- Agent 创建策略；
- 自动重连。

### 6.2 状态模型

每个配置的 Server 只有以下运行状态：

```text
connecting | connected | error
```

每条记录至少包含：

```text
serverId
config
tools
status
error?
client?
```

`tools` 只有在最近一次成功连接及发现后才有效。完整 reload 开始时清除旧记录，避免把旧 Tool 列表误报为当前可用。

### 6.3 生命周期

#### 扩展激活

1. 初始化现有 ToolRegistry；
2. 读取并校验 MCP 与 Agent 配置；
3. 初始化 AgentType/ToolSet registries；
4. 初始化 `McpRegistry`；
5. 并发连接全部配置 Server；
6. 单个 Server 失败仅将自身标记为 `error`；
7. 在 MCP Registry 已进入稳定的 connected/error 状态后开放依赖其快照的 Agent 创建操作。

扩展激活不得因某个合法配置的 MCP Server 网络失败或进程失败而整体失败。

#### 配置变化

监听：

- `mutsumi.mcpServers`
- `mutsumi.agentConfig`

变化后先执行统一候选配置校验：

1. 读取完整候选配置；
2. 完成结构和交叉引用校验；
3. 校验失败则保留上一个有效运行配置并报告错误；
4. 校验成功则更新 AgentType/ToolSet registries；
5. 刷新 ContextTree。

只有 `mutsumi.mcpServers` 实际受该配置事件影响时，才对 MCP Registry 执行完整 reload：关闭全部 Client、清空状态、按新配置重新连接。仅 `mutsumi.agentConfig` 变化时不得重启 MCP Server；`defaultMcpServers` 只影响未来 Agent 的快照选择，不影响连接生命周期。

不做 Server 级配置 diff。MCP 配置 reload 期间发起的 MCP 调用允许以明确的“Server reloading/unavailable”错误结束，不实现旧连接平滑排空。

#### 手动刷新

ContextTree 的 MCP 刷新命令调用同一个完整 reload 能力，而不是维护第二条连接逻辑。

#### 扩展退出

统一 dispose 全部 Client/transport/process。

### 6.4 并发约束

Registry 必须防止两个 reload 同时修改内部状态。实现可串行化或让后发 reload 取代前一轮，但对外必须表现为单一完整 reload，不允许重复 Client 泄漏。

这只是 reload 操作互斥，不演化为连接池或复杂任务调度系统。

### 6.5 Server 运行中断

已连接 Server 后续退出或调用失败时：

- 将该 Server 标记为 `error`；
- 保存可读错误；
- 后续调用返回明确不可用错误；
- 不自动重连；
- 用户通过 Refresh、修改设置或 Reload Window 重连。

---

## 7. Agent 创建时的快照

由统一的快照解析能力完成：

```text
AgentType.defaultMcpServers
    ∩ McpRegistry 当前 connected servers
    → 每个 Server 当前发现的全部原始 tool names
    → AgentMetadata.enabledMcpTools
```

该能力只读取 Registry，不建立连接。

统一行为：

- connected Server：把当前发现的全部 Tools 写入快照；
- error/connecting/未配置 Server：不写入快照；
- 某 Server 没有 Tools：不写空条目；
- Agent 仍然成功创建；
- 若默认 Server 未能进入快照，可返回警告信息供交互式入口提示和 HTTP 响应记录，但不得引入重试/忽略/取消分支。

所有 Agent 创建入口必须走相同快照逻辑：

- `Mutsumi: New Agent`；
- HTTP `POST /agents`；
- `dispatch_subagents` 创建子 Agent；
- 其他调用 serializer/fileOps 直接创建 Agent 的路径。

Serializer 和文件写入层不负责连接或发现。它们只接收已经解析好的 `enabledMcpTools` 并持久化。

子 Agent 使用自己的 `agentType.defaultMcpServers` 生成快照，不继承父 Agent 的 `enabledMcpTools`，与当前 Rules/Skills 的角色默认策略保持一致。

---

## 8. MCP Tool 适配与名称

### 8.1 `ITool` 适配

使用一个通用、轻量的 `McpToolAdapter` 实现现有 `ITool`：

- 持有逻辑身份 `{serverId, originalToolName}`；
- 持有最近发现的 Tool schema、description、annotations；
- 生成 OpenAI-compatible function definition；
- 在执行时通过注入的 MCP 调用接口访问 Registry；
- 复用 `ToolContext` 和 `ToolSession.abortSignal`；
- 复用现有 ToolExecutor 的渲染和错误回传路径。

Adapter 不持有底层 Client，不负责连接生命周期。

### 8.2 模型暴露名称

MCP Tool 的逻辑身份始终为：

```text
{ serverId, originalToolName }
```

向模型暴露的扁平名称必须：

- 与内置工具隔离；
- 在不同 Server 之间唯一；
- 满足 OpenAI-compatible function name 字符和长度限制；
- 对同一逻辑身份稳定；
- 对规范化后可能碰撞的不同身份给出确定性区分或明确拒绝，绝不静默覆盖。

建议前缀语义为：

```text
mcp__<server>__<tool>
```

具体编码、截断和短哈希规则集中放在通用 utility 中，并有单元测试。该暴露名称不持久化到 `.mtm`。

`ToolSet.addTool` 及组合路径必须拒绝重名，而不是继续依赖 `Map.set` 静默覆盖。这个修正同时保护内置工具和 MCP 工具。

### 8.3 Schema 转换

MCP Tool 的 input schema 映射到 OpenAI function parameters。缺失或非法 schema 时：

- 该 Tool 不应注入模型；
- Server 仍可保持 connected；
- Registry/Sidebar 记录 Tool 级错误；
- 不因单个 Tool schema 异常丢弃整个 Server 的其他 Tools。

### 8.4 结果转换

当前 Mutsumi `ITool.execute` 返回字符串，因此首期采用确定性文本投影：

- MCP text content：按顺序拼接；
- structured content：稳定 JSON 序列化；
- MCP `isError`：转换为清晰的错误字符串；
- 不支持的二进制、图片、resource link 或未来 content part：返回类型与元信息摘要，不把任意二进制直接塞入上下文；
- 空结果：返回明确的空结果说明；
- 转换逻辑集中在 utility，不散落于 Adapter 或 Registry。

首期不扩展 AgentMessage 的多模态 Tool Result 协议。

### 8.5 缓存

MCP Tool 默认 `shouldCache = false`。外部系统状态不可假定稳定；未来只能由明确的 MCP/用户策略选择性开启。

---

## 9. MCP Tool 调用与审批

执行顺序：

```text
确认 Tool 仍属于当前 ToolSet
    → 计算审批策略
    → 必要时进入现有 requestApproval
    → Registry.callTool
    → 结果文本化
```

审批矩阵：

| Tool annotation | AutoApprove | 行为 |
|---|---:|---|
| `readOnlyHint === true` | 任意 | 自动执行 |
| 非只读或未声明 | `true` | 自动执行 |
| 非只读或未声明 | `false` | 进入现有审批系统 |

要求：

- 只有严格布尔 `true` 可视为只读；
- Tool description、Server ID、原始 Tool name 和调用参数应进入审批详情；
- 可使用 `mcp://<serverId>/<toolName>` 作为现有 `targetUri` 的资源标识，首期不为此重构完整 Approval 数据模型；
- 用户拒绝时沿用现有拒绝原因、session termination 和 Tool result 行为；
- 等待审批和实际 MCP 调用都应尊重现有取消信号；
- Server 配置本身不触发额外信任审批。

MCP 模块只依赖 permission 层的通用接口，不直接依赖 ApprovalTree UI 类。

---

## 10. 运行时工具组合

`createToolSetForAgent` 应改为 options/上下文式参数，避免继续增长位置参数。抽象输入至少包含：

```text
agentType
agentId?
parentAgentId?
enabledMcpTools?
```

组合规则：

1. 按 AgentType 的 `toolSets` 取得内置工具；
2. 对 `enabledMcpTools` 做结构防御性解码和规范化；
3. 从 McpRegistry 解析当前 connected 且仍存在的 Tool；
4. 为这些 Tool 创建 Adapter 并加入 ToolSet；
5. 有 parent 时最后注入 `task_finish`；
6. 检查最终暴露名称无冲突。

运行时有效 MCP Tools 等于：

```text
Agent 文件冻结快照 ∩ McpRegistry 当前可用 Tool 集合
```

行为：

- 快照存在但 Server 当前 error：不向模型暴露；
- 快照存在但 Tool 当前不存在：不向模型暴露；
- Server 后续恢复且 Tool 同名恢复：下一次 Agent run 自动重新暴露，因为快照仍保留；
- Server 新增 Tool：旧 Agent 不自动获得；
- Server Tool schema/description 更新：下一次 ToolSet 构建使用当前版本；
- 当前 AgentRunner 一旦开始运行，其 ToolSet 在该次 run 内保持稳定，不因 Sidebar 或 registry 刷新中途改变。

Notebook controller 与 HTTP chat 必须传入同一 metadata 快照，不能形成两套 MCP 能力行为。

---

## 11. 预执行/用户工具平面

### 11.1 语义

预执行是用户在模板内容中直接书写的工具调用（`@[tool{...}]`，可出现在消息、Rules、Skills、Macros 中），由控制面 `ToolManager` 经 `executeToolCall` 执行，与 Agent 运行时的 `ToolExecutor` 是两条独立的执行路径。Rules 解析只是预执行的一个真子集，不再拥有独立的"规则解析模式"。

### 11.2 平面构成与名称解析

预执行 ToolSet 由以下部分组成：

- 内置 common tools（与 `ToolSet({ includeCommon: true })` 相同）；
- McpRegistry 当前 `connected` 且 `schemaValid` 的全部 MCP Tools，与 Agent 快照无关、与 AgentType 无关；
- 子 Agent 会话额外包含 `task_finish`（与既有 isSubAgent 语义一致）。

MCP Tool 的暴露名与 Agent 运行时完全一致（`mcp__<server>__<tool>__<hash>`），同一逻辑身份在两条路径上使用相同名称。执行复用 `McpToolAdapter` 与 `McpRegistry.callTool`，schema 校验、结果文本投影和 `shouldCache = false` 的行为与运行时一致。

### 11.3 无审批

预执行是用户亲手书写的内容，其工具调用一律直接执行：

- 不区分 `readOnlyHint`，不进入 `requestApproval` 的审批等待，也不创建需要用户操作的审批请求；
- 通过"预执行模式"（permission.ts 的 `withPreExecution` / `isInPreExecution`）实现：进入预执行时，`requestApproval` 与编辑类工具的 auto-approve 检查一律放行；
- 该放行只覆盖预执行平面，不改变「MCP Tool 调用与审批」定义的 Agent 运行时审批矩阵，也不改变全局 AutoApprove 语义；
- 预执行无 session metadata，`signalTermination` 为 no-op，拒绝/终止语义在该平面不适用。

### 11.4 缓存与失效

`ToolManager` 缓存预执行 ToolSet（按是否包含 `task_finish` 分为两份），查询、执行与渲染路径共享同一实例，不再每次调用重建。`McpRegistry` 状态变化事件（reload、断连、发现 Tool 列表更新）使缓存失效，下一次访问时按当前 registry 状态惰性重建。单次模板渲染内使用的 ToolSet 保持一致。

---

## 12. ContextTree 用户体验

### 12.1 树结构

在现有 Agent Type、Rules、Skills、Macros、Files 之外增加 `MCPS` 分类：

```text
MCPS
├─ playwright                 connected · 2/8 enabled
│  ├─ browser_navigate       enabled
│  ├─ browser_snapshot       enabled
│  └─ browser_click          disabled
├─ context7                  error
└─ removed-server            not configured
   └─ old_tool               unavailable
```

Server 节点来自以下集合的并集：

- 当前 `mutsumi.mcpServers` 中配置的 Server；
- 当前 Agent `enabledMcpTools` 中仍被引用但已不再配置的 Server。

Tool 节点来自以下集合的并集：

- Registry 当前发现的 Tools；
- 当前 Agent 快照中仍被引用但当前不存在的 Tools。

### 12.2 状态和操作

Server 节点显示：

- connected/connecting/error/not configured；
- 已启用数/当前可用数；
- 错误摘要；
- 全开、部分开启或全关状态。

Tool 节点显示：

- enabled；
- disabled；
- unavailable；
- schema error（可与 enabled/disabled 选择状态组合展示）。

`enabled` 只表示该 Tool 存在于 Agent 快照；只有当前可用且 schema 合法时，它才实际暴露给模型。schema 非法的 Tool 必须展示 Tool 级错误，不能只显示为普通 enabled。

命令：

- `mutsumi.toggleMcpTool`
- `mutsumi.toggleMcpServer`
- `mutsumi.refreshMcpServers`

Tool toggle：

- 当前可用 Tool 可启用或禁用；
- unavailable 但仍在快照中的 Tool 可以禁用，以清理快照；
- 当前不存在且从未在快照中的 Tool 不会凭空创建。

Server toggle：

- connected：开启时把当前发现的全部 Tool names 写入该 Server 快照；关闭时删除该 Server 条目；
- error/connecting/not configured：允许关闭已有快照；不允许“开启全部未知工具”，并显示明确提示。

Refresh：

- 触发 MCP Registry 完整 reload；
- 完成后刷新树；
- 不自动改写任何 Agent 快照；
- 不因发现新 Tool 自动启用。

### 12.3 Metadata 写入和刷新

所有 toggle 使用 Notebook metadata 更新，遵循当前 WorkspaceEdit 模式并保持不可变更新，不能直接修改 VS Code 返回的冻结对象或原数组。

ContextTree 必须监听：

- active notebook 变化；
- 当前 Notebook metadata 变化；
- MCP Registry 状态变化；
- 相关配置 reload 完成。

这样 HTTP/adapter/其他命令修改 metadata 后，树不会依赖手动 toggle 才刷新。

按照项目既有约定，ContextTree 的 MCP 开关操作沿用上下文项操作的前缀缓存失效机制，不新增 MCP 专属缓存失效协议。

### 12.4 无活动 Notebook

没有活动 `.mtm` Notebook 时：

- 可展示 MCP Server 全局连接状态和 Tools；
- Tool/Server toggle 不可用；
- tooltip 明确提示需打开 Agent 会话；
- Refresh 仍可用。

---

## 13. 错误与降级

### 13.1 配置错误

结构错误、重复标识或 AgentType 引用未知 Server 属于配置错误：

- 拒绝应用新的候选配置；
- 保留上一份有效运行配置；
- 输出日志并显示可操作错误；
- 不让 registries 进入部分更新状态。

### 13.2 连接或发现失败

合法配置但连接、initialize 或 `tools/list` 失败：

- 只将该 Server 标记为 `error`；
- 不阻断其他 Server；
- 不阻断扩展激活；
- 不阻断 Agent 创建或运行；
- 创建快照时忽略该 Server；
- UI 和日志展示错误；
- 仅通过手动 Refresh、配置变化或 Reload Window 重试。

### 13.3 调用失败

- Server 不可用：返回明确工具错误；
- Tool 已被 Server 移除：返回明确工具错误；
- timeout/cancel：返回与现有 ToolExecutor 取消语义一致的结果；
- MCP protocol error：保留可读 server/tool 上下文，不泄露不必要的 secret header/env；
- 单次调用失败不自动 reload 全部 MCP Servers。

### 13.4 日志和敏感信息

日志应记录：

- Server ID、transport 类型和状态变化；
- discovery 数量；
- Tool 调用开始/完成/失败；
- reload 原因。

日志不得记录：

- 完整认证 header；
- secret env 值；
- 可能含凭据的完整 URL query；
- 未经必要脱敏的用户工具参数。

---

## 14. 模块边界和文件组织

建议新增小型、内聚的 `src/mcp/`：

```text
src/mcp/
├─ interfaces.ts
├─ registry.ts
├─ tool.ts
└─ utils.ts
```

必要时仅在 transport 接线明显影响 Registry 可读性时增加 `client.ts`。不得为了形式创建 Connection Pool、Catalog Manager、Lifecycle Coordinator 等重复抽象。

职责：

- `interfaces.ts`：Server 配置、状态、Tool 选择、最小调用接口；
- `registry.ts`：Client 生命周期、发现、状态、reload、call、事件；
- `tool.ts`：`ITool` Adapter 与审批接入；
- `utils.ts`：配置校验辅助、名称编码、结果文本化、selection 规范化。

配置类型仍由配置域统一导出；若 MCP 配置接口放在 `src/mcp/interfaces.ts`，配置模块只通过接口依赖它，避免复制类型。

依赖方向：

```text
config → MCP config interfaces
McpRegistry → MCP SDK / transport
McpToolAdapter → minimal MCP caller interface + permission + ITool
Tool construction → McpRegistry query interface
Sidebar → McpRegistry readonly state + metadata mutation command
```

禁止：

- Registry import Sidebar；
- Registry 修改 Notebook metadata；
- Sidebar 直接操作 MCP Client；
- MCP Tool 被写入静态 `TOOL_NAME_MAPPING`；
- MCP module 重新实现 ToolExecutor；
- serializer 发起 MCP 连接；
- AgentTypeRegistry 承担动态 Tool 状态。

使用官方 `@modelcontextprotocol/sdk` 作为 MCP protocol/transport 实现依赖，不自行实现 JSON-RPC framing。

---

## 15. 主要受影响范围

### 配置和类型

- `package.json`：`mutsumi.mcpServers` schema、`defaultMcpServers`、命令和菜单；
- `src/config/interfaces.ts`：AgentType 和 resolved defaults；
- `src/config/loader.ts`：合并；
- `src/config/utils.ts`：校验与交叉引用；
- `src/config/resolver.ts`：创建默认值解析；
- `src/config/types.ts`：内置默认；
- `src/types.ts`：Agent metadata 和 MCP Tool selection。

### MCP 和工具系统

- 新增 `src/mcp/*`；
- `src/tools.d/toolManager.ts`：最终 ToolSet 组合 options、MCP Adapter 注入、重名拒绝；预执行 ToolSet 缓存（内置 common + 全部可用 MCP Tools）及 MCP registry 状态变化失效；
- `src/tools.d/permission.ts`：原则上复用现有接口；"规则解析模式"泛化为"预执行模式"（`withPreExecution` / `isInPreExecution`），预执行平面的工具调用一律自动放行；
- `src/contextManagement/utils.ts`：`executeToolCall` 进入预执行模式执行；
- `src/agent/toolExecutor.ts`：原则上无需 MCP 特判。

### Agent 创建和执行

- `src/extension.ts`：初始化、配置监听、根 Agent 快照；
- `src/notebook/serializer.ts`：接受并持久化已解析快照；
- `src/agent/fileOps.ts`：只接收并持久化已经解析的子 Agent 快照；
- `src/agent/agentOrchestrator.ts`：调用统一快照解析能力，并保持子 Agent 不继承父快照；
- `src/controller.ts`：Notebook run 传入 selection；
- `src/httpServer/agents.ts`：HTTP 创建时生成快照；
- `src/httpServer/chat.ts`：HTTP run 传入 selection。

### Sidebar

- `src/sidebar/contextTreeItem.ts`：类型、图标、状态、命令；
- `src/sidebar/contextTreeProvider.ts`：MCPS 分类、Registry/metadata 合并展示；
- `src/sidebar/agentSidebar.ts`：事件订阅和生命周期；
- i18n 资源：全部新增用户可见文本。

---

## 16. 测试与验收矩阵

### 配置

- 用户级和 workspace 级设置通过 VS Code 合并后正确读取；
- stdio/http 判别校验；
- 非法 command/url/env/headers/timeout 被拒绝；
- `defaultMcpServers` 缺省兼容；
- 未知 Server 引用被拒绝且旧有效配置继续工作；
- settings reload 不产生重复 Client。

### Registry

- 多 Server 并发初始化，一个失败不影响其他；
- connected/error 状态和事件正确；
- Refresh 完整 dispose 并重建；
- 并发 Refresh 不泄漏 Client；
- Server 退出后变为 error；
- dispose 关闭 stdio process 和 HTTP transport；
- timeout 和 cancellation 生效。

### 快照

- 根 Agent 按 AgentType Server 列表冻结全部当前 Tools；
- 子 Agent 使用自身 AgentType，不继承父选择；
- HTTP 创建与 UI 创建一致；
- error Server 被忽略且 Agent 仍创建；
- 新 Tool 不自动进入旧 Agent；
- 旧文件无字段时等价于空选择；
- Agent copy 保留快照。

### 工具组合

- Notebook 与 HTTP 运行注入相同 MCP Tools；
- 快照与当前 Registry 做交集；
- `task_finish` 仍只注入子 Agent；
- 内置工具、不同 Server 同名 Tool 不冲突；
- 长名称和规范化碰撞行为确定；
- 单次 Agent run 的 ToolSet 不被中途 toggle 改写。

### 调用和审批

- `readOnlyHint === true` 在 AutoApprove 关闭时不请求审批；
- 缺少/false/非法 readOnlyHint 在 AutoApprove 关闭时请求审批；
- AutoApprove 开启时非只读 Tool 自动执行；
- 拒绝、取消和 timeout 符合现有工具语义；
- MCP text/structured/error/unsupported results 投影稳定；
- Tool 参数和 secrets 不被不当记录。

### 预执行平面

- 预执行 ToolSet 包含内置 common tools 与全部 connected/schemaValid MCP Tools，暴露名与 Agent 运行时一致；
- 预执行工具调用（内置与 MCP、无论 `readOnlyHint`、无论 AutoApprove）不请求审批；
- Agent 运行路径的审批行为不受预执行模式影响；
- MCP registry reload、断连或 Tool 列表更新后，预执行 ToolSet 缓存自动失效并按当前状态重建；
- Rules 中的 `@[tool{...}]` 与其他预执行路径行为一致。

### Sidebar

- connected/error/connecting/not configured 状态正确；
- Server 三态和 Tool 启停正确；
- unavailable snapshot 可被禁用；
- error Server 不能开启未知 Tools；
- Refresh 不修改快照；
- metadata 外部变化、active notebook 变化和 Registry 变化都会刷新；
- 无活动 Notebook 时只读展示和 Refresh 正常。

### 回归

- 无 `mutsumi.mcpServers` 时行为与当前版本一致；
- 内置 toolSets 校验和执行不变；
- Rules、Skills、Macros、Files ContextTree 行为不变；
- Tool cache 不缓存 MCP 调用；
- Notebook 保存、HTTP 保存、压缩、重命名和 Ghost Block 行为不受影响。

---

## 17. 实施顺序

### Milestone 1：配置、类型和 Registry

- 增加设置 schema 和类型；
- 加入官方 MCP SDK；
- 实现 Registry 初始化、发现、状态、call、reload、dispose；
- 接入扩展激活和配置监听；
- 完成配置与 Registry 测试。

验收后才进入 Agent 接入。

### Milestone 2：快照和 ToolSet 接入

- 扩展 AgentType defaults 和 Agent metadata；
- 统一 Agent 创建快照；
- 实现 Adapter、命名和结果转换；
- 接入 Notebook/HTTP ToolSet；
- 保持 `task_finish` 独立注入；
- 完成审批和运行测试。

### Milestone 3：ContextTree 和体验

- 增加 MCPS 分类、Server/Tool 状态；
- 增加 toggle/refresh 命令；
- 增加 metadata/registry/config 事件刷新；
- 补齐 i18n 和用户错误提示；
- 完成端到端回归。

不得在 Milestone 1 中顺手实现 OAuth、动态 tool change、自动重连等超出范围能力。

---

## 18. 最终验收标准

完成后，用户可以：

1. 在 VS Code Settings 中配置 Mutsumi MCP Servers；
2. 看到 Server 连接状态和发现的 Tools；
3. 为 AgentType 指定默认 MCP Server IDs；
4. 创建 Agent 时得到当时可用 Tool 的冻结快照；
5. 在 ContextTree 中按 Server 或按 Tool 修改该 Agent 的 MCP 能力；
6. 在 Notebook 和 HTTP Agent 中获得一致的 MCP Tool 注入；
7. 让只读 Tool 自动执行，让非只读 Tool 复用现有审批流程；
8. 在 Server 失败时继续使用 Mutsumi 的其他能力，并通过 Refresh 明确重试；
9. 继续保持子 Agent 的 `task_finish` 注入和现有内置工具权限体系不变。

该最终状态以简单、统一和可维护为优先：一个扩展级 MCP Registry、一个通用 MCP Tool Adapter、一份会话工具选择快照，以及对现有 ToolSet 的窄接入。