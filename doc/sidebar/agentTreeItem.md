# agentTreeItem.ts

## 文件功能概述

`agentTreeItem.ts` 定义了 Agent 侧边栏中树项目的结构和显示逻辑。主要包含：

1. **`AgentNodeData` 接口** - Agent 节点的数据类型定义
2. **`AgentTreeItem` 类** - 继承自 `vscode.TreeItem`，用于在树视图中显示 Agent 信息

该文件负责 Agent 节点的视觉呈现，包括状态标签、图标、上下文菜单控制等。

---

## 接口：AgentNodeData

Agent 节点的数据接口，用于创建 `AgentTreeItem` 时传递数据。

### 定义

```typescript
export interface AgentNodeData {
    uuid: string;                    // Agent 唯一标识符
    name: string;                    // Agent 显示名称
    status: AgentRuntimeStatus;      // Agent 运行状态
    parentId?: string | null;        // 父 Agent UUID（可选）
    fileUri: string;                 // 关联文件的 URI
}
```

### 属性说明

| 属性名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `uuid` | `string` | ✓ | Agent 的全局唯一标识符 |
| `name` | `string` | ✓ | 在树视图中显示的 Agent 名称 |
| `status` | `AgentRuntimeStatus` | ✓ | Agent 当前运行状态 |
| `parentId` | `string \| null` | ✗ | 父 Agent 的 UUID，根节点为 `null` 或 `undefined` |
| `fileUri` | `string` | ✓ | Agent 关联文件的 URI，用于文件跳转 |

### AgentRuntimeStatus 类型

```typescript
type AgentRuntimeStatus = 'running' | 'pending' | 'finished' | 'standby';
```

| 状态值 | 说明 |
|--------|------|
| `running` | Agent 正在运行中 |
| `pending` | Agent 等待执行 |
| `finished` | Agent 已完成任务 |
| `standby` | Agent 处于待机状态 |

---

## 类：AgentTreeItem

继承自 `vscode.TreeItem`，表示侧边栏中的一个 Agent 节点。

### 概述

`AgentTreeItem` 封装了 Agent 节点的显示逻辑，包括：
- 根据状态显示不同的图标和标签
- 支持层级结构（父子关系）
- 左键点击切换折叠/展开状态

### 属性

| 属性名 | 类型 | 说明 |
|--------|------|------|
| `agentData` | `AgentNodeData` | Agent 节点数据（只读） |
| `children` | `AgentTreeItem[]` | 子节点列表 |

### 构造函数

```typescript
constructor(
    public readonly agentData: AgentNodeData,
    collapsibleState: vscode.TreeItemCollapsibleState
)
```

**参数说明：**

| 参数名 | 类型 | 说明 |
|--------|------|------|
| `agentData` | `AgentNodeData` | Agent 节点数据 |
| `collapsibleState` | `vscode.TreeItemCollapsibleState` | 折叠状态 |

**初始化设置：**

| 属性 | 值 | 说明 |
|------|-----|------|
| `label` | `agentData.name` | 树项目显示文本 |
| `description` | 状态标签 | 通过 `getStatusLabel()` 获取 |
| `iconPath` | 状态图标 | 通过 `getIconPath()` 获取 |
| `contextValue` | `'childAgent'` / `'rootAgent'` | 用于上下文菜单区分 |
| `command` | `undefined` | 不绑定点击命令，使用默认折叠行为 |

---

### 私有方法：getStatusLabel

```typescript
private getStatusLabel(status: AgentRuntimeStatus): string
```

**功能：** 将状态枚举转换为可读文本。

**状态映射表：**

| 状态 | 显示文本 |
|------|----------|
| `running` | `Running` |
| `pending` | `Pending` |
| `finished` | `Finished` |
| `standby` | `Standby` |
| 其他 | （空字符串） |

---

### 私有方法：getIconPath

```typescript
private getIconPath(status: AgentRuntimeStatus): vscode.ThemeIcon
```

**功能：** 根据状态返回对应的 VSCode 主题图标。

**图标映射表：**

| 状态 | 图标 | VSCode 图标 ID |
|------|------|----------------|
| `running` | 🔄 旋转同步图标 | `sync~spin` |
| `finished` | ✅ 勾选图标 | `check` |
| `pending` | ⏰ 时钟图标 | `clock` |
| `standby` | ○ 空心圆 | `circle-outline` |
| 其他 | ❓ 问号图标 | `question` |

---

## 上下文值（Context Value）

`contextValue` 属性用于在 `package.json` 中配置上下文菜单的显示条件：

| 值 | 说明 | 使用场景 |
|----|------|----------|
| `rootAgent` | 根级 Agent | 没有父节点的顶层 Agent |
| `childAgent` | 子 Agent | 有父节点的 Agent |

**package.json 配置示例：**

```json
{
    "contributes": {
        "menus": {
            "view/item/context": [
                {
                    "command": "mutsumi.killAgent",
                    "when": "view == mutsumi.agentSidebar && viewItem == rootAgent"
                }
            ]
        }
    }
}
```

---

## 交互设计

### 点击行为

- **左键点击**：切换节点的折叠/展开状态
- **不绑定 command**：恢复 VSCode 默认的树项目行为

> 设计意图：Agent 树的主要交互是查看层级结构，而非直接执行操作。

---

## 与其他模块的关系

```
┌────────────────────────────────────────────────┐
│            AgentTreeDataProvider                │
│  ┌──────────────────────────────────────────┐  │
│  │ 使用 AgentNodeData 创建                  │  │
│  ▼                                          │  │
│  ┌─────────────────────────────────────────┐│  │
│  │           AgentTreeItem                  ││  │
│  │  ┌─────────────────────────────────┐    ││  │
│  │  │ children: AgentTreeItem[]       │    ││  │
│  │  │ agentData: AgentNodeData        │──┐ ││  │
│  │  └─────────────────────────────────┘  │ ││  │
│  │                                       │ ││  │
│  │  渲染为 TreeItem (vscode API)         │ ││  │
│  └───────────────────────────────────────┘ ││  │
│                                            ││  │
└────────────────────────────────────────────┘│  │
                                              │  │
                    依赖于                    │  │
                                              ▼  ▼
                                    ┌──────────────────┐
                                    │ AgentRuntimeStatus│
                                    │     (types)      │
                                    └──────────────────┘
```

---

## 使用示例

### 创建根级 Agent 节点

```typescript
import { AgentTreeItem, AgentNodeData } from './agentTreeItem';

const rootAgentData: AgentNodeData = {
    uuid: 'agent-001',
    name: 'Main Agent',
    status: 'running',
    parentId: null,
    fileUri: 'file:///workspace/project/src/main.ts'
};

const rootItem = new AgentTreeItem(
    rootAgentData,
    vscode.TreeItemCollapsibleState.Collapsed
);
```

### 创建子 Agent 节点

```typescript
const childAgentData: AgentNodeData = {
    uuid: 'agent-002',
    name: 'Sub Agent',
    status: 'pending',
    parentId: 'agent-001',  // 指向父 Agent
    fileUri: 'file:///workspace/project/src/helper.ts'
};

const childItem = new AgentTreeItem(
    childAgentData,
    vscode.TreeItemCollapsibleState.None
);

// 添加到父节点的 children 数组
rootItem.children.push(childItem);
```

### 遍历所有子节点

```typescript
function traverseTree(item: AgentTreeItem, callback: (item: AgentTreeItem) => void) {
    callback(item);
    item.children.forEach(child => traverseTree(child, callback));
}
```
