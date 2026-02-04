# agentOrchestrator.ts 技术文档

## 文件功能概述

`agentOrchestrator.ts` 是 Mutsumi VSCode 插件的**核心编排模块**，负责管理 Agent 的生命周期、协调多 Agent 之间的 Fork 关系、维护全局 Agent 状态注册表，并处理 UI 的刷新逻辑。

作为单例类（Singleton），它是整个系统中 Agent 状态管理的中央枢纽。

---

## 主要接口

### `ForkSession`

Fork 会话数据结构，用于跟踪父 Agent 创建的子 Agent 群。

```typescript
interface ForkSession {
    parentId: string;                    // 父 Agent UUID
    resolve: (value: string | PromiseLike<string>) => void;  // Promise 解析函数
    reject: (reason?: any) => void;      // Promise 拒绝函数
    childUuids: Set<string>;             // 子 Agent UUID 集合
    results: Map<string, string>;        // uuid -> 报告内容
    deletedChildren: Set<string>;        // 被删除的子 Agent 记录
}
```

---

## 主要类：AgentOrchestrator

### 类属性

| 属性名 | 类型 | 说明 |
|--------|------|------|
| `instance` | `AgentOrchestrator` | 单例实例（静态） |
| `sidebar` | `AgentSidebarProvider` | 侧边栏提供者引用 |
| `agentController` | `AgentController` | Agent 控制器引用 |
| `notebookController` | `vscode.NotebookController` | Notebook 控制器引用 |
| `agentRegistry` | `Map<string, AgentStateInfo>` | 全局 Agent 状态注册表（UUID -> Info） |
| `activeForks` | `Map<string, ForkSession>` | 活跃的 Fork 会话（ParentUUID -> Session） |

---

### 核心方法

#### `getInstance(): AgentOrchestrator`

**功能**：获取 `AgentOrchestrator` 的单例实例。

**返回值**：`AgentOrchestrator` 实例

---

#### `setSidebar(sidebar: AgentSidebarProvider): void`

**功能**：设置侧边栏提供者引用，用于 UI 刷新。

**参数**：
- `sidebar` - 侧边栏提供者实例

---

#### `registerController(agentController, notebookController): void`

**功能**：注册控制器引用。

**参数**：
- `agentController` - Agent 控制器实例
- `notebookController` - Notebook 控制器实例

---

#### `getAgentTreeNodes(): AgentStateInfo[]`

**功能**：计算并获取用于 TreeView 展示的节点列表。

**UI 规则**：
1. 已完成的子 Agent 且窗口已关闭 → 隐藏
2. 待机的父 Agent（窗口打开，未运行）→ 显示
3. 隐藏的父 Agent（窗口关闭，未运行）→ 隐藏

**返回值**：过滤后的 Agent 状态信息数组

---

#### `computeStatus(agent: AgentStateInfo): AgentRuntimeStatus`

**功能**：计算 Agent 的运行时状态。

**状态定义**：
- `'running'` - 正在运行
- `'finished'` - 任务已完成
- `'pending'` - 子 Agent，未运行未完成
- `'standby'` - 母 Agent，未运行

**参数**：
- `agent` - Agent 状态信息

**返回值**：运行时状态字符串

---

#### `requestFork(parentId, contextSummary, subAgents, signal?): Promise<string>`

**功能**：工具调用请求 Fork，创建子 Agent 群并等待它们完成。

**参数**：
| 参数名 | 类型 | 说明 |
|--------|------|------|
| `parentId` | `string` | 父 Agent UUID |
| `contextSummary` | `string` | 上下文摘要（预留） |
| `subAgents` | `{ prompt: string; allowed_uris: string[] }[]` | 子 Agent 配置数组 |
| `signal` | `AbortSignal` | 可选的中止信号 |

**返回值**：`Promise<string>` - 所有子 Agent 完成后的汇总报告

**工作流程**：
1. 创建 ForkSession 并注册到 activeForks
2. 为每个子 Agent 创建文件并打开窗口
3. 挂起等待子 Agent 完成
4. 收集所有结果并生成报告

---

#### `createAndOpenAgent(uuid, parentId, prompt, allowedUris): Promise<void>`

**功能**：创建子 Agent 文件并在侧边打开窗口。

**参数**：
- `uuid` - 子 Agent UUID
- `parentId` - 父 Agent UUID
- `prompt` - 任务提示
- `allowedUris` - 允许的 URI 列表

---

#### `notifyNotebookOpened(uuid, uri, metadata): void`

**功能**：当 Notebook 文件被打开时调用，更新注册表状态。

**参数**：
- `uuid` - Agent UUID
- `uri` - 文件 URI
- `metadata` - 文件元数据

---

#### `notifyNotebookClosed(uuid): void`

**功能**：当 Notebook 文件被关闭时调用，更新窗口状态。

**参数**：
- `uuid` - Agent UUID

---

#### `notifyAgentStarted(uuid): void`

**功能**：当 Agent 开始运行时调用，标记运行状态。

**参数**：
- `uuid` - Agent UUID

---

#### `notifyAgentStopped(uuid): void`

**功能**：当 Agent 停止运行时调用，清除运行状态。

**参数**：
- `uuid` - Agent UUID

---

#### `reportTaskFinished(childUuid, summary): void`

**功能**：当 `task_finish` 工具被调用时触发，标记任务完成并收集结果。

**参数**：
- `childUuid` - 子 Agent UUID
- `summary` - 任务完成摘要

---

#### `notifyFileDeleted(uri): Promise<void>`

**功能**：当文件被删除时调用，清理注册表并处理 Fork 会话。

**参数**：
- `uri` - 被删除文件的 URI

---

#### `checkSessionCompletion(parentId): void`

**功能**：检查 Fork 会话是否完成（所有子 Agent 都已报告或被删除）。

**参数**：
- `parentId` - 父 Agent UUID

---

#### `getAgentById(uuid): AgentStateInfo \| undefined`

**功能**：通过 UUID 获取 Agent 信息。

**参数**：
- `uuid` - Agent UUID

**返回值**：Agent 状态信息或 undefined

---

## 与其他模块的关系

```
AgentOrchestrator
    ├── 被 extension.ts 初始化（setSidebar, registerController）
    ├── 被 agentRunner.ts 调用（reportTaskFinished）
    ├── 被 controller.ts 调用（notifyAgentStarted, notifyAgentStopped）
    ├── 管理 AgentSidebarProvider（刷新 UI）
    └── 创建/管理 AgentRunner 的 Fork 会话
```

---

## 使用示例

### 获取单例并注册组件

```typescript
const orchestrator = AgentOrchestrator.getInstance();
orchestrator.setSidebar(sidebarProvider);
orchestrator.registerController(agentController, notebookController);
```

### 在 AgentRunner 中报告任务完成

```typescript
// 当子 Agent 调用 task_finish 时
AgentOrchestrator.getInstance().reportTaskFinished(uuid, summary);
```

### 请求 Fork（内部使用）

```typescript
const report = await AgentOrchestrator.getInstance().requestFork(
    parentId,
    "上下文摘要",
    [
        { prompt: "分析代码", allowed_uris: ["/src"] },
        { prompt: "生成文档", allowed_uris: ["/doc"] }
    ],
    abortSignal
);
```
