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
- **宏上下文共享**: 支持跨文件共享宏定义，通过 `MacroContext` 实现

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

### MacroContext

宏上下文，用于跨文件共享宏定义。

```typescript
class MacroContext {
    variables: Map<string, string>;  // 宏变量存储
    define(name: string, value: string): void;  // 定义宏
    get(name: string): string | undefined;      // 获取宏值
}
```

## ContextAssembler 类

### 静态方法

#### preprocess

运行预处理器处理 `@{...}` 宏定义语法。

```typescript
static preprocess(text: string, macroContext?: MacroContext): string
```

**参数:**
- `text`: 要预处理的文本
- `macroContext` (可选): 外部宏上下文，用于跨文件共享宏定义

**描述:**
预处理步骤会解析 `@{...}` 语法，支持：
- 宏定义：`@{define NAME=value}`
- 宏替换：`@{NAME}`
- 条件编译：`@{ifdef NAME}...@{endif}`

当传入 `macroContext` 时，宏定义会被存储到共享上下文中，供后续文件使用。

**示例:**
```typescript
// 创建共享宏上下文
const macroContext = new MacroContext();

// 预处理第一个文件，定义宏
const text1 = '@{define VERSION=1.0.0}';
ContextAssembler.preprocess(text1, macroContext);

// 预处理第二个文件，使用已定义的宏
const text2 = 'Version: @{VERSION}';
const result = ContextAssembler.preprocess(text2, macroContext);
// result: 'Version: 1.0.0'
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
    collector?: ContextItem[],
    macroContext?: MacroContext  // 新增参数
): Promise<string>
```

**参数:**
- `text`: 文档文本
- `workspaceRoot`: 工作区根路径
- `allowedUris`: 允许的 URI（安全）
- `mode`: 解析模式 (INLINE/APPEND)
- `collector`: (可选) 用于收集上下文项的数组
- `macroContext` (可选): 共享的 MacroContext，用于跨文件宏定义

**返回值:**
- 组装后的字符串

**描述:**
当传入 `macroContext` 时，所有被引用的文件将共享同一个宏上下文。这意味着：
- 在文件 A 中定义的宏可以在文件 B 中使用
- 宏定义按解析顺序累积

**示例:**
```typescript
const macroContext = new MacroContext();

// 组装文档，所有引用的文件共享宏上下文
const result = await ContextAssembler.assembleDocument(
    '@[config.md] @[main.ts]',
    workspaceRoot,
    allowedUris,
    ParseMode.INLINE,
    undefined,
    macroContext
);
```

---

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
    "Check @[src/main.ts] and run @[git_status{}}", 
    root, 
    allowedUris
);
// items: [
//   { type: 'file', key: 'src/main.ts', content: '...' },
//   { type: 'tool', key: 'git_status', content: '...', metadata: {} }
// ]
```

---

#### resolveContextWithMacros

解析用户 prompt 中的引用，收集上下文项（支持宏）。

```typescript
static async resolveContextWithMacros(
    text: string,
    workspaceRoot: string,
    allowedUris: string[],
    macroContext?: MacroContext
): Promise<ContextItem[]>
```

**参数:**
- `text`: 用户 prompt 文本
- `workspaceRoot`: 工作区根路径
- `allowedUris`: 允许的 URI（安全）
- `macroContext` (可选): 共享的 MacroContext

**返回值:**
- 收集的上下文项数组

**描述:**
此方法与 `resolveContext` 类似，但增加了对宏上下文的支持。适用于需要在解析过程中使用共享宏定义的场景。

**示例:**
```typescript
// 从 prompt 创建宏上下文
const macroContext = new MacroContext();

// 解析上下文，支持跨文件宏
const items = await ContextAssembler.resolveContextWithMacros(
    "@[template.md] @[data.json]",
    workspaceRoot,
    allowedUris,
    macroContext
);
```

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

---

## 使用流程

### 宏上下文使用流程

```
┌─────────────────────────────────────────────────────────────┐
│  1. 从 prompt 提取宏定义                                      │
│     例如: "@{define API_BASE=/api/v1} Check @[config.md]"    │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  2. 创建共享 MacroContext                                    │
│     const macroContext = new MacroContext();                 │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  3. 预处理 prompt，将宏定义存入 context                       │
│     ContextAssembler.preprocess(prompt, macroContext);       │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  4. 调用 resolveContextWithMacros 或 assembleDocument        │
│     传入 macroContext 参数                                    │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  5. 所有被引用的文件共享同一个宏上下文                         │
│     - 在 config.md 中可使用 @{API_BASE}                      │
│     - 后续引用的文件也能访问同一宏                            │
└─────────────────────────────────────────────────────────────┘
```

### 完整使用示例

```typescript
import { ContextAssembler, MacroContext } from './contextAssembler';

async function processUserPrompt(prompt: string, workspaceRoot: string, allowedUris: string[]) {
    // 步骤 1 & 2: 创建宏上下文并预处理
    const macroContext = new MacroContext();
    const preprocessedPrompt = ContextAssembler.preprocess(prompt, macroContext);
    
    // 步骤 3: 解析上下文（支持宏共享）
    const contextItems = await ContextAssembler.resolveContextWithMacros(
        preprocessedPrompt,
        workspaceRoot,
        allowedUris,
        macroContext
    );
    
    // 使用收集的上下文项
    for (const item of contextItems) {
        console.log(`Type: ${item.type}, Key: ${item.key}`);
        console.log(`Content: ${item.content}`);
    }
    
    return contextItems;
}

// 使用示例
const prompt = `
@{define ENV=production}
@{define VERSION=2.0.0}

请检查以下配置：
@[config/app.config.md]
@[src/main.ts]
`;

processUserPrompt(prompt, '/workspace', allowedUris);
```

### 跨文件宏共享示例

**文件 A (macros.md):**
```markdown
@{define PROJECT_NAME=MyApp}
@{define AUTHOR=Team Alpha}
@{define MAX_RETRY=3}
```

**文件 B (template.md):**
```markdown
# @{PROJECT_NAME}

Created by @{AUTHOR}
Max retries: @{MAX_RETRY}
```

**处理代码:**
```typescript
const macroContext = new MacroContext();

// 先解析 macros.md，定义宏
await ContextAssembler.assembleDocument(
    '@[macros.md]',
    workspaceRoot,
    allowedUris,
    ParseMode.INLINE,
    undefined,
    macroContext
);

// 再解析 template.md，使用已定义的宏
const result = await ContextAssembler.assembleDocument(
    '@[template.md]',
    workspaceRoot,
    allowedUris,
    ParseMode.INLINE,
    undefined,
    macroContext
);

// result:
// # MyApp
// 
// Created by Team Alpha
// Max retries: 3
```
