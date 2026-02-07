# agentTreeItem.ts

## 功能概述

定义Agent树节点数据结构和树节点项类，用于在侧边栏中显示Agent的层级结构。

## 导出内容

### 接口: AgentNodeData

Agent节点数据接口，定义Agent树项的基本信息。

```typescript
interface AgentNodeData {
    uuid: string;              // Agent的唯一标识符
    name: string;              // Agent的显示名称
    status: AgentRuntimeStatus; // Agent当前运行状态
    parentId?: string | null;  // 父Agent的UUID，null表示根节点
    fileUri: string;           // 与Agent关联的文件URI
}
```

### 类: AgentTreeItem

Agent树节点项类，继承自 `vscode.TreeItem`，用于在侧边栏显示Agent层级结构。

#### 属性

| 属性名 | 类型 | 说明 |
|--------|------|------|
| agentData | AgentNodeData | Agent节点数据（只读） |
| children | AgentTreeItem[] | 子Agent节点列表 |
| description | string | 状态显示文本 |
| iconPath | vscode.ThemeIcon | 状态图标 |
| contextValue | string | `'childAgent'` 或 `'rootAgent'`，用于控制上下文菜单 |

#### 构造函数

```typescript
constructor(
    agentData: AgentNodeData,
    collapsibleState: vscode.TreeItemCollapsibleState
)
```

**参数:**
- `agentData`: Agent节点数据
- `collapsibleState`: 节点的可折叠状态

#### 私有方法

##### getStatusLabel

```typescript
private getStatusLabel(status: AgentRuntimeStatus): string
```

根据Agent状态获取对应的显示标签。

| 状态 | 返回文本 |
|------|----------|
| `running` | "Running" |
| `pending` | "Pending" |
| `finished` | "Finished" |
| `standby` | "Standby" |

##### getIconPath

```typescript
private getIconPath(status: AgentRuntimeStatus): vscode.ThemeIcon
```

根据Agent状态获取对应的图标。

| 状态 | 图标 |
|------|------|
| `running` | sync~spin（旋转同步图标） |
| `finished` | check（勾选） |
| `pending` | clock（时钟） |
| `standby` | circle-outline（空心圆） |

---

## 使用示例

```typescript
const item = new AgentTreeItem(agentData, vscode.TreeItemCollapsibleState.Collapsed);
```
