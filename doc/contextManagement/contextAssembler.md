# contextAssembler.ts

## 功能概述

ContextAssembler 类负责解析和组装动态上下文，支持两种语法：
- 文件引用: `@[path/to/file]` 或 `@[path:10:20]`（支持行号范围）
- 工具调用: `@[tool_name{"arg": "value"}]`

该类提供两种解析模式：
- **INLINE 模式**: 将解析结果直接替换到原文中
- **APPEND 模式**: 将解析结果追加到缓冲区，保留原文

## 导出的枚举

### ParseMode

```typescript
enum ParseMode {
    INLINE = 'INLINE',  // 内联模式：直接替换原文
    APPEND = 'APPEND'   // 追加模式：追加到缓冲区
}
```

## ContextAssembler 类

### 静态方法

#### assembleDocument

递归解析静态文件引用和动态工具调用，组装完整文档。

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
- `text` - 包含 `@[]` 标签的源文本
- `workspaceRoot` - 解析相对路径时使用的根目录
- `allowedUris` - 工具执行期间允许访问的URI列表（安全检查）
- `mode` - 解析模式，默认为 INLINE
- `appendBuffer` - APPEND 模式的结果缓冲区

**返回值:**
- INLINE 模式返回完全组装后的文本
- APPEND 模式返回原始文本

**示例:**
```typescript
const text = '@[README.md]';
const result = await ContextAssembler.assembleDocument(
    text, 
    '/workspace', 
    ['/workspace'], 
    ParseMode.INLINE
);
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
