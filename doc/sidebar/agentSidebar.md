# agentSidebar.ts

## 功能概述

Agent侧边栏的主控制器。负责注册和管理Agent树视图与审批请求树视图，协调两个数据提供者之间的交互。

## 导出内容

### 类: AgentSidebarProvider

Agent侧边栏提供器类，管理两个树视图的创建和命令注册。

#### 属性

| 属性名 | 类型 | 说明 |
|--------|------|------|
| viewType | string | 视图类型标识符，值为 `'mutsumi.agentSidebar'` |
| _agentTreeDataProvider | AgentTreeDataProvider | Agent树数据提供者 |
| _approvalTreeDataProvider | ApprovalTreeDataProvider | 审批请求树数据提供者 |
| _agentTreeView | vscode.TreeView | Agent树视图实例 |
| _approvalTreeView | vscode.TreeView | 审批请求树视图实例 |

#### 构造函数

```typescript
constructor(_extensionUri: vscode.Uri)
```

**参数:**
- `_extensionUri`: 扩展的根URI

#### 方法

##### registerTreeView

```typescript
public registerTreeView(context: vscode.ExtensionContext): void
```

将树视图和相关命令注册到VSCode扩展上下文。

**参数:**
- `context`: 扩展上下文，用于注册订阅

**功能:**
- 创建Agent树视图（支持折叠全部）
- 创建审批请求树视图
- 注册批准请求命令 (`mutsumi.approveRequest`)
- 注册拒绝请求命令 (`mutsumi.rejectRequest`)

##### update

```typescript
public async update(): Promise<void>
```

更新Agent树视图。触发Agent数据提供者的刷新操作。

**返回值:** Promise<void>

---

## 使用示例

```typescript
const sidebar = new AgentSidebarProvider(extensionUri);
sidebar.registerTreeView(context);

// 刷新Agent树
await sidebar.update();
```
