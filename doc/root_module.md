# Root Module（根模块）

## 1. 模块名称与定位

**Agent系统的编排与执行核心** — 根模块是Mutsumi VSCode插件的核心引擎，负责Agent生命周期的全链路管理、任务编排、执行调度与工具协调，是连接VSCode扩展框架与Agent运行时环境的枢纽层。

---

## 2. 文件组成与职责

### 2.1 extension.ts — 扩展入口
**职责**：插件生命周期管理

| 成员 | 类型 | 职责 |
|------|------|------|
| `activate(context)` | 函数 | 插件激活入口，初始化控制器、命令注册、状态管理 |
| `deactivate()` | 函数 | 插件停用清理，释放资源、终止运行中的Agent |

**关键逻辑**：
- 创建`Controller`实例，注入VSCode扩展上下文
- 注册命令（如打开Notebook、清除对话等）
- 监听工作区变化，维护持久化状态

---

### 2.2 agentOrchestrator.ts — Agent编排器
**职责**：单例管理Agent生命周期、分叉会话、Agent树状态管理

| 成员 | 类型 | 职责 |
|------|------|------|
| `AgentOrchestrator` | 类 | 单例类，全局Agent管理中枢 |
| `createAgent(context, strategy)` | 方法 | 创建新Agent实例，分配唯一ID，建立父子关系 |
| `requestFork(parentId, subAgents, context)` | 方法 | 创建子Agent会话，构建Agent分叉树 |
| `terminateAgent(agentId, reason)` | 方法 | 终止指定Agent及其所有子Agent |
| `getAgentStatus(agentId)` | 方法 | 查询Agent运行时状态 |
| `getAgentTree()` | 方法 | 获取当前Agent树形结构快照 |
| `onAgentStatusChanged` | 事件 | Agent状态变更通知（Idle → Running → Completed/Error） |

**状态管理**：
```
Agent状态机：Idle → Running → [Completed | Error | Terminated]
                    ↓
                Forking（分叉中）
```

---

### 2.3 agentRunner.ts — Agent执行器
**职责**：Agent主运行循环、流式响应处理、工具调用执行、UI渲染

| 成员 | 类型 | 职责 |
|------|------|------|
| `AgentRunner` | 类 | Agent执行引擎，每个Agent对应一个Runner实例 |
| `run(agentContext, messages)` | 方法 | 主执行循环，与LLM建立流式连接 |
| `handleStreamChunk(chunk)` | 方法 | 处理流式响应分片，解析内容/工具调用 |
| `executeToolCall(toolCall)` | 方法 | 执行工具调用，分发到ToolManager |
| `renderToUI(content)` | 方法 | 将内容渲染到VSCode Notebook单元格 |
| `pause()` / `resume()` | 方法 | 暂停/恢复Agent执行 |
| `abort()` | 方法 | 强制中断当前执行 |

**执行流程**：
1. 构造LLM请求（消息历史 + 系统提示 + 可用工具）
2. 流式接收响应，实时解析`<thinking>`、`<response>`、`<tool_call>`标签
3. 若检测到工具调用 → 暂停流式接收 → 执行工具 → 将结果注入上下文 → 继续循环
4. 若检测到响应结束标记 → 完成本轮输出 → 等待用户输入

---

### 2.4 controller.ts — 控制器
**职责**：处理单元格执行和工具执行调度

| 成员 | 类型 | 职责 |
|------|------|------|
| `Controller` | 类 | Notebook执行控制器，响应VSCode执行事件 |
| `executeCellsHandler(cells, notebook, controller)` | 方法 | VSCode Notebook执行回调入口 |
| `scheduleToolExecution(toolName, args, cellId)` | 方法 | 将工具执行请求加入调度队列 |
| `cancelExecution(cellId)` | 方法 | 取消指定单元格的执行 |
| `onDidChangeExecutionState` | 事件 | 执行状态变更通知（VSCode集成） |

**核心逻辑**：
- 作为VSCode Notebook Controller的实现者
- 解析单元格内容，区分用户输入/系统指令/工具输出
- 协调`AgentOrchestrator`和`AgentRunner`完成实际执行

---

### 2.5 toolManager.ts — 工具管理器
**职责**：管理通用工具/主Agent专用工具/子Agent专用工具的注册与执行

| 成员 | 类型 | 职责 |
|------|------|------|
| `ToolManager` | 类 | 工具注册中心与执行分发器 |
| `registerTool(tool, scope)` | 方法 | 注册工具到指定作用域（Common/Main/Sub） |
| `unregisterTool(toolName, scope)` | 方法 | 注销指定工具 |
| `getToolsForAgent(agentType)` | 方法 | 根据Agent类型获取可用工具列表 |
| `executeTool(toolName, args, agentContext)` | 方法 | 执行指定工具，返回执行结果 |
| `getToolSchema(toolName)` | 方法 | 获取工具的JSON Schema描述（用于LLM） |

**工具作用域**：
| 作用域 | 可用Agent类型 | 典型工具 |
|--------|---------------|----------|
| `Common` | 所有Agent | read_file, write_file, shell_exec |
| `Main` | 仅主Agent | 暂无 |
| `Sub` | 仅子Agent | task_finish（子Agent专属完成标记） |

---

### 2.6 types.ts — 核心类型定义
**职责**：定义Agent系统的核心数据结构

| 类型/接口 | 说明 |
|-----------|------|
| `AgentMetadata` | Agent元数据（ID、父ID、创建时间、类型、标签） |
| `AgentMessage` | 消息结构（role: system/user/assistant/tool, content, tool_calls, tool_call_id） |
| `AgentContext` | Agent运行时上下文（metadata、消息历史、环境变量、配置） |
| `AgentRuntimeStatus` | 运行时状态枚举（Idle/Running/Completed/Error/Terminated/Forking） |
| `ToolDefinition` | 工具定义结构（name, description, parameters schema, scope） |
| `ToolCall` | 工具调用结构（id, name, arguments） |
| `ToolResult` | 工具执行结果结构（success, content, error） |
| `AgentStrategy` | Agent创建策略（类型、系统提示模板、最大迭代次数、工具白名单） |

---

## 3. 关键交互流程

### 3.1 Agent从创建到完成的完整生命周期

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              主流程：Agent生命周期                              │
└─────────────────────────────────────────────────────────────────────────────┘

[用户触发执行]
        ↓
┌─────────────────┐
│  extension.ts   │ ──→ 调用 Controller.executeCellsHandler()
└────────┬────────┘
         ↓
┌─────────────────┐     ┌──────────────────────────────────────────┐
│  controller.ts  │ ──→ │ 解析单元格内容 → 确定Agent策略 → 创建/复用Agent │
└────────┬────────┘     └──────────────────────────────────────────┘
         ↓
┌─────────────────────┐  分配唯一AgentID，建立父子关系，注册到全局Map
│ agentOrchestrator.ts │ ──→ AgentOrchestrator.createAgent(context, strategy)
└────────┬────────────┘
         ↓
┌─────────────────┐     创建Runner实例，绑定到AgentID
│ agentRunner.ts  │ ──→ new AgentRunner(agentId, context)
└────────┬────────┘
         ↓
         ╔═══════════════════════════════════════════════════════════════╗
         ║                     【主执行循环】                             ║
         ║  ┌─────────────────────────────────────────────────────────┐  ║
         ║  │ 1. 构造请求：合并系统提示 + 消息历史 + 可用工具Schema      │  ║
         ║  │ 2. 调用LLM API，建立SSE流式连接                          │  ║
         ║  │ 3. 流式解析响应：                                         │  ║
         ║  │    ├─ 普通内容 → 实时渲染到UI                            │  ║
         ║  │    └─ 检测到<tool_call> → 暂停流式接收                    │  ║
         ║  │         ↓                                               │  ║
         ║  │    调用 ToolManager.executeTool()                        │  ║
         ║  │         ↓                                               │  ║
         ║  │    将ToolResult注入消息历史                               │  ║
         ║  │         ↓                                               │  ║
         ║  │    继续下一轮循环（除非收到结束标记或达到最大轮数）        │  ║
         ║  └─────────────────────────────────────────────────────────┘  ║
         ╚═══════════════════════════════════════════════════════════════╝
         ↓
    [执行完成/错误/用户中断]
         ↓
┌─────────────────────┐
│ agentOrchestrator.ts │ ──→ 更新Agent状态，触发onAgentStatusChanged事件
└─────────────────────┘         ├─ 若为主Agent且正常完成 → 清理资源
                                └─ 若为子Agent → 通过某种机制通知父Agent（TODO）
```

### 3.2 工具调用流程

```
[LLM响应中检测到<tool_call>标签]
                ↓
┌─────────────────┐
│ agentRunner.ts  │ ──→ parseToolCallFromStream() → ToolCall对象
└────────┬────────┘
         ↓
┌─────────────────┐     验证工具名、参数Schema
│ toolManager.ts  │ ──→ ToolManager.executeTool(toolName, args, agentContext)
└────────┬────────┘
         ↓
    ┌────┴────┐
    ↓         ↓
┌───────┐ ┌───────┐
│通用工具 │ │专用工具│ ──→ 实际执行（可能调用VSCode API、Shell命令、其他模块等）
└───┬───┘ └───┬───┘
    └────┬────┘
         ↓
┌─────────────────┐
│ toolManager.ts  │ ──→ 封装ToolResult（成功/失败 + 内容 + 错误信息）
└────────┬────────┘
         ↓
┌─────────────────┐     将ToolResult格式化为assistant的tool消息
│ agentRunner.ts  │ ──→ 追加到messages数组，继续LLM调用
└─────────────────┘
```

### 3.3 Agent分叉（Fork）流程

```
[主Agent执行中遇到可并行任务]
                ↓
┌─────────────────┐
│ agentRunner.ts  │ ──→ 检测到需要fork（通过LLM输出或策略判断）
└────────┬────────┘
         ↓
┌─────────────────────┐     暂停主Agent执行
│ agentOrchestrator.ts │ ──→ forkAgent(parentId, subAgents[], context)
└────────┬────────────┘
         ↓
    ┌────┴────┬────────┬────────┐  为每个子任务创建子Agent
    ↓         ↓        ↓        ↓
 Agent-1   Agent-2  Agent-3  ... (并行执行)
    └─────────┴────────┴────────┘
              ↓
    [等待所有子Agent完成]
              ↓
    ┌─────────┴────────┐
    ↓                  ↓
 成功完成           部分失败
    ↓                  ↓
合并结果返回        错误处理/重试策略
主Agent继续         （取决于策略配置）
```

---

## 4. 模块边界

### 4.1 与VSCode API的交互接口

| 接口点 | 文件 | VSCode API | 用途 |
|--------|------|------------|------|
| 扩展激活 | `extension.ts` | `vscode.ExtensionContext` | 插件生命周期管理 |
| Notebook控制 | `controller.ts` | `vscode.NotebookController` | 单元格执行控制 |
| UI渲染 | `agentRunner.ts` | `vscode.NotebookEdit`, `workspace.applyEdit` | 动态更新Notebook内容 |
| 状态栏/通知 | `agentRunner.ts` | `vscode.window.showInformationMessage` | 用户通知 |
| 命令注册 | `extension.ts` | `vscode.commands.registerCommand` | 命令面板集成 |
| 配置读取 | `extension.ts` | `vscode.workspace.getConfiguration` | 读取Mutsumi设置 |
| 文件系统 | `toolManager.ts` | `vscode.workspace.fs` | 文件读写工具底层 |

### 4.2 与其他模块的交互接口

```
┌────────────────────────────────────────────────────────────────────────────┐
│                              根模块（本模块）                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │extension.ts  │  │agentOrchestra│  │ agentRunner  │  │  controller  │   │
│  │              │  │   tor.ts     │  │   .ts        │  │   .ts        │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
└─────────┼─────────────────┼─────────────────┼─────────────────┼───────────┘
          │                 │                 │                 │
          │    ┌────────────┴─────────────────┴─────────────────┘            │
          │    │                           ▲                                  │
          │    ↓                           │                                  │
          │ ┌──────────────────────────────────────────────┐                 │
          │ │           内部调用（紧密耦合）                  │                 │
          └─┤• Controller调用AgentOrchestrator.createAgent() │                 │
            │• AgentOrchestrator管理AgentRunner实例生命周期  │                 │
            │• AgentRunner调用ToolManager.executeTool()     │                 │
            └──────────────────────────────────────────────┘                 │
                                      │
    ┌─────────────────────────────────┼─────────────────────────────────┐
    │                                 ↓                                 │
    │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐   │
    │  │   LLM Module    │  │   Tool Module   │  │  Session Module │   │
    │  │                 │  │                 │  │                 │   │
    │  │ • API客户端封装  │  │ • 工具实现集合   │  │ • 会话持久化    │   │
    │  │ • 流式响应处理   │  │ • 外部工具集成   │  │ • 状态恢复      │   │
    │  │ • 模型配置管理   │  │ • 权限控制      │  │ • 历史记录      │   │
    │  └─────────────────┘  └─────────────────┘  └─────────────────┘   │
    │         ↑                    ↑                    ↑             │
    │         └────────────────────┴────────────────────┘             │
    │                      外部依赖（松耦合）                          │
    │              • 通过接口定义交互契约                              │
    │              • 支持Mock/Stub替换                                 │
    └─────────────────────────────────────────────────────────────────┘
```

### 4.3 依赖方向说明

| 依赖模块 | 依赖类型 | 说明 |
|----------|----------|------|
| **LLM Module** | 运行时依赖 | AgentRunner调用LLM客户端发送请求，接收流式响应 |
| **Tool Module** | 运行时依赖 | ToolManager委托具体工具实现执行，工具实现可能位于独立模块 |
| **Session Module** | 可选依赖 | AgentOrchestrator在状态变更时触发会话持久化 |
| **Protocol Module** | 编译依赖 | types.ts可能复用Protocol模块的基础类型定义 |

### 4.4 对外暴露的公共API

根模块作为核心引擎，向上层（VSCode扩展框架）暴露以下关键接口：

```typescript
// 扩展入口
export function activate(context: vscode.ExtensionContext): void;
export function deactivate(): void;

// 控制器（VSCode Notebook集成）
export class Controller {
  constructor(context: vscode.ExtensionContext);
  readonly id: string;
}

// Agent状态查询（供其他模块/调试使用）
export class AgentOrchestrator {
  static getInstance(): AgentOrchestrator;
  getAgentStatus(agentId: string): AgentRuntimeStatus;
  getAgentTree(): AgentTreeSnapshot;
  onAgentStatusChanged: vscode.Event<AgentStatusChangeEvent>;
}

// 类型定义（供全系统复用）
export * from './types';
```

---

## 5. 设计要点与约束

### 5.1 单例模式应用
- `AgentOrchestrator`为全局单例，确保所有Agent生命周期统一管理
- `ToolManager`为全局单例，避免工具重复注册

### 5.2 并发控制
- 主Agent与子Agent之间：并行执行，子Agent完成前主Agent暂停
- 子Agent之间：完全并行，无执行依赖
- 同一会话内：建议限制最大并发Agent数（可配置，默认4）

### 5.3 错误传播
- Agent执行错误 → 通过`onAgentStatusChanged`事件向上传播
- 工具执行错误 → 封装为ToolResult返回给Agent，由LLM决定后续策略

### 5.4 资源清理
- 确保`deactivate()`时终止所有运行中的Agent
- 子Agent完成后及时释放资源，避免内存泄漏

---

*文档版本: 1.0*  
*最后更新: 基于Mutsumi架构设计*
