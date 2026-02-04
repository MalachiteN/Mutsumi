# Sidebar 模块

> **VSCode 侧边栏 UI 的统一管理器，提供 Agent 树视图与审批队列视图的集成展示**

---

## 目录

1. [模块定位](#模块定位)
2. [文件组成与职责](#文件组成与职责)
3. [UI 架构](#ui-架构)
4. [状态同步机制](#状态同步机制)
5. [模块边界](#模块边界)

---

## 模块定位

Sidebar 模块是 Mutsumi VSCode 插件的前端呈现层，负责将 Agent 系统的运行时状态以可视化的方式呈现在 VSCode 侧边栏中。该模块通过 TreeView API 构建两个核心视图：**Agent 侧边栏**展示 Agent 的层次结构和工作状态，**审批请求侧边栏**展示待处理的执行请求。

---

## 文件组成与职责

| 文件 | 核心类 | 职责描述 |
|------|--------|----------|
| `agentSidebar.ts` | `AgentSidebarProvider` | **视图整合器**：统一管理 Agent 树和审批树的注册，处理全局刷新事件，协调两个视图的显示逻辑 |
| `agentTreeProvider.ts` | `AgentTreeDataProvider` | **Agent 数据提供者**：实现 `vscode.TreeDataProvider` 接口，从 `AgentOrchestrator` 获取 Agent 数据并转换为树形结构 |
| `agentTreeItem.ts` | `AgentTreeItem` | **Agent 节点表示**：封装单个 Agent 的 UI 状态，包括状态图标、工具提示、上下文菜单命令 |
| `approvalTreeProvider.ts` | `ApprovalTreeDataProvider` | **审批数据提供者**：实现 `vscode.TreeDataProvider` 接口，从 `approvalManager` 获取待审批请求列表 |
| `approvalTreeItem.ts` | `ApprovalTreeItem` | **审批项表示**：封装单个审批请求的 UI 展示，显示命令信息、状态图标和详细工具提示 |

### 文件关系图

```
┌─────────────────────────────────────────────────────────────┐
│                    AgentSidebarProvider                     │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  AgentTreeDataProvider  ←── AgentTreeItem[]        │   │
│  │         ↓                                           │   │
│  │  AgentOrchestrator.getAgentTreeNodes()              │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ApprovalTreeDataProvider ←── ApprovalTreeItem[]    │   │
│  │         ↓                                           │   │
│  │  approvalManager.getAllRequests()                   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                    ↓
         VSCode TreeView API
                    ↓
            [侧边栏 UI 渲染]
```

---

## UI 架构

### Agent 侧边栏

展示所有 Agent 的层次结构，支持展开/折叠、状态图标、上下文菜单。

```
📁 Mutsumi Agents
├── 🔄 Root Agent (Running)
│   ├── ✅ Worker-1 (Finished)
│   ├── ⏰ Worker-2 (Pending)
│   └── ○ Worker-3 (Standby)
├── 🔄 Sub-Agent-A (Running)
│   └── ⏰ Helper-1 (Pending)
└── ○ Sub-Agent-B (Standby)
```

**视图特性**：
- **层级结构**：反映 Agent 的父子关系
- **状态图标**：
  - 🔄 `sync~spin`: Running (运行中)
  - ✅ `check`: Finished (已完成)
  - ⏰ `clock`: Pending (等待中)
  - ○ `circle-outline`: Standby (待机)
  - ❓ `question`: Unknown (未知)

### 审批请求侧边栏

展示所有待审批的命令执行请求，按状态和时间排序（Pending 优先）。

```
📋 Approval Requests
├── 🟡 删除文件 file.txt (14:30:25)
│   └── [Approve] [Reject] (Inline Actions)
├── 🟡 创建目录 src/ (14:25:10)
└── 🟢 审批已通过: update config.json
```

**视图特性**：
- **列表显示**：扁平化列表，无层级
- **视觉区分**：
  - 🟡 黄色问号: Pending (待处理)
  - 🟢 绿色勾选: Approved (已批准)
  - 🔴 红色叉号: Rejected (已拒绝)
- **交互**：
  - 工具提示显示完整请求详情 (Target, Details, Time)
  - Inline 菜单提供 Approve/Reject 快捷操作

### 视图配置 (package.json)

```json
{
  "contributes": {
    "views": {
      "mutsumi-sidebar": [
        {
          "id": "mutsumi.agentSidebar",
          "name": "Agents",
          "when": "mutsumi:isActive"
        },
        {
          "id": "mutsumi.approvalSidebar",
          "name": "Approval Requests",
          "when": "mutsumi:isActive"
        }
      ]
    },
    "viewsContainers": {
      "activitybar": [
        {
          "id": "mutsumi-sidebar",
          "title": "Mutsumi",
          "icon": "$(remote-explorer)"
        }
      ]
    }
  }
}
```

---

## 状态同步机制

Sidebar 模块保持双向状态同步：

### 1. Agent 数据同步

- **数据源**：`AgentOrchestrator`
- **获取方式**：`AgentTreeDataProvider` 调用 `AgentOrchestrator.getAgentTreeNodes()`
- **更新触发**：`AgentOrchestrator` 状态变更 -> 触发事件 -> `AgentTreeDataProvider.refresh()`

### 2. 审批数据同步

- **数据源**：`approvalManager` (单例工具)
- **获取方式**：`ApprovalTreeDataProvider` 调用 `approvalManager.getAllRequests()`
- **更新触发**：`approvalManager` 触发 `onDidChangeRequests` -> `ApprovalTreeDataProvider.refresh()`

### 3. 刷新流程图

```
[Agent System]                  [Approval System]
      │                                │
AgentOrchestrator               approvalManager
      │ (State Changed)                │ (Request Added/Updated)
      ▼                                ▼
AgentTreeDataProvider.refresh() ApprovalTreeDataProvider.refresh()
      │                                │
      └──────────────┬─────────────────┘
                     │
            VSCode TreeView API
                     │
              UI 更新渲染
```

---

## 模块边界

### 与 VSCode API 的交互

Sidebar 模块严格遵循 VSCode TreeView API 规范：

- 实现 `TreeDataProvider` 接口
- 使用 `TreeItem` 定义节点外观
- 通过 `package.json` 定义视图容器和菜单

### 与核心逻辑的边界

| 边界方向 | Sidebar 模块 | 核心模块 | 交互方式 |
|----------|-------------|----------|----------|
| Agent 数据 | AgentTreeProvider | AgentOrchestrator | 方法调用 (`getAgentTreeNodes`) |
| 审批数据 | ApprovalTreeProvider | approvalManager | 方法调用 (`getAllRequests`) |
| 事件监听 | TreeProviders | Orchestrator/Manager | EventEmitter |
| 命令执行 | VSCode Command | Command Handlers | `vscode.commands.executeCommand` |

**关键原则**：
- Sidebar 模块是**只读展示层**，不直接修改 Agent 状态。
- 所有操作（如批准请求）通过执行注册的 VSCode 命令委托给业务逻辑层处理。

### 命令注册映射

以下命令由 `AgentSidebarProvider` 注册或在 `package.json` 中定义：

```typescript
// 审批相关命令
'mutsumi.approveRequest': (item) => approvalManager.approveRequest(item.request.id),
'mutsumi.rejectRequest': (item) => approvalManager.rejectRequest(item.request.id)

// Agent 相关命令 (示例，通常在 Agent 模块注册)
// 'mutsumi.killAgent'
```

---

## 相关文档

- [agentSidebar.md](./agentSidebar.md) - AgentSidebarProvider 详细文档
- [agentTreeProvider.md](./agentTreeProvider.md) - AgentTreeDataProvider 详细文档
- [agentTreeItem.md](./agentTreeItem.md) - AgentTreeItem 详细文档
- [approvalTreeProvider.md](./approvalTreeProvider.md) - ApprovalTreeDataProvider 详细文档
- [approvalTreeItem.md](./approvalTreeItem.md) - ApprovalTreeItem 详细文档
