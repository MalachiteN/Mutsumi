# contextAssembler.ts

## 功能概述

ContextAssembler 类负责解析和组装动态上下文，支持三种语法：
- 文件引用: `@[path/to/file]` 或 `@[path:10:20]`（支持行号范围）
- 工具调用: `@[tool_name{"arg": "value"}]`
- 预处理器命令: `@{command args}`（使用花括号，与方括号的文件/工具引用区分）

该类提供两种解析模式：
- **INLINE 模式**: 将解析结果直接替换到原文中
- **APPEND 模式**: 将解析结果追加到缓冲区，保留原文

### Front Matter 支持

当解析 Markdown 文件（`.md`）时，ContextAssembler 会使用 `gray-matter` 库解析文件的 YAML front matter：

- **Description 字段**: 取自递归发起处的**顶级 Markdown 文件**的 front matter（如果不是字符串则返回空字符串）
- **Params 字段**: 从所有沿途递归遇到的 Markdown 文件中收集，保证是字符串数组，最后进行去重合并

### 函数架构

重构后的 ContextAssembler 采用分层设计：

```
assembleDocument (组合函数，完整流程，返回 content 字符串)
    ├── preprocess (预处理 @{...})
    └── prepareSkill (核心解析 @[...]，返回 {content, description, params})
            ├── resolveStaticIncludes (静态文件引用，收集 front matter)
            │       ├── 读取 Markdown 文件 → 解析 front matter
            │       │   ├── 提取 Description（仅顶级文件）
            │       │   └── 收集 Params（所有层级）
            │       └── 递归解析引用的文件
            └── resolveDynamicTools (动态工具调用)
```

- **`preprocess`**：独立处理预处理器命令 `@{...}`
- **`prepareSkill`**：运行核心解析流程（静态文件引用和动态工具调用），使用 gray-matter 收集 front matter
- **`assembleDocument`**：组合函数，依次调用 `preprocess` 和 `prepareSkill`，只返回组装后的 content

## 导出的枚举

### ParseMode

```typescript
enum ParseMode {
    INLINE = 'INLINE',  // 内联模式：直接替换原文
    APPEND = 'APPEND'   // 追加模式：追加到缓冲区
}
```

## 接口定义

### PrepareSkillResult

`prepareSkill` 方法的返回类型：

```typescript
interface PrepareSkillResult {
    /** 组装后的内容 */
    content: string;
    /** 递归发起处顶级 Markdown 文件的 Description（空字符串表示未找到） */
    description: string;
    /** 所有层级去重合并后的 Params 数组 */
    params: string[];
}
```

### StaticIncludeResult

`resolveStaticIncludes` 方法的内部返回类型：

```typescript
interface StaticIncludeResult {
    /** 解析后的内容 */
    content: string;
    /** 收集到的所有 Params */
    params: string[];
    /** 顶级 Markdown 文件的 front matter 数据 */
    topLevelData: Record<string, any> | null;
}
```

## ContextAssembler 类

### 静态方法

#### preprocess

运行预处理器处理 `@{...}` 语法。这是一个同步函数，用于处理条件编译、宏定义等预处理命令。

```typescript
static preprocess(text: string): string
```

**参数:**
- `text` - 可能包含 `@{...}` 标签的源文本

**返回值:**
- 预处理后的文本，`@{...}` 标签已被处理

**示例:**
```typescript
const text = '@{include: "header.md"}';
const result = ContextAssembler.preprocess(text);
// result 包含 header.md 文件的内容
```

---

#### prepareSkill

解析并解析静态文件引用 `@[path]` 和动态工具调用 `@[tool{...}]`。

**这是核心解析逻辑，不运行预处理器。** 该方法会递归解析 Markdown 文件并收集 front matter 数据。

```typescript
static async prepareSkill(
    text: string,
    workspaceRoot: string,
    allowedUris: string[],
    mode: ParseMode = ParseMode.INLINE,
    appendBuffer?: string[]
): Promise<PrepareSkillResult>
```

**参数:**
- `text` - 包含 `@[]` 标签的源文本
- `workspaceRoot` - 解析相对路径时使用的根目录
- `allowedUris` - 工具执行期间允许访问的URI列表（安全检查）
- `mode` - 解析模式，默认为 INLINE
- `appendBuffer` - APPEND 模式的结果缓冲区

**返回值:**
`PrepareSkillResult` 对象，包含：
- `content` - 完全解析后的文本（INLINE 模式）或原始文本（APPEND 模式）
- `description` - 递归发起处顶级 Markdown 文件的 Description 字段（字符串，不存在则空字符串）
- `params` - 从所有沿途 Markdown 文件收集并去重后的 Params 数组

**Front Matter 收集规则:**
- 只有 `.md` 文件会被解析 front matter（使用 gray-matter）
- Description 取自第一个被解析的 Markdown 文件（递归深度为 0）
- Params 从所有遇到的 Markdown 文件中收集，每个文件的 Params 必须是字符串数组
- 最终返回的 params 会进行去重（使用 `Set`）

**示例:**
```typescript
const text = '@[README.md] @[read_file{"uri": "src/main.ts"}]';
const result = await ContextAssembler.prepareSkill(
    text, 
    '/workspace', 
    ['/workspace'], 
    ParseMode.INLINE
);
// result = {
//   content: "...",
//   description: "README 的描述",
//   params: ["param1", "param2"]
// }
```

---

#### assembleDocument

组装文档的完整流程：**先运行预处理器，然后运行核心解析**。

这是一个组合函数，依次调用 `preprocess()` 和 `prepareSkill()`，只返回组装后的 content。

```typescript
static async assembleDocument(
    text: string,
    workspaceRoot: string,
    allowedUris: string[],
    mode: ParseMode = ParseMode.INLINE,
    appendBuffer?: string[]
): Promise<string>
```

**参数:**
- `text` - 包含 `@[]` 和/或 `@{...}` 标签的源文本
- `workspaceRoot` - 解析相对路径时使用的根目录
- `allowedUris` - 工具执行期间允许访问的URI列表（安全检查）
- `mode` - 解析模式，默认为 INLINE
- `appendBuffer` - APPEND 模式的结果缓冲区

**返回值:**
- INLINE 模式返回完全组装后的文本
- APPEND 模式返回原始文本

**处理流程:**
1. 调用 `preprocess(text)` 处理 `@{...}` 预处理器命令
2. 调用 `prepareSkill(...)` 处理 `@[path]` 和 `@[tool{...}]`，收集 front matter
3. 只返回 `prepareSkill` 结果中的 `content` 字段

**示例:**
```typescript
const text = '@{preprocess: true} @[README.md]';
const result = await ContextAssembler.assembleDocument(
    text, 
    '/workspace', 
    ['/workspace'], 
    ParseMode.INLINE
);
// result = 组装后的 content 字符串
```

---

#### resolveUserPromptReferences

解析用户提示中的引用，生成格式化的上下文引用块。

```typescript
static async resolveUserPromptReferences(
    text: string,
    workspaceRoot: string,
    allowedUris: string[]
): Promise<string>
```

**参数:**
- `text` - 用户输入文本，可能包含 `@[path]` 引用
- `workspaceRoot` - 工作区根路径
- `allowedUris` - 允许的URI列表

**返回值:**
格式化后的上下文引用字符串，无引用时返回空字符串。

**输出格式:**
```markdown
### User Provided Context References:

#### Source: src/utils.ts

```
文件内容
```
```

---

#### executeToolCall

执行工具调用。

```typescript
public static async executeToolCall(
    name: string, 
    args: any, 
    allowedUris: string[]
): Promise<string>
```

**参数:**
- `name` - 工具名称
- `args` - 工具参数
- `allowedUris` - 允许的URI列表

**返回值:** 工具执行结果字符串

**示例:**
```typescript
const output = await ContextAssembler.executeToolCall(
    'read_file', 
    { uri: 'src/main.ts' }, 
    ['/workspace']
);
```

---

#### extractBracketContent

提取方括号内的内容，支持嵌套括号。

```typescript
public static extractBracketContent(
    text: string, 
    start: number
): { content: string, endIdx: number }
```

**参数:**
- `text` - 源文本
- `start` - 开始位置（在 `@[` 之后）

**返回值:** 包含 `content`（内容）和 `endIdx`（结束索引）的对象，未找到闭合括号时 `endIdx` 为 -1

**示例:**
```typescript
const text = '@[some/path] rest';
const { content, endIdx } = ContextAssembler.extractBracketContent(text, 2);
// content = 'some/path', endIdx = 12
```

---

#### parseReference

解析引用字符串，支持行号范围。

```typescript
public static parseReference(
    ref: string, 
    root: string
): { uri: vscode.Uri, startLine?: number, endLine?: number }
```

**参数:**
- `ref` - 引用字符串，格式如 `path/to/file.ts:10:20`
- `root` - 工作区根路径

**返回值:** 解析后的URI和行号范围

**示例:**
```typescript
const { uri, startLine, endLine } = ContextAssembler.parseReference(
    'src/main.ts:10:20', 
    '/workspace'
);
// uri = file:///workspace/src/main.ts, startLine = 10, endLine = 20
```

---

#### readResource

读取资源内容，支持文件和目录。

```typescript
public static async readResource(
    uri: vscode.Uri, 
    start?: number, 
    end?: number
): Promise<string>
```

**参数:**
- `uri` - 资源URI
- `start` - 起始行号（1-based，包含）
- `end` - 结束行号（包含）

**返回值:**
- 文件内容（如果指定行号则返回对应行范围）
- 目录列表（如果是目录）

**示例:**
```typescript
// 读取整个文件
const content = await ContextAssembler.readResource(
    vscode.Uri.file('/path/to/file.ts')
);

// 读取指定行范围
const content = await ContextAssembler.readResource(uri, 10, 20);

// 读取目录
const entries = await ContextAssembler.readResource(
    vscode.Uri.file('/path/to/dir')
);
```

## Front Matter 示例

### 基本用法

创建包含 front matter 的 Markdown 文件：

```markdown
---
Description: "API 文档说明"
Params:
  - "api_key"
  - "base_url"
  - "timeout"
---

# API 文档

@[sub_document.md]
```

### 嵌套收集

当 `sub_document.md` 也包含 Params 时：

```markdown
---
Params:
  - "timeout"
  - "retry_count"
---

子文档内容...
```

最终 `prepareSkill` 返回的 `params` 将是去重后的：
```typescript
["api_key", "base_url", "timeout", "retry_count"]
```

注意 `"timeout"` 在两个文件中都存在，但在结果中只出现一次。
