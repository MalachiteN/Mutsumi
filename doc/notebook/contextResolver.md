# contextResolver.ts

## 功能概述

`contextResolver.ts` 实现了 Mutsumi Notebook 的**上下文引用解析功能**。该模块负责解析 Notebook 单元格文本中的文件引用标记（格式为 `@[path:start:end]`），读取对应的文件或目录内容，并将内容注入到用户上下文中。

这是 Notebook 文件引用系统的核心解析器，将用户的 `@[]` 引用转换为实际的文件内容。

---

## 接口定义

### `ResolvedContext`

```typescript
export interface ResolvedContext {
    originalRef: string;   // 原始引用字符串
    content: string;       // 解析后的内容
    type: 'file' | 'directory' | 'error';  // 解析结果类型
}
```

描述解析后的上下文信息。

---

## 主要类

### `ContextResolver`

静态工具类，提供引用解析和内容读取功能。

#### 静态属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `REF_REGEX` | `RegExp` | 匹配 `@[]` 格式的引用标记，支持路径、行号范围 |

**正则表达式说明：**

```
/@\[([a-zA-Z0-9_\-\/\.\\\:]+)\]/g
```

匹配格式：
- `@[path]` - 引用整个文件
- `@[path:start]` - 引用文件从 start 开始的行
- `@[path:start:end]` - 引用文件的特定行范围

#### 静态方法

##### `resolveReferencesInText`

```typescript
static async resolveReferencesInText(
    text: string, 
    workspaceRoot: string
): Promise<string>
```

解析文本中的所有引用标记，读取对应内容并格式化为上下文注入文本。

**参数说明：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `text` | `string` | 包含引用标记的原始文本 |
| `workspaceRoot` | `string` | 工作区根目录路径 |

**返回值：**

格式化后的上下文注入文本（Markdown 格式），包含所有解析后的引用内容。

**输出格式示例：**

```markdown
### User Provided Context References:

#### Source: src/main.ts:10:20
```
// 第10-20行的代码内容
```

#### Source: src/utils.ts
```
// 整个文件内容
```
```

---

##### `parseReference`

```typescript
private static parseReference(ref: string, root: string): {
    uri: vscode.Uri;
    startLine: number | undefined;
    endLine: number | undefined;
}
```

解析单个引用字符串，提取文件路径和行号范围。

**解析逻辑：**

1. 按 `:` 分割字符串，识别文件路径和行号
2. `parts[0]` = 文件路径
3. `parts[1]` = 起始行号（可选）
4. `parts[2]` = 结束行号（可选）
5. 支持 URI 格式路径（如 `file://...`）和相对路径

**行号说明：**

- 使用 1-based 索引（用户友好）
- 内部转换为 0-based 索引进行切片
- 结束行号如果不提供，默认为起始行号的下一行

---

##### `readResource`

```typescript
private static async readResource(
    uri: vscode.Uri, 
    start?: number, 
    end?: number
): Promise<string>
```

读取文件或目录内容，支持行号范围切片。

**参数说明：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `uri` | `vscode.Uri` | 资源 URI |
| `start` | `number` (可选) | 起始行号（1-based） |
| `end` | `number` (可选) | 结束行号（1-based） |

**功能：**

- **目录**：返回目录内容列表，格式为 `[DIR] name` 或 `[FILE] name`
- **文件**：返回文件内容，支持按行号切片

---

## 使用示例

### 在 Notebook 单元格中使用引用

```markdown
请帮我分析这段代码：
@[src/main.ts:10:25]

并参考这个配置文件：
@[config.json]
```

### 解析后注入的上下文

```markdown
### User Provided Context References:

#### Source: src/main.ts:10:25
```typescript
function main() {
    console.log("Hello");
}
```

#### Source: config.json
```json
{
    "name": "MyApp",
    "version": "1.0.0"
}
```
```

---

## 引用格式

### 支持的引用格式

| 格式 | 说明 | 示例 |
|------|------|------|
| `@[path]` | 引用整个文件 | `@[src/main.ts]` |
| `@[path:start]` | 引用从 start 开始的行 | `@[src/main.ts:10]` |
| `@[path:start:end]` | 引用指定行范围 | `@[src/main.ts:10:25]` |

### 路径格式支持

- 相对路径：`@[src/utils/helper.ts]`
- 绝对 URI：`@[file:///path/to/file.ts]`
- 目录引用：`@[src/]`

---

## 依赖关系

### 导入模块

```typescript
import * as vscode from 'vscode';
import * as path from 'path';
```

### 相关模块

- 与 `completionProvider.ts` 配合使用：补全提供 `@[]` 引用，解析器解析引用内容
- 在 Notebook 执行流程中被调用来解析用户输入中的引用

---

## 错误处理

当引用解析失败时，会在输出中包含错误信息：

```markdown
#### Source: invalid/path.ts
> Error reading reference: 错误描述
```

常见错误：
- 文件不存在
- 权限不足
- 路径格式错误
