# approvalTreeItem.ts

## 功能概述

审批请求树节点项类，用于在侧边栏中显示工具调用审批请求和活动编辑文件会话。

## 导出内容

### 类: ApprovalTreeItem

审批请求树节点项类，继承自 `vscode.TreeItem`。

#### 属性

| 属性名 | 类型 | 说明 |
|--------|------|------|
| request | ApprovalRequest | 审批请求数据对象（只读） |
| description | string | 格式化后的时间字符串 |
| tooltip | vscode.MarkdownString | 鼠标悬停时显示的提示信息 |
| iconPath | vscode.ThemeIcon | 根据状态显示的图标 |
| contextValue | string | `pendingApproval` 或 `resolvedApproval`，用于控制上下文菜单选项 |

#### 构造函数

```typescript
constructor(request: ApprovalRequest)
```

**参数:**
- `request`: 审批请求数据对象

**设置:**
- 标签: `request.actionDescription`
- 可折叠状态: `None`（平铺列表）
- 描述: 格式化时间
- 提示: 构建的Markdown提示
- 图标: 根据状态获取
- 上下文值: 根据状态设置

#### 私有方法

##### formatTime

```typescript
private formatTime(date: Date): string
```

将日期格式化为本地化时间字符串。

**参数:**
- `date`: 要格式化的日期

**返回:** 本地化时间字符串（如 "10:30:45"）

##### buildTooltip

```typescript
private buildTooltip(): vscode.MarkdownString
```

构建鼠标悬停时显示的Markdown提示。

**返回内容:**
- 操作描述（粗体）
- 目标URI
- 详情（如有）
- 时间戳
- 状态

##### getStatusText

```typescript
private getStatusText(): string
```

根据请求状态获取对应的状态文本。

| 状态 | 返回文本 |
|------|----------|
| `pending` | ⏳ Pending |
| `approved` | ✅ Approved |
| `rejected` | ❌ Rejected |

##### getIcon

```typescript
private getIcon(): vscode.ThemeIcon
```

根据请求状态获取对应的图标。

| 状态 | 图标 | 颜色 |
|------|------|------|
| `pending` | question | charts.yellow（黄色） |
| `approved` | check | charts.green（绿色） |
| `rejected` | x | charts.red（红色） |

---

### 类: EditFileTreeItem

活动编辑文件会话树节点项类，继承自 `vscode.TreeItem`，用于在侧边栏中显示活动编辑文件会话。

#### 属性

| 属性名 | 类型 | 说明 |
|--------|------|------|
| session | EditFileSession | 编辑文件会话数据对象（只读） |
| description | string | 格式化后的时间字符串 |
| tooltip | vscode.MarkdownString | 鼠标悬停时显示的提示信息 |
| iconPath | vscode.ThemeIcon | 根据状态显示的图标 |
| contextValue | string | `pendingEdit`、`partiallyAcceptedEdit` 或 `resolvedEdit`，用于控制上下文菜单选项 |
| command | vscode.Command | 点击时执行的命令 `mutsumi.reopenEditDiff` |

#### 构造函数

```typescript
constructor(session: EditFileSession)
```

**参数:**
- `session`: 编辑文件会话数据对象

**设置:**
- 标签: `session.fileName`
- 可折叠状态: `None`（平铺列表）
- 描述: 格式化时间
- 提示: 构建的Markdown提示
- 图标: 根据状态获取
- 上下文值: 根据状态设置
- 命令: `mutsumi.reopenEditDiff`

#### 私有方法

##### formatTime

```typescript
private formatTime(date: Date): string
```

将日期格式化为本地化时间字符串。

**参数:**
- `date`: 要格式化的日期

**返回:** 本地化时间字符串（如 "10:30:45"）

##### buildTooltip

```typescript
private buildTooltip(): vscode.MarkdownString
```

构建鼠标悬停时显示的Markdown提示。

**返回内容:**
- 文件名（粗体）
- 目标URI
- 时间戳
- 状态

##### getStatusText

```typescript
private getStatusText(): string
```

根据会话状态获取对应的状态文本。

| 状态 | 返回文本 |
|------|----------|
| `pending` | ⏳ Pending |
| `partially_accepted` | 🟡 Partially Accepted |
| `resolved` | ✅ Resolved |

##### getIcon

```typescript
private getIcon(): vscode.ThemeIcon
```

根据会话状态获取对应的图标。

| 状态 | 图标 | 颜色 |
|------|------|------|
| `pending` | edit | charts.yellow（黄色） |
| `partially_accepted` | check | charts.orange（橙色） |
| `resolved` | check-all | charts.green（绿色） |

---

## 状态类型定义

```typescript
type EditFileStatus = 'pending' | 'partially_accepted' | 'resolved';
```

| 状态值 | 说明 |
|--------|------|
| `pending` | 编辑文件操作待处理中 |
| `partially_accepted` | 编辑文件操作部分已接受 |
| `resolved` | 编辑文件操作已解决完成 |

---

## 使用示例

```typescript
// ApprovalTreeItem 使用示例
const request: ApprovalRequest = {
    id: '123',
    actionDescription: 'Delete file',
    // ...
};
const approvalItem = new ApprovalTreeItem(request);

// EditFileTreeItem 使用示例
const session: EditFileSession = {
    id: '456',
    fileName: 'example.ts',
    status: 'pending',
    // ...
};
const editFileItem = new EditFileTreeItem(session);
```
