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

1. **触发检查**：使用正则 `/@([^@\s]*)$/` 检测光标前的文本，支持 `@` 后紧跟部分路径（如 `@sr`）
2. **范围计算**：计算从 `@` 后字符开始到光标位置的 `range`，避免替换时产生重复字符
3. **文件建议**：使用 `vscode.workspace.findFiles` 搜索工作区文件（`maxResults: 5000`）
4. **手动过滤**：使用 `isCommonIgnored` 函数二次过滤，兼容 Windows 和 POSIX 路径分隔符
5. **目录建议**：读取工作区根目录，提供一级目录引用建议

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
| `range` | 从 `@` 后到光标位置 | 控制替换范围，避免重复字符 |

### 目录引用

| 属性 | 值 | 说明 |
|------|-----|------|
| `insertText` | `\`[${displayLabel}/]\`` | 实际插入的文本格式 |
| `detail` | `"Directory Reference"` | 显示在详情区域的说明 |
| `sortText` | `"001_" + displayLabel` | 次高优先级排序 |

---

## 触发逻辑优化

### 部分路径匹配

- **正则表达式**：`/@([^@\s]*)$/`
- **匹配效果**：`@sr` 可匹配到 `src/`、`src/main.ts` 等结果
- **优势**：支持用户输入部分路径后实时过滤，提升补全效率

### 替换范围修复

- **问题**：旧逻辑仅检查 `@` 结尾，选择补全后可能导致 `@[path]sr` 这样的重复字符
- **解决**：通过计算 `range` 覆盖从 `@` 后到光标的范围，替换时自动清除已输入的部分路径

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
3. 输入部分路径后（如 `@sr`），列表自动过滤显示匹配项
4. 选择文件后，正确插入格式为 `@[relative/path/to/file]`

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

1. **搜索结果数量**：`findFiles` 限制最多返回 5000 个文件，减少结果被截断的概率，同时避免性能问题
2. **双重过滤机制**：
   - `findFiles` 自动排除 `.gitignore` 和 `files.exclude` 配置
   - `isCommonIgnored` 手动二次过滤，使用正则 `/[/\\]/` 兼容 Windows 反斜杠和 POSIX 正斜杠
3. **取消支持**：检查 `token.isCancellationRequested` 支持用户快速取消补全请求
4. **路径格式**：支持多工作区场景，自动添加工作区前缀
