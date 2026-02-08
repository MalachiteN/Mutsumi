# agentTreeProvider.ts

## 功能概述

Agent树数据提供者，实现VSCode `TreeDataProvider` 接口。负责管理Agent的层级结构，从 `AgentOrchestrator` 获取数据并转换为树形显示。

## 导出内容

### 类: AgentTreeDataProvider

实现 `vscode.TreeDataProvider<AgentTreeItem>` 接口，提供Agent树形数据。

#### 属性

| 属性名 | 类型 | 说明 |
|--------|------|------|
| _onDidChangeTreeData | vscode.EventEmitter | 树数据变更事件发射器，用于触发视图刷新 |
| onDidChangeTreeData | vscode.Event | 树数据变更事件，VSCode订阅此事件更新视图 |
| rootItems | AgentTreeItem[] | 根节点列表，缓存当前显示的所有Agent树节点 |

#### 方法

##### getTreeItem

```typescript
getTreeItem(element: AgentTreeItem): vscode.TreeItem
```

获取指定元素的树项。

**参数:**
- `element`: 要获取的树节点

**返回:** 对应的VSCode树项

**实现细节:**
- 节点的 `collapsibleState` 根据是否有子节点动态设置：
  - 有子节点时设为 `CollapsibleState.Collapsed`
  - 无子节点时设为 `CollapsibleState.None`

##### getChildren

```typescript
getChildren(element?: AgentTreeItem): Thenable<AgentTreeItem[]>
```

获取指定元素的子节点。

**参数:**
- `element`: 父节点，未指定时返回根节点列表

**返回:** Promise形式的子节点数组

**示例:**
```typescript
const children = await provider.getChildren(rootItem); // 获取子节点
const roots = await provider.getChildren();            // 获取所有根节点
```

##### refresh

```typescript
public async refresh(): Promise<void>
```

刷新Agent树视图。从 `AgentOrchestrator` 获取最新Agent数据并重建层级结构。

**功能流程:**
1. 清空根节点列表
2. 从 `AgentOrchestrator` 获取所有Agent节点
3. 创建所有Agent树节点项
4. **构建Agent层级关系：**
   - 使用 `childIds` 集合构建层级关系（而非仅依赖 `parentId`）
   - 根节点判断：节点没有 `parentId`，或 `parentId` 不在当前显示列表中
   - 添加子节点时遍历 `childIds` 集合并查找对应的节点进行关联
5. 触发视图刷新事件

**树构建机制:**
- 通过 `childIds` 明确指定子节点关系，支持更灵活的树结构
- 双向关联：子节点通过 `parentId` 指向父节点，父节点通过 `childIds` 维护子节点列表

**示例:**
```typescript
await provider.refresh(); // 刷新并重新渲染整个树
```

##### getAgentItem

```typescript
public getAgentItem(uuid: string): AgentTreeItem | undefined
```

根据UUID获取对应的Agent树节点。

**参数:**
- `uuid`: Agent的唯一标识符

**返回:** 找到的树节点，未找到时返回 `undefined`

**实现细节:**
- 递归搜索根节点及其所有子节点
- 遍历整个树结构直到找到匹配的UUID

---

## 使用示例

```typescript
const provider = new AgentTreeDataProvider();
vscode.window.createTreeView('mutsumi.agentSidebar', {
    treeDataProvider: provider
});
```
