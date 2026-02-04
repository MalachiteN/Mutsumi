# agentSidebar.ts

## 文件功能概述

`agentSidebar.ts` 是 Mutsumi 插件侧边栏模块的入口文件，负责注册和管理两个核心树视图：

1. **Agent 侧边栏** (`mutsumi.agentSidebar`) - 显示 Agent 的层级结构
2. **审批请求侧边栏** (`mutsumi.approvalSidebar`) - 显示待处理的审批请求

该类作为 VSCode 侧边栏功能的协调器，整合了 `AgentTreeDataProvider` 和 `ApprovalTreeDataProvider` 两个数据提供者。

---

## 类：AgentSidebarProvider

### 概述

侧边栏提供者的主类，负责初始化和注册 Agent 树视图及审批请求树视图。

### 属性

| 属性名 | 类型 | 说明 |
|--------|------|------|
| `viewType` | `string` (static readonly) | 视图类型标识符，值为 `'mutsumi.agentSidebar'` |
| `_agentTreeDataProvider` | `AgentTreeDataProvider` | Agent 树数据提供者实例 |
| `_approvalTreeDataProvider` | `ApprovalTreeDataProvider` | 审批请求树数据提供者实例 |
| `_agentTreeView` | `vscode.TreeView<any> \| undefined` | Agent 树视图实例 |
| `_approvalTreeView` | `vscode.TreeView<any> \| undefined` | 审批请求树视图实例 |
| `_extensionUri` | `vscode.Uri` | 扩展的 URI（私有，构造函数注入） |

### 构造函数

```typescript
constructor(private readonly _extensionUri: vscode.Uri)
```

**参数说明：**

| 参数名 | 类型 | 说明 |
|--------|------|------|
| `_extensionUri` | `vscode.Uri` | 扩展的根目录 URI |

**初始化操作：**
- 创建 `AgentTreeDataProvider` 实例
- 创建 `ApprovalTreeDataProvider` 实例

---

### 方法：registerTreeView

```typescript
public registerTreeView(context: vscode.ExtensionContext): void
```

**功能：** 注册树视图和相关的命令到 VSCode 扩展上下文。

**参数：**

| 参数名 | 类型 | 说明 |
|--------|------|------|
| `context` | `vscode.ExtensionContext` | VSCode 扩展上下文 |

**注册的内容：**

1. **Agent 树视图**
   - 视图 ID: `mutsumi.agentSidebar`
   - 数据提供者: `_agentTreeDataProvider`
   - 显示全部折叠按钮: `showCollapseAll: true`

2. **审批请求树视图**
   - 视图 ID: `mutsumi.approvalSidebar`
   - 数据提供者: `_approvalTreeDataProvider`
   - 不显示全部折叠按钮: `showCollapseAll: false`

3. **命令注册**
   - `mutsumi.approveRequest`: 批准审批请求
   - `mutsumi.rejectRequest`: 拒绝审批请求

---

### 方法：update

```typescript
public async update(): Promise<void>
```

**功能：** 刷新 Agent 树视图的数据。

**返回值：** `Promise<void>` - 异步操作完成后的 Promise

**调用链：**
```
update() → _agentTreeDataProvider.refresh()
```

---

## 命令处理

### mutsumi.approveRequest

批准指定的审批请求。

**命令参数：**
- `item`: 树项目对象，包含 `request.id` 属性

**执行逻辑：**
```typescript
if (item && item.request && item.request.id) {
    approvalManager.approveRequest(item.request.id);
}
```

### mutsumi.rejectRequest

拒绝指定的审批请求。

**命令参数：**
- `item`: 树项目对象，包含 `request.id` 属性

**执行逻辑：**
```typescript
if (item && item.request && item.request.id) {
    approvalManager.rejectRequest(item.request.id);
}
```

---

## 与其他模块的关系

```
┌─────────────────────────────────────────────────────────┐
│                  AgentSidebarProvider                     │
├─────────────────────────────────────────────────────────┤
│  ┌──────────────────┐      ┌──────────────────────┐    │
│  │ AgentTreeDataProvider │      │ ApprovalTreeDataProvider │    │
│  └────────┬─────────┘      └──────────┬───────────┘    │
│           │                           │                 │
│           ▼                           ▼                 │
│  ┌──────────────────┐      ┌──────────────────────┐    │
│  │   AgentTreeItem  │      │   ApprovalTreeItem   │    │
│  └──────────────────┘      └──────────────────────┘    │
└─────────────────────────────────────────────────────────┘
           │                           │
           ▼                           ▼
┌──────────────────┐      ┌──────────────────────┐
│  AgentOrchestrator│      │   approvalManager    │
└──────────────────┘      └──────────────────────┘
```

**依赖关系：**
- 依赖 `AgentTreeDataProvider` 提供 Agent 树数据
- 依赖 `ApprovalTreeDataProvider` 提供审批请求数据
- 使用 `approvalManager` 处理审批/拒绝操作

---

## 使用示例

### 初始化侧边栏

```typescript
import { AgentSidebarProvider } from './sidebar/agentSidebar';

export function activate(context: vscode.ExtensionContext) {
    const sidebarProvider = new AgentSidebarProvider(context.extensionUri);
    sidebarProvider.registerTreeView(context);
    
    // 保存引用以便后续更新
    context.subscriptions.push({
        dispose: () => { /* 清理逻辑 */ }
    });
}
```

### 刷新侧边栏

```typescript
// 当 Agent 状态变化时刷新视图
await sidebarProvider.update();
```
