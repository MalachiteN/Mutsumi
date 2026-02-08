# contextAssembler.ts

## 功能概述

ContextAssembler 类负责解析和组装动态上下文，支持文件引用 `@[path]` 和工具调用 `@[tool]` 语法。

ContextAssembler 采用**收集器模式 (Collector Pattern)**，可以将解析出的上下文项（文件内容、工具结果等）收集到结构化的列表中。这使得可以灵活地决定如何呈现这些上下文（例如：注入到 System Prompt，或者追加到 User Message 的末尾）。

### 核心特性

- **预处理器支持**: 处理 `@{...}` 宏定义和条件编译
- **递归解析**: 支持嵌套引用的文件展开
- **结构化收集**: 生成 `ContextItem` 列表，包含类型、键（路径/工具名）、内容和元数据
- **双模式解析**: 
  - `INLINE`: 直接在原文中替换（用于规则文件的内部展开）
  - `APPEND`: 保留原文标签，将结果收集起来（用于用户 Prompt 的解析）

## 接口定义

### ParseMode

```typescript
enum ParseMode {
    INLINE = 'INLINE',  // 内联模式：直接替换原文
    APPEND = 'APPEND'   // 追加模式：将结果收集到列表，保留原文
}
```

### ContextItem

表示一个被解析出的上下文项。

```typescript
interface ContextItem {
    type: 'file' | 'tool' | 'rule'; // 上下文类型
    key: string;                    // 标识符（文件路径或工具名）
    content: string;                // 内容或执行结果
    metadata?: any;                 // 附加元数据（如工具参数）
}
```

## ContextAssembler 类

### 静态方法

#### resolveContext

解析文本并收集所有上下文项。这是处理 User Prompt 的主要入口点。

```typescript
static async resolveContext(
    text: string,
    workspaceRoot: string,
    allowedUris: string[]
): Promise<ContextItem[]>
```

**参数:**
- `text`: 输入文本
- `workspaceRoot`: 工作区根路径
- `allowedUris`: 允许访问的 URI 列表

**返回值:**
- `ContextItem[]`: 收集到的上下文项列表

**示例:**
```typescript
const items = await ContextAssembler.resolveContext(
    "Check @[src/main.ts] and run @[git_status{}]", 
    root, 
    allowedUris
);
// items: [
//   { type: 'file', key: 'src/main.ts', content: '...' },
//   { type: 'tool', key: 'git_status', content: '...', metadata: {} }
// ]
```

---

#### assembleDocument

完整的文档组装管道：预处理 -> 递归解析。主要用于 `INLINE` 模式下的规则文件展开。

```typescript
static async assembleDocument(
    text: string,
    workspaceRoot: string,
    allowedUris: string[],
    mode: ParseMode = ParseMode.INLINE,
    collector?: ContextItem[]
): Promise<string>
```

**参数:**
- `mode`: 解析模式 (INLINE/APPEND)
- `collector`: (可选) 用于收集上下文项的数组

**返回值:**
- 组装后的字符串

---

#### prepareSkill

核心解析逻辑，处理 `@[...]` 语法和 Front Matter。

```typescript
static async prepareSkill(
    text: string,
    workspaceRoot: string,
    allowedUris: string[],
    mode: ParseMode = ParseMode.INLINE,
    collector?: ContextItem[]
): Promise<PrepareSkillResult>
```

**处理流程:**
1. 解析 YAML Front Matter (Description, Params)
2. 递归解析静态文件引用 (`resolveStaticIncludes`)
3. 解析动态工具调用 (`resolveDynamicTools`)
4. 合并去重 Params

---

#### executeToolCall

执行工具调用。

```typescript
static async executeToolCall(
    name: string, 
    args: any, 
    allowedUris: string[]
): Promise<string>
```

---

#### readResource / parseReference

辅助方法，用于读取文件资源和解析引用路径（支持行号）。

```typescript
// 读取资源
static async readResource(uri: vscode.Uri, start?: number, end?: number): Promise<string>

// 解析引用 path:start:end
static parseReference(ref: string, root: string): { uri, startLine, endLine }
```
