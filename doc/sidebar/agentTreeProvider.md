# agentTreeProvider.ts

## 文件功能概述

`agentTreeProvider.ts` 实现了 Agent 树的数据提供者，负责：

1. **获取 Agent 数据** - 从 `AgentOrchestrator` 获取所有 Agent 的扁平列表
2. **构建层级结构** - 根据 `parentId` 关系构建树形结构
3. **状态计算** - 通过 `AgentOrchestrator.computeStatus()` 计算每个 Agent 的显示状态
4. **数据刷新** - 提供 `refresh()` 方法供外部触发视图更新

该类是 VSCode TreeDataProvider API 的实现，连接了业务逻辑层（`AgentOrchestrator`）和视图层（`AgentTreeItem`）。

---

## 类：AgentTreeDataProvider

实现 `vscode.TreeDataProvider<AgentTreeItem>` 接口，为 VSCode 的树视图提供数据。

### 概述

```typescript
export class AgentTreeDataProvider implements vscode.TreeDataProvider<AgentTreeItem>
```

### 属性

| 属性名 | 类型 | 说明 |
|--------|------|------|
| `_onDidChangeTreeData` | `vscode.EventEmitter<AgentTreeItem \| undefined \| null>` | 数据变更事件发射器 |
| `onDidChangeTreeData` | `vscode.Event<AgentTreeItem \| undefined \| null>` | 数据变更事件（公开） |
| `rootItems` | `AgentTreeItem[]` | 根级节点列表 |

---

### 构造函数

```typescript
constructor()
```

无参数构造函数，初始化空的数据结构。

---

### 方法：getTreeItem

```typescript
getTreeItem(element: AgentTreeItem): vscode.TreeItem
```

**功能：** 返回指定元素的树项目。

**参数：**

| 参数名 | 类型 | 说明 |
|--------|------|------|
| `element` | `AgentTreeItem` | 树项目元素 |

**返回值：** `vscode.TreeItem` - VSCode 树视图使用的树项目

**说明：** 直接返回传入的元素，因为 `AgentTreeItem` 已经是 `TreeItem` 的子类。

---

### 方法：getChildren

```typescript
getChildren(element?: AgentTreeItem): Thenable<AgentTreeItem[]>
```

**功能：** 获取指定元素的子节点，如果不传参数则返回根级节点。

**参数：**

| 参数名 | 类型 | 说明 |
|--------|------|------|
| `element` | `AgentTreeItem \| undefined` | 父节点元素（可选） |

**返回值：** `Thenable<AgentTreeItem[]>` - 子节点列表的 Promise

**逻辑：**

```
if element is undefined:
    return rootItems (根级节点)
else:
    return element.children (该节点的子节点)
```

---

### 方法：refresh

```typescript
public async refresh(): Promise<void>
```

**功能：** 重新构建 Agent 树数据并触发视图刷新。

**返回值：** `Promise<void>` - 异步操作完成后的 Promise

**执行步骤：**

1. **清空现有数据**
   ```typescript
   this.rootItems = [];
   ```

2. **获取 Agent 数据**
   ```typescript
   const orch = AgentOrchestrator.getInstance();
   const allAgents = orch.getAgentTreeNodes();
   ```

3. **创建节点映射表**
   ```typescript
   const nodeMap = new Map<string, AgentTreeItem>();
   ```

4. **创建所有 TreeItem**（第一阶段）
   - 遍历 `allAgents` 数组
   - 为每个 Agent 创建 `AgentTreeItem`
   - 使用 `orch.computeStatus(info)` 计算状态
   - 初始折叠状态为 `None`
   - 存入 `nodeMap`

5. **构建层级关系**（第二阶段）
   - 遍历 `allAgents` 数组
   - 如果 `parentId` 存在且在 `nodeMap` 中：
     - 找到父节点，将当前节点加入 `parent.children`
     - 设置父节点折叠状态为 `Expanded`
   - 否则：
     - 作为根节点加入 `rootItems`

6. **触发视图更新**
   ```typescript
   this._onDidChangeTreeData.fire(null);
   ```

---

### 方法：getAgentItem

```typescript
public getAgentItem(uuid: string): AgentTreeItem | undefined
```

**功能：** 根据 UUID 获取对应的 TreeItem（预留方法）。

**参数：**

| 参数名 | 类型 | 说明 |
|--------|------|------|
| `uuid` | `string` | Agent 的唯一标识符 |

**返回值：** `AgentTreeItem \| undefined` - 找到的 TreeItem 或 `undefined`

> **注意：** 当前实现返回 `undefined`，这是一个预留的辅助方法。如需启用，需要维护一个 UUID 到 TreeItem 的映射表。

---

## 数据结构构建流程

### 扁平数据示例

```typescript
// AgentOrchestrator.getAgentTreeNodes() 返回的数据
[
    { uuid: 'A', name: 'Root Agent', parentId: null, fileUri: '...' },
    { uuid: 'B', name: 'Child 1', parentId: 'A', fileUri: '...' },
    { uuid: 'C', name: 'Child 2', parentId: 'A', fileUri: '...' },
    { uuid: 'D', name: 'GrandChild', parentId: 'B', fileUri: '...' }
]
```

### 构建后的树结构

```
Root Agent (A) [Expanded]
├── Child 1 (B) [Collapsed]
│   └── GrandChild (D) [None]
└── Child 2 (C) [None]
```

### 构建算法

```typescript
// 阶段1：创建所有节点
const nodeMap = new Map<string, AgentTreeItem>();
allAgents.forEach(info => {
    const item = new AgentTreeItem({
        uuid: info.uuid,
        name: info.name,
        status: orch.computeStatus(info),
        parentId: info.parentId,
        fileUri: info.fileUri
    }, vscode.TreeItemCollapsibleState.None);
    nodeMap.set(info.uuid, item);
});

// 阶段2：构建父子关系
allAgents.forEach(info => {
    const item = nodeMap.get(info.uuid)!;
    if (info.parentId && nodeMap.has(info.parentId)) {
        const parent = nodeMap.get(info.parentId)!;
        parent.children.push(item);
        parent.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
    } else {
        this.rootItems.push(item);
    }
});
```

---

## 与其他模块的关系

```
┌─────────────────────────────────────────────────────────────┐
│                    VSCode TreeView API                        │
│                         ▲                                     │
│                         │ implements                          │
│              ┌──────────┴──────────┐                         │
│              │ AgentTreeDataProvider │                         │
│              └──────────┬──────────┘                         │
│                         │                                     │
│       ┌─────────────────┼─────────────────┐                  │
│       │                 │                 │                  │
│       ▼                 ▼                 ▼                  │
│  ┌─────────┐     ┌────────────┐    ┌──────────────┐         │
│  │AgentTree│◄────┤AgentNodeData│    │AgentOrchestrator│         │
│  │  Item   │     └────────────┘    └──────┬───────┘         │
│  └─────────┘                              │                  │
│                                           │ getAgentTreeNodes()│
│                                           ▼                  │
│                                    ┌──────────────┐         │
│                                    │  Agent Store │         │
│                                    │ (状态管理)    │         │
│                                    └──────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

**依赖关系：**
- 使用 `AgentTreeItem` 作为树项目类型
- 使用 `AgentNodeData` 作为数据结构
- 依赖 `AgentOrchestrator.getInstance()` 获取单例
- 调用 `AgentOrchestrator.computeStatus()` 计算状态
- 调用 `AgentOrchestrator.getAgentTreeNodes()` 获取数据

---

## 事件机制

### 数据变更事件

```typescript
private _onDidChangeTreeData = new vscode.EventEmitter<AgentTreeItem | undefined | null>();
readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
```

当调用 `refresh()` 时，触发事件通知 VSCode 更新视图：

```typescript
this._onDidChangeTreeData.fire(null);
```

传递 `null` 表示需要完全刷新整个树。

---

## 使用示例

### 基础用法

```typescript
import { AgentTreeDataProvider } from './agentTreeProvider';

const provider = new AgentTreeDataProvider();

// 注册到 VSCode
const treeView = vscode.window.createTreeView('mutsumi.agentSidebar', {
    treeDataProvider: provider,
    showCollapseAll: true
});
```

### 刷新数据

```typescript
// 当 Agent 状态变化时调用
await provider.refresh();
```

### 获取特定节点

```typescript
// 获取所有根节点
const rootNodes = await provider.getChildren();

// 获取特定节点的子节点
const childNodes = await provider.getChildren(rootNodes[0]);
```

---

## 性能考虑

1. **两阶段构建**：先创建所有节点，再建立关系，避免递归查找的性能问题
2. **Map 数据结构**：使用 `Map<string, AgentTreeItem>` 实现 O(1) 的 UUID 查找
3. **按需加载**：`getChildren` 按需返回子节点，避免一次性加载大量数据
