# agentOrchestrator.ts

## 概述

`agentOrchestrator.ts` 负责管理 Agent 的生命周期、fork 会话和 UI 状态。它实现了全局 Agent 注册表，处理子 Agent 的 fork 会话，并通过侧边栏提供者协调 UI 更新。

## 接口

### ForkSession

表示一个活跃的 fork 会话及其状态和回调。

| 属性 | 类型 | 说明 |
|------|------|------|
| `parentId` | `string` | 发起 fork 的父 Agent ID |
| `resolve` | `function` | fork Promise 的 resolve 回调 |
| `reject` | `function` | fork Promise 的 reject 回调 |
| `childUuids` | `Set<string>` | 该会话中子 Agent 的 UUID 集合 |
| `results` | `Map<string, string>` | 子 UUID 到其结果报告的映射 |
| `deletedChildren` | `Set<string>` | 被删除的子 Agent UUID 集合 |

## 类

### AgentOrchestrator

管理 Agent 生命周期、状态管理和 fork 操作的协调器类。使用单例模式实现。

#### 构造函数

```typescript
private constructor()
```

私有构造函数，强制使用单例模式。

#### 静态方法

##### getInstance()

获取 AgentOrchestrator 的单例实例。

```typescript
public static getInstance(): AgentOrchestrator
```

**返回值**: `AgentOrchestrator` - 单例实例

#### 公共方法

##### setSidebar()

设置用于 UI 更新的侧边栏提供者。

```typescript
public setSidebar(sidebar: AgentSidebarProvider): void
```

**参数**:
- `sidebar` - 侧边栏提供者实例

##### registerController()

注册 Agent 和 Notebook 控制器。

```typescript
public registerController(
    agentController: AgentController, 
    notebookController: vscode.NotebookController
): void
```

**参数**:
- `agentController` - Agent 控制器
- `notebookController` - Notebook 控制器

##### getAgentTreeNodes()

计算并返回用于 TreeView 显示的节点。

```typescript
public getAgentTreeNodes(): AgentStateInfo[]
```

**返回值**: `AgentStateInfo[]` - 要在侧边栏显示的 Agent 节点数组

**说明**:
- 现在显示整个树（如果树中任何节点窗口打开），而不是单独过滤每个 Agent
- 获取所有 Agent，按根 Agent 分组
- 对于每棵树，如果树中有任何窗口打开，则整棵树可见
- 窗口已关闭的已完成子 Agent 会被隐藏
- 窗口已关闭且未运行的隐藏父 Agent 会被隐藏
- 窗口打开但未运行的待机父 Agent 会显示

##### computeStatus()

计算 Agent 的运行时状态。

```typescript
public computeStatus(agent: AgentStateInfo): AgentRuntimeStatus
```

**参数**:
- `agent` - Agent 状态信息

**返回值**: `AgentRuntimeStatus` - 计算出的运行时状态，可能值为：
- `'running'` - 运行中
- `'finished'` - 已完成
- `'pending'` - 等待中（有父 Agent）
- `'standby'` - 待机

##### requestFork()

请求 fork 以创建子 Agent。

```typescript
public async requestFork(
    parentId: string, 
    contextSummary: string, 
    subAgents: { prompt: string; allowed_uris: string[]; model?: string }[],
    signal?: AbortSignal
): Promise<string>
```

**参数**:
- `parentId` - 父 Agent 的 UUID
- `contextSummary` - fork 操作的上下文摘要
- `subAgents` - 子 Agent 配置数组，每个配置包含：
  - `prompt` - 初始提示词
  - `allowed_uris` - 允许的 URI 列表
  - `model` - 可选的模型标识符
- `signal` - 可选的取消信号

**返回值**: `Promise<string>` - 所有子 Agent 的聚合报告

**抛出**: 如果操作被取消，抛出 `Error`

**说明**: 创建多个子 Agent，等待它们完成，并将结果聚合成最终报告。

##### notifyNotebookOpened()

通知 Notebook 已被打开。

```typescript
public async notifyNotebookOpened(uuid: string, uri: vscode.Uri, metadata: any): Promise<void>
```

**参数**:
- `uuid` - Agent UUID
- `uri` - 文档 URI
- `metadata` - Notebook 元数据

**说明**: 
- 在 Notebook 文档打开时调用，在注册表中注册或更新 Agent 状态
- 现在为异步方法，加载整个树和祖先
- 如果 metadata 中包含父 ID，则递归加载整个祖先链
- 加载子 Agent 树，确保整棵树的 Agent 都在注册表中

##### notifyNotebookClosed()

通知 Notebook 已被关闭。

```typescript
public notifyNotebookClosed(uuid: string): void
```

**参数**:
- `uuid` - Agent UUID

**说明**: 更新 Agent 的窗口状态。已完成的子 Agent 将被隐藏。

##### notifyAgentStarted()

通知 Agent 已开始运行。

```typescript
public notifyAgentStarted(uuid: string): void
```

**参数**:
- `uuid` - Agent UUID

**说明**: 由控制器在执行开始时调用。

##### notifyAgentStopped()

通知 Agent 已停止运行。

```typescript
public notifyAgentStopped(uuid: string): void
```

**参数**:
- `uuid` - Agent UUID

**说明**: 由控制器在执行结束时调用。

##### reportTaskFinished()

报告子 Agent 任务已完成。

```typescript
public reportTaskFinished(childUuid: string, summary: string): void
```

**参数**:
- `childUuid` - 子 Agent UUID
- `summary` - 任务完成摘要

**说明**: 在子 Agent 调用 task_finish 工具时调用。存储结果并检查 fork 会话中的所有子 Agent 是否都已完成。

##### notifyFileDeleted()

通知 Agent 文件已被删除。

```typescript
public async notifyFileDeleted(uri: vscode.Uri): Promise<void>
```

**参数**:
- `uri` - 被删除文件的 URI

**说明**: 
- 从注册表中移除 Agent 并更新任何活跃的 fork 会话
- 现在清理双向引用：
  - 从父节点的 `childIds` 中移除该 Agent 的 UUID
  - 从父节点的 `sub_agents_list` 中移除对应条目
  - 将该 Agent 的所有子节点的 `parentId` 设为 null

##### getAgentById()

通过 UUID 获取 Agent。

```typescript
public getAgentById(uuid: string): AgentStateInfo | undefined
```

**参数**:
- `uuid` - Agent UUID

**返回值**: `AgentStateInfo | undefined` - Agent 状态信息，如果未找到则返回 undefined

#### 私有方法

##### createAndOpenAgent()

创建新的子 Agent 文件并打开其 Notebook 窗口。

```typescript
private async createAndOpenAgent(
    uuid: string, 
    parentId: string, 
    prompt: string, 
    allowedUris: string[], 
    model?: string
): Promise<void>
```

**说明**: 
- 在工作区 `.mutsumi` 目录下创建 `.mtm` 文件
- 使用配置中的默认模型（如果未指定模型）
- 在文件中写入元数据和初始上下文
- 现在写入 `sub_agents_list` 到 metadata（初始为空数组）
- 更新父节点的 `childIds`，将新创建的子 Agent UUID 添加进去

##### cancelSession()

取消活跃的 fork 会话。

```typescript
private cancelSession(parentId: string, reason: string): void
```

##### checkSessionCompletion()

检查 fork 会话是否完成并 resolve Promise。

```typescript
private checkSessionCompletion(parentId: string): void
```

**说明**: 当子 Agent 完成或被删除时调用。如果所有子 Agent 都已处理完毕，生成最终报告并 resolve 会话。

##### refreshUI()

刷新侧边栏 UI。

```typescript
private refreshUI(): void
```

##### getRootId()

获取树的根 Agent ID，通过遍历父指针。

```typescript
private getRootId(uuid: string): string
```

**参数**:
- `uuid` - Agent UUID

**返回值**: `string` - 根 Agent 的 UUID

**说明**: 沿着 `parentId` 链向上遍历，直到找到没有父节点的根 Agent。

##### hasAnyWindowOpenInTree()

检查树中是否有任何 Agent 窗口打开。

```typescript
private hasAnyWindowOpenInTree(rootId: string): boolean
```

**参数**:
- `rootId` - 树根 Agent 的 UUID

**返回值**: `boolean` - 如果树中任何 Agent 窗口打开则返回 true

**说明**: 遍历以 rootId 为根的整棵树，检查是否有任何 Agent 的窗口处于打开状态。

##### loadAgentFromFile()

从文件加载 Agent。

```typescript
private async loadAgentFromFile(uuid: string): Promise<AgentStateInfo | undefined>
```

**参数**:
- `uuid` - Agent UUID

**返回值**: `Promise<AgentStateInfo | undefined>` - Agent 状态信息，如果文件不存在则返回 undefined

**说明**: 从 `.mutsumi` 目录下的 `.mtm` 文件读取 Agent 的 metadata 并构建 AgentStateInfo 对象。

##### loadAgentTree()

递归加载整个 Agent 树。

```typescript
private async loadAgentTree(uuid: string, visited?: Set<string>): Promise<void>
```

**参数**:
- `uuid` - 当前 Agent 的 UUID
- `visited` - 可选，已访问的 UUID 集合，用于防止循环引用

**说明**: 
- 递归加载指定 Agent 及其所有后代
- 使用 visited 集合防止循环引用导致的无限递归
- 将所有加载的 Agent 添加到注册表中

##### updateAgentParentInFile()

更新文件中 Agent 的父引用。

```typescript
private async updateAgentParentInFile(uuid: string, newParentId: string | null): Promise<void>
```

**参数**:
- `uuid` - Agent UUID
- `newParentId` - 新的父 Agent UUID，null 表示移除父引用

**说明**: 更新 `.mtm` 文件中 Agent 的 `parentId` 字段。

##### updateParentSubAgentsList()

更新父 Agent 的 sub_agents_list。

```typescript
private async updateParentSubAgentsList(parentUuid: string): Promise<void>
```

**参数**:
- `parentUuid` - 父 Agent 的 UUID

**说明**: 
- 根据当前注册表中的 childIds 重新构建 sub_agents_list
- 更新父 Agent 对应的 `.mtm` 文件中的 metadata

## 使用示例

```typescript
// 获取单例实例
const orchestrator = AgentOrchestrator.getInstance();

// 设置侧边栏
orchestrator.setSidebar(sidebarProvider);

// 注册控制器
orchestrator.registerController(agentController, notebookController);

// 请求 fork 创建子 Agent
const report = await orchestrator.requestFork(parentId, 'Task summary', [
    { prompt: 'Process A', allowed_uris: ['/path'], model: 'gpt-4' },
    { prompt: 'Process B', allowed_uris: ['/path'] }
]);

// 获取 Agent 树节点
const nodes = orchestrator.getAgentTreeNodes();

// 计算状态
const status = orchestrator.computeStatus(agent);
```
