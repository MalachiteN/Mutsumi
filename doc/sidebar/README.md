# Sidebar 模块

## 整体功能概述

Sidebar模块负责Mutsumi插件的侧边栏视图功能，包含三个主要树视图：

1. **Agent树视图**: 显示所有Agent的层级结构，展示Agent的名称、状态和父子关系
2. **审批请求树视图**: 显示工具调用的待审批请求列表，支持批准/拒绝操作
3. **活动编辑文件视图**: 显示正在等待用户确认的文件编辑会话

## 文件关系

```
┌─────────────────────────────────────────────────────────────┐
│                    AgentSidebarProvider                      │
│                    (agentSidebar.ts)                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  - 注册Agent树视图 (mutsumi.agentSidebar)           │   │
│  │  - 注册审批请求树视图 (mutsumi.approvalSidebar)     │   │
│  │  - 注册活动编辑文件树视图                           │   │
│  │  - 注册批准/拒绝命令                                │   │
│  └─────────────────────────────────────────────────────┘   │
│                              │                              │
│          ┌───────────────────┴───────────────────┐         │
│          ▼                                       ▼         │
│  ┌───────────────┐                    ┌───────────────┐    │
│  │ AgentTreeData │                    │ ApprovalTree  │    │
│  │   Provider    │                    │   Provider    │    │
│  │(agentTreeProv-│                    │(approvalTree- │    │
│  │    ider.ts)   │                    │ Provider.ts)  │    │
│  └───────┬───────┘                    └───────┬───────┘    │
│          │                                    │            │
│          ▼                                    ▼            │
│  ┌───────────────┐                    ┌───────────────┐    │
│  │  AgentTreeItem│                    │ ApprovalTree  │    │
│  │(agentTreeItem │                    │     Item      │    │
│  │    .ts)       │                    │(approvalTree-│    │
│  └───────────────┘                    │   Item.ts)    │    │
│                                       └───────┬───────┘    │
│                                               │            │
│                                       ┌───────┴───────┐    │
│                                       ▼               ▼    │
│                               ┌───────────────┐ ┌───────────┴───┐
│                               │ ApprovalTree  │ │ EditFileTree  │
│                               │     Item      │ │     Item      │
│                               │               │ │(editFileTree- │
│                               │               │ │   Item.ts)    │
│                               └───────────────┘ └───────────────┘
└─────────────────────────────────────────────────────────────┘
```

### 数据流说明

1. **AgentSidebarProvider** 作为主控制器，创建并注册三个树视图
2. **AgentTreeDataProvider** 从 `AgentOrchestrator` 获取Agent数据，使用 `childIds` 构建层级结构
3. **ApprovalTreeDataProvider** 从 `approvalManager` 获取审批请求数据
4. **ApprovalTreeDataProvider** 同时管理两种类型的项目：
   - **ApprovalTreeItem**: 常规工具调用审批请求
   - **EditFileTreeItem**: 文件编辑会话等待用户确认
5. 编辑会话的数据流：`editFileSessionManager` → `ApprovalTreeDataProvider` → `EditFileTreeItem`

## 主要导出项

| 文件名 | 导出项 | 类型 | 说明 |
|--------|--------|------|------|
| agentSidebar.ts | AgentSidebarProvider | 类 | 侧边栏主控制器 |
| agentTreeItem.ts | AgentNodeData | 接口 | Agent节点数据结构 |
| agentTreeItem.ts | AgentTreeItem | 类 | Agent树节点项 |
| agentTreeProvider.ts | AgentTreeDataProvider | 类 | Agent树数据提供者 |
| approvalTreeItem.ts | ApprovalTreeItem | 类 | 审批请求树节点项 |
| approvalTreeItem.ts | EditFileTreeItem | 类 | 文件编辑会话树节点项 |
| approvalTreeProvider.ts | ApprovalTreeDataProvider | 类 | 审批请求数据提供者 |

## 文件说明

| 文件 | 功能描述 |
|------|----------|
| [agentSidebar.ts](./agentSidebar.md) | 侧边栏主控制器，注册树视图和命令 |
| [agentTreeItem.ts](./agentTreeItem.md) | Agent树节点定义，包含状态图标和描述 |
| [agentTreeProvider.ts](./agentTreeProvider.md) | Agent树数据管理，使用 childIds 构建层级结构 |
| [approvalTreeItem.ts](./approvalTreeItem.md) | 审批请求和编辑会话节点定义，包含状态图标和提示 |
| [approvalTreeProvider.ts](./approvalTreeProvider.md) | 审批请求和编辑会话数据管理，自动同步变更 |
