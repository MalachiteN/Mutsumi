# approvalTreeProvider.ts

## 功能概述

审批请求树数据提供者，实现VSCode `TreeDataProvider` 接口。负责管理工具调用审批请求和活动编辑文件会话的列表，与 `approvalManager` 和 `editFileSessionManager` 配合工作。

## 类型定义

### ApprovalSidebarItem

```typescript
type ApprovalSidebarItem = ApprovalTreeItem | EditFileTreeItem
```

边栏树节点联合类型，表示审批树中的项目可以是审批请求项或编辑文件会话项。

## 导出内容

### 类: ApprovalTreeDataProvider

实现 `vscode.TreeDataProvider<ApprovalSidebarItem>` 接口，提供审批请求和编辑会话的列表数据。

#### 属性

| 属性名 | 类型 | 说明 |
|--------|------|------|
| _onDidChangeTreeData | vscode.EventEmitter | 树数据变更事件发射器 |
| onDidChangeTreeData | vscode.Event | 树数据变更事件，VSCode订阅此事件 |

#### 构造函数

```typescript
constructor()
```

创建审批请求数据提供者实例。自动订阅以下事件以保持数据同步：

- `approvalManager.onDidChangeRequests` - 当审批请求发生变更时刷新视图
- `editFileSessionManager.onDidChangeSessions` - 当编辑文件会话发生变更时刷新视图

#### 方法

##### getTreeItem

```typescript
getTreeItem(element: ApprovalSidebarItem): vscode.TreeItem
```

获取指定元素的树项。

**参数:**
- `element`: 要获取的树节点（ApprovalTreeItem 或 EditFileTreeItem）

**返回:** 对应的VSCode树项

##### getChildren

```typescript
getChildren(element?: ApprovalSidebarItem): Thenable<ApprovalSidebarItem[]>
```

获取指定元素的子节点。

**参数:**
- `element`: 父节点，审批请求为平铺列表，此参数被忽略

**返回:** Promise形式的子节点数组，包含以下内容：
- 所有待处理的审批请求（`ApprovalTreeItem`）
- 所有活动的编辑文件会话（`EditFileTreeItem`）
- 两者合并后统一返回

**排序规则:**
- 待处理状态请求优先显示
- 相同状态下，按时间降序排列（最新的在前）

**示例:**
```typescript
const children = await provider.getChildren(item); // 返回 []
const allItems = await provider.getChildren();     // 返回所有审批请求和编辑会话
```

##### refresh

```typescript
public refresh(): void
```

刷新审批请求树视图。触发 `onDidChangeTreeData` 事件通知VSCode重新渲染视图。

**示例:**
```typescript
provider.refresh(); // 刷新并重新渲染审批请求列表
```

---

## 使用示例

```typescript
const provider = new ApprovalTreeDataProvider();
vscode.window.createTreeView('mutsumi.approvalSidebar', {
    treeDataProvider: provider
});
```
