# approvalTreeItem.ts

## 文件功能概述

`approvalTreeItem.ts` 定义了审批请求侧边栏中树项目的结构和显示逻辑。主要包含：

1. **`ApprovalTreeItem` 类** - 继承自 `vscode.TreeItem`，用于在树视图中显示审批请求信息

该文件负责审批请求节点的视觉呈现，包括格式化时间、构建工具提示（tooltip）、状态图标和上下文菜单控制等。

---

## 类：ApprovalTreeItem

继承自 `vscode.TreeItem`，表示审批请求侧边栏中的一个请求节点。

### 概述

`ApprovalTreeItem` 封装了审批请求的显示逻辑，包括：
- 格式化时间显示
- 构建丰富的 Markdown 工具提示
- 根据状态显示不同颜色和图标
- 区分待处理和已处理的审批请求（用于上下文菜单控制）

### 属性

| 属性名 | 类型 | 说明 |
|--------|------|------|
| `request` | `ApprovalRequest` | 审批请求数据（只读） |

---

### 构造函数

```typescript
constructor(
    public readonly request: ApprovalRequest
)
```

**参数说明：**

| 参数名 | 类型 | 说明 |
|--------|------|------|
| `request` | `ApprovalRequest` | 审批请求数据对象 |

**ApprovalRequest 类型（来自 `../tools.d/utils`）：**

```typescript
interface ApprovalRequest {
    id: string;                    // 请求唯一标识符
    actionDescription: string;     // 操作描述（显示为标签）
    targetUri: string;             // 目标文件/资源的 URI
    details?: string;              // 详细信息（可选）
    timestamp: Date;               // 请求创建时间
    status: 'pending' | 'approved' | 'rejected';  // 请求状态
}
```

**初始化设置：**

| 属性 | 值 | 说明 |
|------|-----|------|
| `label` | `request.actionDescription` | 树项目显示文本 |
| `description` | 格式化时间 | 通过 `formatTime()` 获取，如 "14:30:25" |
| `tooltip` | Markdown 字符串 | 通过 `buildTooltip()` 构建的详细信息 |
| `iconPath` | 状态图标 | 通过 `getIcon()` 获取，颜色随状态变化 |
| `collapsibleState` | `None` | 审批请求不可展开 |
| `contextValue` | `'pendingApproval'` / `'resolvedApproval'` | 用于上下文菜单区分 |

---

### 私有方法：formatTime

```typescript
private formatTime(date: Date): string
```

**功能：** 将日期对象格式化为本地时间字符串。

**参数：**

| 参数名 | 类型 | 说明 |
|--------|------|------|
| `date` | `Date` | 需要格式化的时间 |

**返回值：** `string` - 格式化后的时间字符串（如 "14:30:25"）

**实现：**
```typescript
return date.toLocaleTimeString();
```

---

### 私有方法：buildTooltip

```typescript
private buildTooltip(): vscode.MarkdownString
```

**功能：** 构建富文本工具提示，显示审批请求的详细信息。

**返回值：** `vscode.MarkdownString` - Markdown 格式的工具提示

**工具提示内容：**

```markdown
**操作描述**

📁 Target: `目标URI`

📝 Details:
```
详细信息内容
```

🕐 Time: 2024/01/15 14:30:25

Status: ⏳ Pending
```

**构建逻辑：**
1. 加粗显示操作描述
2. 显示目标 URI（代码格式）
3. 如果有详细信息，显示在代码块中
4. 显示完整时间（日期 + 时间）
5. 显示当前状态（带表情符号）

---

### 私有方法：getStatusText

```typescript
private getStatusText(): string
```

**功能：** 获取状态的文字描述（用于工具提示）。

**返回值：** `string` - 带表情符号的状态文本

**状态映射表：**

| 状态 | 返回文本 |
|------|----------|
| `pending` | `⏳ Pending` |
| `approved` | `✅ Approved` |
| `rejected` | `❌ Rejected` |

---

### 私有方法：getIcon

```typescript
private getIcon(): vscode.ThemeIcon
```

**功能：** 根据状态返回带颜色的 VSCode 主题图标。

**返回值：** `vscode.ThemeIcon` - 带颜色的图标

**图标映射表：**

| 状态 | 图标 | 颜色 |
|------|------|------|
| `pending` | 问号图标 (`question`) | 黄色 (`charts.yellow`) |
| `approved` | 勾选图标 (`check`) | 绿色 (`charts.green`) |
| `rejected` | 叉号图标 (`x`) | 红色 (`charts.red`) |

**颜色主题键：**
- `charts.yellow` - VSCode 主题中的黄色
- `charts.green` - VSCode 主题中的绿色
- `charts.red` - VSCode 主题中的红色

---

## 上下文值（Context Value）

`contextValue` 属性用于在 `package.json` 中配置上下文菜单的显示条件：

| 值 | 说明 | 可用操作 |
|----|------|----------|
| `pendingApproval` | 待处理的审批请求 | 批准、拒绝 |
| `resolvedApproval` | 已处理的审批请求 | （通常无操作） |

**package.json 配置示例：**

```json
{
    "contributes": {
        "menus": {
            "view/item/context": [
                {
                    "command": "mutsumi.approveRequest",
                    "when": "view == mutsumi.approvalSidebar && viewItem == pendingApproval",
                    "group": "inline"
                },
                {
                    "command": "mutsumi.rejectRequest",
                    "when": "view == mutsumi.approvalSidebar && viewItem == pendingApproval",
                    "group": "inline"
                }
            ]
        }
    }
}
```

---

## 视觉设计

### 列表项显示

```
┌──────────────────────────────────────┐
│ 🟡 删除文件 file.txt    14:30:25     │
│ 🟢 创建目录 src/        14:25:10     │
│ 🔴 执行命令 rm -rf      14:20:05     │
└──────────────────────────────────────┘
 │      │                    │
 │      │                    └── description (时间)
 │      └── label (操作描述)
 └── icon (状态颜色)
```

### 工具提示显示

```
┌──────────────────────────────────────┐
│ 删除文件 file.txt                    │
│                                      │
│ 📁 Target: `/workspace/file.txt`     │
│                                      │
│ 📝 Details:                          │
│ ```                                  │
│ 此操作将永久删除该文件               │
│ ```                                  │
│                                      │
│ 🕐 Time: 2024/1/15 14:30:25          │
│                                      │
│ Status: ⏳ Pending                   │
└──────────────────────────────────────┘
```

---

## 与其他模块的关系

```
┌─────────────────────────────────────────────────────────────┐
│                 ApprovalTreeDataProvider                     │
│                         │                                    │
│                         │ 创建 ApprovalTreeItem              │
│                         ▼                                    │
│              ┌─────────────────────┐                        │
│              │   ApprovalTreeItem   │                        │
│              │  ┌───────────────┐   │                        │
│              │  │ request:      │   │                        │
│              │  │ ApprovalRequest│◄──┼───── 依赖              │
│              │  └───────────────┘   │                        │
│              └──────────┬───────────┘                        │
│                         │                                    │
│                         │ 渲染为 TreeItem                    │
│                         ▼                                    │
│              ┌─────────────────────┐                        │
│              │    VSCode TreeView   │                        │
│              └─────────────────────┘                        │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │
                    ┌─────────┴─────────┐
                    │   approvalManager   │
                    │  (ApprovalRequest)  │
                    └─────────────────────┘
```

**依赖关系：**
- 依赖 `ApprovalRequest` 类型定义（来自 `../tools.d/utils`）
- 被 `ApprovalTreeDataProvider` 实例化
- 渲染到 VSCode TreeView

---

## 使用示例

### 创建待处理审批项

```typescript
import { ApprovalTreeItem } from './approvalTreeItem';
import { ApprovalRequest } from '../tools.d/utils';

const request: ApprovalRequest = {
    id: 'req-001',
    actionDescription: '删除文件 main.js',
    targetUri: '/workspace/src/main.js',
    details: '此操作将永久删除该文件',
    timestamp: new Date(),
    status: 'pending'
};

const treeItem = new ApprovalTreeItem(request);
// treeItem.contextValue === 'pendingApproval'
// treeItem.iconPath 为黄色问号
```

### 创建已批准审批项

```typescript
const approvedRequest: ApprovalRequest = {
    id: 'req-002',
    actionDescription: '创建目录 assets/',
    targetUri: '/workspace/assets',
    timestamp: new Date(Date.now() - 3600000),  // 1小时前
    status: 'approved'
};

const approvedItem = new ApprovalTreeItem(approvedRequest);
// approvedItem.contextValue === 'resolvedApproval'
// approvedItem.iconPath 为绿色勾选
```

### 在 TreeDataProvider 中使用

```typescript
class ApprovalTreeDataProvider implements vscode.TreeDataProvider<ApprovalTreeItem> {
    getChildren(element?: ApprovalTreeItem): Thenable<ApprovalTreeItem[]> {
        if (element) {
            return Promise.resolve([]);  // 无子节点
        }
        
        const requests = approvalManager.getAllRequests();
        const items = requests.map(r => new ApprovalTreeItem(r));
        return Promise.resolve(items);
    }
}
```

---

## 设计要点

1. **不可折叠**：审批请求是扁平列表，没有层级关系
2. **状态可视化**：通过颜色和图标直观区分不同状态
3. **详细信息**：工具提示提供完整的请求信息，便于用户决策
4. **时间显示**：描述区显示简洁的时间，工具提示显示完整时间
5. **上下文区分**：通过 `contextValue` 控制右键菜单的显示
