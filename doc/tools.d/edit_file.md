# edit_file.ts

## 功能概述

`edit_file.ts` 是文件编辑功能的核心模块，实现了带用户确认的交互式文件编辑流程。它与 `edit_codelens_provider.ts` 配合，通过 Diff 编辑器和 CodeLens 操作按钮，为用户提供安全的文件修改确认机制。

---

## 数据结构

### `EditSession` 接口

管理单个文件编辑会话的状态。

```typescript
interface EditSession {
    id: string;
    resolve: (value: string) => Promise<void>;
    reject: (reason: any) => void;
    originalUri: vscode.Uri;
    tempUri: vscode.Uri;
}
```

| 属性 | 类型 | 描述 |
|------|------|------|
| `id` | `string` | 会话唯一标识符 |
| `resolve` | `function` | 完成编辑会话的 Promise 解析函数 |
| `reject` | `function` | 拒绝编辑会话的 Promise 拒绝函数 |
| `originalUri` | `vscode.Uri` | 原始文件的 URI |
| `tempUri` | `vscode.Uri` | 临时文件（存储修改内容）的 URI |

---

## 核心函数

### `activateEditSupport(context): void`

在扩展激活时初始化编辑支持系统。

**功能：**

1. **初始化 DiffReviewAgent**
   - 创建临时目录（`globalStorage/temp_edits`）
   - 配置操作按钮和自动打开选项

2. **注册 VS Code 命令**

| 命令 ID | 功能 | 触发方式 |
|---------|------|----------|
| `diffReview.action.accept` | 接受修改，覆盖原文件 | 点击 CodeLens 的 Accept 按钮 |
| `diffReview.action.reject` | 拒绝修改，放弃变更 | 点击 CodeLens 的 Reject 按钮 |
| `diffReview.action.partiallyAccept` | 应用修改后切换到标准编辑模式 | 点击 Partially Accept 按钮 |
| `diffReview.action.continueGenerate` | 完成手动编辑，生成反馈报告 | 点击 Continue Mutsumi Generate 按钮 |
| `mutsumi.reopenEditDiff` | 从侧边栏重新打开 Diff 编辑器 | 侧边栏操作 |

---

### `mutsumi.reopenEditDiff` 命令

从侧边栏重新打开编辑会话的 Diff 编辑器。

**支持两种模式：**

| 会话状态 | 行为 |
|----------|------|
| `pending` | 重新打开 Diff 视图，显示 Accept/Partially Accept/Reject 按钮 |
| `partially_accepted` | 打开标准编辑器，显示 Continue 按钮 |

---

### `handleEdit(uriInput, newContent, context): Promise<string>`

核心编辑处理函数，协调整个交互式编辑流程。

**参数：**

| 参数 | 类型 | 描述 |
|------|------|------|
| `uriInput` | `string` | 目标文件路径或 URI |
| `newContent` | `string` | AI 生成的新文件内容 |
| `context` | `ToolContext` | 工具执行上下文 |

**执行流程：**

```
1. 验证编辑支持已激活
2. 解析 URI 并检查访问权限
3. 验证 Notebook 上下文
4. 检查是否存在同文件的进行中的会话，如有则取消
5. 创建临时文件 URI
6. 定义操作按钮（Accept / Partially Accept / Reject）
7. 使用 editFileSessionManager.addSession() 注册会话
8. 添加中止信号监听器
9. 启动 Diff 视图
10. 返回 Promise，等待用户操作
```

**操作结果：**

| 用户操作 | 结果 |
|----------|------|
| Accept | 临时文件内容覆盖原文件，返回 `'User accepted the edit.'` |
| Reject | 清理会话，抛出 `TerminationError` |
| Partially Accept | 应用修改，切换到标准编辑器，显示"继续生成"按钮 |
| Continue Generate | 生成用户修改与 AI 提案的 Diff，返回反馈消息 |

**错误处理：**
- 当发生错误时，调用 `cleanupSession()` 并解析会话

---

### `cleanupSession(filePath, resolveManagerSession?): void`

清理编辑会话的资源。

**参数：**

| 参数 | 类型 | 默认值 | 描述 |
|------|------|--------|------|
| `filePath` | `string` | - | 文件路径，用于标识会话 |
| `resolveManagerSession` | `boolean` | `true` | 是否解析会话管理器中的会话 |

**清理内容：**
- 清除 CodeLens 操作按钮
- 从 `activeSessions` Map 中移除会话
- 调用 `editFileSessionManager.resolveSession(session.id)` 解析会话管理器中的会话
- 删除临时文件

---

## 全局状态

| 变量 | 类型 | 描述 |
|------|------|------|
| `activeSessions` | `Map<string, EditSession>` | 当前活动的编辑会话映射 |
| `globalDiffAgent` | `DiffReviewAgent \| undefined` | 全局 Diff 审核代理实例 |
| `globalTempDir` | `string \| undefined` | 全局临时目录路径 |

---

## 反馈消息生成

当用户选择"部分接受"并手动编辑后，系统会生成详细的反馈消息：

```
用户部分接受修改并进行了手动编辑。
以下是用户在你生成内容基础上所做的修改的 Diff：

```diff
--- AI_Proposal/filename
+++ User_Edited/filename
@@ ...
 ...
```

请分析这些手动编辑以理解用户的意图，然后继续生成剩余内容。
```

如果没有手动修改：
```
用户接受了修改（未进行手动修改）。
```

---

## 依赖关系

| 依赖 | 用途 |
|------|------|
| `vscode` | VS Code API |
| `path` | 路径处理 |
| `diff` | 生成文件差异对比 |
| `interface.ts` | ToolContext、TerminationError |
| `utils.ts` | resolveUri、checkAccess、editFileSessionManager |
| `edit_codelens_provider.ts` | DiffReviewAgent |
| `edit_codelens_types.ts` | DiffCodeLensAction |

---

## 工作流程图

```
┌─────────────────┐
│   AI 调用编辑工具  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   handleEdit()   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  创建临时文件     │
│  注册编辑会话     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   显示 Diff 编辑器 │
│ (Accept/Reject/   │
│  Partially Accept)│
└────────┬────────┘
         │
    ┌────┴────┬────────────┐
    │         │            │
    ▼         ▼            ▼
┌───────┐ ┌────────┐ ┌─────────────┐
│Accept │ │ Reject │ │Partially    │
│       │ │        │ │Accept       │
└───┬───┘ └───┬────┘ └──────┬──────┘
    │         │             │
    ▼         ▼             ▼
┌───────┐ ┌────────┐ ┌─────────────┐
│覆盖原文件│ │抛出终止 │ │应用修改       │
│返回成功 │ │  错误  │ │打开标准编辑器  │
└───────┘ └────────┘ └──────┬──────┘
                            │
                            ▼
                   ┌─────────────────┐
                   │ 用户手动编辑      │
                   └────────┬────────┘
                            │
                            ▼
                   ┌─────────────────┐
                   │ 点击"继续生成"   │
                   └────────┬────────┘
                            │
                            ▼
                   ┌─────────────────┐
                   │ 生成 Diff 报告    │
                   │ 返回反馈消息      │
                   └─────────────────┘
```

---

## 安全特性

1. **访问控制**：使用 `checkAccess` 验证 Agent 是否有权限编辑目标文件
2. **用户确认**：所有编辑操作都需要用户通过 CodeLens 按钮显式确认
3. **临时文件隔离**：修改内容先写入临时文件，确认后才覆盖原文件
4. **会话管理**：防止同文件的并发编辑会话冲突
5. **取消支持**：支持通过 AbortSignal 取消进行中的编辑会话
