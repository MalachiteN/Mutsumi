# approvalTreeProvider.ts

## 文件功能概述

`approvalTreeProvider.ts` 实现了审批请求树的数据提供者，负责：

1. **监听审批请求变化** - 订阅 `approvalManager` 的数据变更事件
2. **排序显示** - 将待处理的请求排在前面，同状态按时间倒序排列
3. **数据转换** - 将 `ApprovalRequest` 对象转换为 `ApprovalTreeItem`
4. **自动刷新** - 当审批请求数据变化时自动更新视图

该类是 VSCode TreeDataProvider API 的实现，连接了审批管理模块（`approvalManager`）和视图层（`ApprovalTreeItem`）。

---

## 类：ApprovalTreeDataProvider

实现 `vscode.TreeDataProvider<ApprovalTreeItem>` 接口，为 VSCode 的树视图提供审批请求数据。

### 概述

```typescript
export class ApprovalTreeDataProvider implements vscode.TreeDataProvider<ApprovalTreeItem>
```

### 属性

| 属性名 | 类型 | 说明 |
|--------|------|------|
| `_onDidChangeTreeData` | `vscode.EventEmitter<ApprovalTreeItem \| undefined \| null>` | 数据变更事件发射器 |
| `onDidChangeTreeData` | `vscode.Event<ApprovalTreeItem \| undefined \| null>` | 数据变更事件（公开） |

---

### 构造函数

```typescript
constructor()
```

**初始化操作：**

订阅 `approvalManager` 的数据变更事件：

```typescript
approvalManager.onDidChangeRequests(() => {
    this.refresh();
});
```

当 `approvalManager` 中的审批请求数据发生变化（新增、批准、拒绝）时，自动触发 `refresh()` 方法更新视图。

---

### 方法：getTreeItem

```typescript
getTreeItem(element: ApprovalTreeItem): vscode.TreeItem
```

**功能：** 返回指定元素的树项目。

**参数：**

| 参数名 | 类型 | 说明 |
|--------|------|------|
| `element` | `ApprovalTreeItem` | 树项目元素 |

**返回值：** `vscode.TreeItem` - VSCode 树视图使用的树项目

**说明：** 直接返回传入的元素，因为 `ApprovalTreeItem` 已经是 `TreeItem` 的子类。

---

### 方法：getChildren

```typescript
getChildren(element?: ApprovalTreeItem): Thenable<ApprovalTreeItem[]>
```

**功能：** 获取审批请求列表。审批请求是扁平列表，无层级结构。

**参数：**

| 参数名 | 类型 | 说明 |
|--------|------|------|
| `element` | `ApprovalTreeItem \| undefined` | 父节点元素（对于扁平列表，始终为 `undefined`） |

**返回值：** `Thenable<ApprovalTreeItem[]>` - 排序后的审批请求列表

**逻辑：**

```
if element is defined:
    return [] (无子节点)
else:
    requests = approvalManager.getAllRequests()
    sort requests by: pending first, then by timestamp desc
    return requests mapped to ApprovalTreeItem
```

---

### 排序逻辑

```typescript
requests.sort((a, b) => {
    // pending 优先
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (a.status !== 'pending' && b.status === 'pending') return 1;
    
    // 同状态按时间倒序（最新的在前）
    return b.timestamp.getTime() - a.timestamp.getTime();
});
```

**排序规则（优先级从高到低）：**

1. **状态优先**：`pending` 状态的请求排在最前面
2. **时间倒序**：相同状态的请求按时间戳降序排列（最新的在前）

**排序效果示例：**

```
待处理请求 3 (最新)
待处理请求 2
待处理请求 1 (最旧)
已批准请求 5 (最新)
已批准请求 4
已拒绝请求 6
```

---

### 方法：refresh

```typescript
public refresh(): void
```

**功能：** 触发视图刷新。

**实现：**

```typescript
this._onDidChangeTreeData.fire(null);
```

**说明：**
- 传递 `null` 表示需要完全刷新整个树
- 此方法由构造函数中的事件监听器自动调用
- 也可以被外部代码手动调用以强制刷新

---

## 数据结构流程

```
┌──────────────────────────────────────────────────────────────┐
│                     approvalManager                           │
│                    (数据源 - 来自 tools.d/utils)              │
│                         │                                    │
│                         │ getAllRequests()                   │
│                         ▼                                    │
│              ┌─────────────────────┐                        │
│              │   ApprovalRequest[]  │                        │
│              │  ┌───────────────┐   │                        │
│              │  │ {             │   │                        │
│              │  │   id,         │   │                        │
│              │  │   actionDescription,│                       │
│              │  │   targetUri,  │   │                        │
│              │  │   timestamp,  │   │                        │
│              │  │   status      │   │                        │
│              │  │ }             │   │                        │
│              │  └───────────────┘   │                        │
│              └──────────┬───────────┘                        │
│                         │                                    │
│                         │ 排序 + 转换为 TreeItem             │
│                         ▼                                    │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │            ApprovalTreeDataProvider                      │ │
│  │  ┌───────────────────────────────────────────────────┐  │ │
│  │  │              ApprovalTreeItem[]                    │  │ │
│  │  │  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │  │ │
│  │  │  │ 🟡 pending  │  │ 🟢 approved │  │ 🔴 rejected│ │  │ │
│  │  │  └─────────────┘  └─────────────┘  └────────────┘ │  │ │
│  │  └───────────────────────────────────────────────────┘  │ │
│  └─────────────────────────────────────────────────────────┘ │
│                         │                                    │
│                         │ 渲染                                │
│                         ▼                                    │
│              ┌─────────────────────┐                        │
│              │   VSCode TreeView   │                        │
│              └─────────────────────┘                        │
└──────────────────────────────────────────────────────────────┘
```

---

## 与其他模块的关系

```
┌─────────────────────────────────────────────────────────────┐
│  ┌─────────────────┐        ┌─────────────────────────────┐ │
│  │ approvalManager │◄──────►│   ApprovalTreeDataProvider  │ │
│  │  (单例模式)      │ 事件    │  (TreeDataProvider)         │ │
│  └────────┬────────┘        └──────────────┬──────────────┘ │
│           │                                │                │
│           │ 提供 ApprovalRequest           │ 创建           │
│           │                                │                │
│           ▼                                ▼                │
│  ┌─────────────────┐        ┌─────────────────────────────┐ │
│  │ ApprovalRequest │───────►│     ApprovalTreeItem        │ │
│  │    (接口)        │        │     (TreeItem 子类)          │ │
│  └─────────────────┘        └─────────────────────────────┘ │
│                                                              │
└──────────────────────────────────────────────────────────────┘
                                │
                                │ 渲染到
                                ▼
                      ┌───────────────────┐
                      │ mutsumi.approvalSidebar │
                      │   (VSCode 视图 ID)      │
                      └───────────────────┘
```

**依赖关系：**
- 依赖 `ApprovalTreeItem` 作为树项目类型
- 依赖 `ApprovalRequest` 类型定义（来自 `../tools.d/utils`）
- 依赖 `approvalManager` 作为数据源和事件源
- 被 `AgentSidebarProvider` 实例化并注册到 VSCode

---

## 事件机制

### 自动刷新机制

```typescript
constructor() {
    approvalManager.onDidChangeRequests(() => {
        this.refresh();
    });
}
```

**触发场景：**

1. **新增请求** - 当有新操作需要用户审批时
2. **批准请求** - 用户点击批准按钮后
3. **拒绝请求** - 用户点击拒绝按钮后

**事件流：**

```
用户操作 / 系统事件
        │
        ▼
┌───────────────┐
│ approvalManager│
│ (状态变更)     │
└───────┬───────┘
        │ onDidChangeRequests 事件
        ▼
┌───────────────┐
│ ApprovalTreeData│
│ Provider.refresh()│
└───────┬───────┘
        │ fire(null)
        ▼
┌───────────────┐
│ VSCode TreeView│
│ (视图更新)      │
└───────────────┘
```

---

## 使用示例

### 基础用法

```typescript
import { ApprovalTreeDataProvider } from './approvalTreeProvider';

const provider = new ApprovalTreeDataProvider();

// 注册到 VSCode
const treeView = vscode.window.createTreeView('mutsumi.approvalSidebar', {
    treeDataProvider: provider,
    showCollapseAll: false  // 扁平列表不需要全部折叠按钮
});
```

### 手动刷新

```typescript
// 通常不需要手动调用，因为会自动刷新
// 但在某些特殊场景下可以强制刷新
provider.refresh();
```

### 获取所有审批项

```typescript
// 获取排序后的所有审批请求
const items = await provider.getChildren();

items.forEach(item => {
    console.log(item.request.actionDescription);
    console.log(item.request.status);
});
```

---

## 设计要点

### 1. 扁平列表设计

审批请求没有层级关系，每个请求都是独立的：

```typescript
if (element) {
    // 有父元素时返回空数组
    return Promise.resolve([]);
}
```

### 2. 智能排序

优先显示待处理的请求，帮助用户快速关注需要处理的项：

```typescript
// pending 排在最前面
if (a.status === 'pending' && b.status !== 'pending') return -1;
```

### 3. 时间倒序

最新的请求更可能相关，所以放在同状态的前面：

```typescript
// 时间戳大的（更新的）排在前面
return b.timestamp.getTime() - a.timestamp.getTime();
```

### 4. 自动同步

通过事件监听实现数据与视图的自动同步，无需手动管理：

```typescript
approvalManager.onDidChangeRequests(() => {
    this.refresh();
});
```

---

## 性能考虑

1. **懒加载**：`getChildren` 按需从 `approvalManager` 获取数据
2. **事件驱动**：只在数据变化时刷新，避免轮询开销
3. **轻量级转换**：简单的映射和排序操作，时间复杂度 O(n log n)
4. **无状态设计**：不缓存数据，始终从 `approvalManager` 获取最新状态
