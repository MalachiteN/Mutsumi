# completionProvider.ts

## 功能概述

提供引用自动补全功能。当用户在编辑器中输入 `@` 时，自动显示文件、目录和可用工具的补全建议。

## ReferenceCompletionProvider 类

实现 `vscode.CompletionItemProvider` 接口，为 Markdown 文件提供智能补全。

### 触发条件

用户输入 `@` 后跟任意路径字符时触发补全。

### 补全项类型

| 类型 | 优先级 | 说明 |
|------|--------|------|
| 文件引用 | 最高 | 显示为 `[文件路径]` |
| 目录引用 | 中 | 显示为 `[目录路径/]` |
| 工具调用 | 低 | 显示为 `[工具名{参数}]` |

### 方法

#### provideCompletionItems

提供补全项列表。

**参数**

| 参数名 | 类型 | 说明 |
|--------|------|------|
| document | `vscode.TextDocument` | 当前文本文档 |
| position | `vscode.Position` | 光标位置 |
| token | `vscode.CancellationToken` | 取消令牌 |
| context | `vscode.CompletionContext` | 补全上下文 |

**返回值**

`Promise<vscode.CompletionItem[]>` - 补全项数组

**实现细节**

1. 文件建议：使用 `vscode.workspace.findFiles` 搜索工作区文件，自动排除 `.gitignore` 中的内容
2. 目录建议：扫描工作区根目录获取文件夹列表
3. 工具建议：从 `ToolManager` 获取可用工具列表，自动生成参数占位符

**参数占位符规则**

工具调用的 insertText 格式为 `[${name}{参数}]`，其中参数根据类型填充默认值：

| 参数类型 | 默认值 |
|----------|--------|
| number / integer | `0` |
| boolean | `false` |
| array | `[]` |
| object | `{}` |
| string / other | `""` |

### 使用示例

```typescript
// 注册补全提供器
vscode.languages.registerCompletionItemProvider(
    { scheme: 'file', language: 'markdown' },
    new ReferenceCompletionProvider(),
    '@'
);
```
