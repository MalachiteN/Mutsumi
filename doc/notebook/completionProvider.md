# completionProvider.ts

## 功能概述

`completionProvider.ts` 实现了 Mutsumi Notebook 的**引用补全功能**。当用户在 Notebook 单元格中输入 `@` 字符时，触发智能补全建议，帮助用户快速引用工作区中的文件和目录。

该模块是 Notebook 交互系统的核心组件之一，提供了直观的文件引用机制，支持用户通过简单的 `@` 符号快速插入文件路径。

---

## 主要类

### `ReferenceCompletionProvider`

实现 `vscode.CompletionItemProvider` 接口，提供基于文件系统的智能补全建议。

#### 方法

##### `provideCompletionItems`

```typescript
async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext
): Promise<vscode.CompletionItem[]>
```

提供文件和目录引用建议的补全项。

**参数说明：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `document` | `vscode.TextDocument` | 当前活动的文本文档 |
| `position` | `vscode.Position` | 光标当前位置 |
| `token` | `vscode.CancellationToken` | 用于检测取消请求的令牌 |
| `context` | `vscode.CompletionContext` | 补全触发上下文 |

**返回值：**

返回 `vscode.CompletionItem[]` 数组，包含文件和目录引用建议。

**工作流程：**

1. **触发检查**：检测光标前的文本是否以 `@` 结尾，只有满足条件时才提供补全
2. **文件建议**：使用 `vscode.workspace.findFiles` 搜索工作区文件（自动排除 `.gitignore` 和忽略的文件）
3. **目录建议**：读取工作区根目录，提供一级目录引用建议

**补全项格式：**

- **文件项**：插入格式为 `@[relativePath]`，类型为 `CompletionItemKind.File`
- **目录项**：插入格式为 `@[folderName/]`，类型为 `CompletionItemKind.Folder`

---

## 补全建议类型

### 文件引用

| 属性 | 值 | 说明 |
|------|-----|------|
| `insertText` | `\`[${relPath}]\`` | 实际插入的文本格式 |
| `detail` | `"File Reference"` | 显示在详情区域的说明 |
| `sortText` | `"000_" + relPath` | 高优先级排序 |

### 目录引用

| 属性 | 值 | 说明 |
|------|-----|------|
| `insertText` | `\`[${displayLabel}/]\`` | 实际插入的文本格式 |
| `detail` | `"Directory Reference"` | 显示在详情区域的说明 |
| `sortText` | `"001_" + displayLabel` | 次高优先级排序 |

---

## 使用示例

### 在 Notebook 单元格中使用

1. 用户在单元格中输入 `@`
2. 触发补全菜单，显示文件列表：
   ```
   @[src/main.ts]
   @[src/utils.ts]
   @[src/]
   @[doc/]
   ```
3. 选择文件后，插入格式为 `@[relative/path/to/file]`

---

## 依赖关系

### 导入模块

```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import { isCommonIgnored } from '../tools.d/utils';
```

### 被依赖模块

- 被 `extension.ts` 注册为 VS Code 补全提供程序
- 与 `contextResolver.ts` 配合使用（解析 `@[]` 引用格式）

---

## 注意事项

1. **性能优化**：`findFiles` 限制最多返回 50 个文件，避免大量文件导致性能问题
2. **忽略规则**：使用 `isCommonIgnored` 过滤常见忽略目录（如 `.git`, `node_modules`）
3. **取消支持**：检查 `token.isCancellationRequested` 支持用户快速取消补全请求
4. **路径格式**：支持多工作区场景，自动添加工作区前缀
