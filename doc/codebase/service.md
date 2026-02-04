# service.ts

## 概述

`service.ts` 是 Mutsumi VSCode 插件 **codebase 模块** 的核心服务实现，提供基于 Tree-sitter 的代码解析和大纲生成功能。`CodebaseService` 采用单例模式管理多语言解析器实例，支持 30+ 种编程语言的代码结构分析。

---

## 接口定义

### `OutlineNode`

代码大纲节点的数据结构，表示代码中的一个定义（类、函数、变量等）。

```typescript
interface OutlineNode {
    type: string;           // 节点类型（如 'Class', 'Function', 'Method'）
    name: string;           // 节点名称
    startLine: number;      // 起始行号（0-based）
    endLine: number;        // 结束行号（0-based）
    children: OutlineNode[]; // 子节点（如类的方法、命名空间的类）
}
```

**字段说明：**

| 字段名 | 类型 | 说明 |
|--------|------|------|
| `type` | `string` | 大纲类别（来自 `LANGUAGE_CONFIGS` 的 `definitions` 映射值） |
| `name` | `string` | 标识符名称，若无法提取则显示为 `'<anonymous>'` |
| `startLine` | `number` | 代码定义的起始行号 |
| `endLine` | `number` | 代码定义的结束行号 |
| `children` | `OutlineNode[]` | 嵌套的子定义，形成树形结构 |

---

## 类：CodebaseService

**设计模式：** 单例模式 (Singleton)

**职责：** 管理 Tree-sitter 解析器生命周期，提供文件大纲生成服务。

### 属性

| 属性名 | 类型 | 说明 |
|--------|------|------|
| `instance` | `CodebaseService` (static) | 单例实例 |
| `parsers` | `Map<string, Parser>` | 语言 ID → Tree-sitter Parser 实例的缓存 |
| `languages` | `Map<string, Parser.Language>` | 语言 ID → 已加载的语言对象缓存 |
| `initialized` | `boolean` | Tree-sitter 是否已初始化 |
| `context` | `vscode.ExtensionContext` | VSCode 扩展上下文 |
| `outlineCache` | `Map<string, OutlineNode[]>` | URI → 大纲节点的内存缓存 |

---

### 方法

#### `getInstance(): CodebaseService`

**静态方法** - 获取 `CodebaseService` 的单例实例。

**返回值：** `CodebaseService` - 服务实例

**使用示例：**

```typescript
const service = CodebaseService.getInstance();
await service.initialize(context);
```

---

#### `initialize(context: vscode.ExtensionContext): Promise<void>`

初始化 Tree-sitter 解析器环境。

**参数：**

| 参数名 | 类型 | 说明 |
|--------|------|------|
| `context` | `vscode.ExtensionContext` | VSCode 扩展上下文，用于获取 WASM 文件路径 |

**说明：**
- 调用 `Parser.init()` 初始化 Tree-sitter 运行时
- 初始化是幂等的（多次调用只有第一次有效）
- 初始化失败会在控制台输出错误日志

---

#### `getFileOutline(uri: vscode.Uri, content?: string): Promise<OutlineNode[] | null>`

生成指定文件的代码大纲。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `uri` | `vscode.Uri` | ✅ | 文件的 VSCode URI |
| `content` | `string` | ❌ | 可选的文件内容，若未提供则从磁盘读取 |

**返回值：** `Promise<OutlineNode[] | null>`
- 成功：大纲节点数组（树形结构）
- 失败：`null`（解析失败、语言不支持或文件读取错误）

**处理流程：**
1. 检查服务是否已初始化
2. 根据文件扩展名获取语言 ID
3. 获取或创建对应语言的 Parser
4. 读取文件内容（如未提供）
5. 解析生成 AST 并提取大纲节点
6. 更新内存缓存并返回结果

**使用示例：**

```typescript
const uri = vscode.Uri.file('/path/to/file.ts');
const outline = await service.getFileOutline(uri);
if (outline) {
    console.log(service.formatOutline(outline));
}
```

---

#### `formatOutline(nodes: OutlineNode[], depth?: number): string`

将大纲节点格式化为可读的字符串表示。

**参数：**

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
|--------|------|------|--------|------|
| `nodes` | `OutlineNode[]` | ✅ | - | 大纲节点数组 |
| `depth` | `number` | ❌ | `0` | 当前缩进层级 |

**返回值：** `string` - 格式化后的文本

**输出格式：**

```
- Class MyClass
  - Method constructor
  - Method myMethod
- Function helperFunc
- Interface MyInterface
```

---

### 私有方法

#### `getLanguage(langId: string): Promise<Parser.Language | null>`

加载指定语言的 Tree-sitter 语言对象。

**参数：**
| 参数名 | 类型 | 说明 |
|--------|------|------|
| `langId` | `string` | 语言 ID（如 `'typescript'`） |

**处理流程：**
1. 检查缓存是否已存在
2. 从 `LANGUAGE_CONFIGS` 获取配置
3. 从 `assets/tree-sitter/<wasmName>` 加载 WASM 文件
4. 缓存并返回语言对象

---

#### `getParser(langId: string): Promise<Parser | null>`

获取或创建指定语言的 Parser 实例。

**参数：**
| 参数名 | 类型 | 说明 |
|--------|------|------|
| `langId` | `string` | 语言 ID |

**返回值：** `Parser | null` - 配置好的 Parser 实例

---

#### `extractNodes(node: Parser.SyntaxNode, config: LanguageConfig, source: string): OutlineNode[]`

递归提取 AST 节点中的大纲定义。

**参数：**
| 参数名 | 类型 | 说明 |
|--------|------|------|
| `node` | `Parser.SyntaxNode` | 当前 AST 节点 |
| `config` | `LanguageConfig` | 语言配置 |
| `source` | `string` | 源代码文本 |

**算法说明：**
- 深度优先遍历 AST 子节点
- 根据 `config.definitions` 识别定义节点
- 根据 `config.containers` 决定是否递归查找子成员
- 对包装节点（如 `export_statement`）展开并提升内部定义

---

#### `getNodeName(node: Parser.SyntaxNode, source: string): string | null`

从 AST 节点中提取标识符名称。

**提取策略：**
1. 尝试获取 `name` 字段的子节点
2. 遍历子节点查找 `identifier`、`type_identifier` 或 `name` 类型
3. 若未找到返回 `null`

---

## 与其他模块的关系

```
┌─────────────────────────────────────────────────────────┐
│                    外部调用者                            │
│  (VSCode Extension / Commands / Providers)              │
└────────────────────┬────────────────────────────────────┘
                     │ 调用
                     ▼
┌─────────────────────────────────────────────────────────┐
│  service.ts                                             │
│  ┌─────────────────────────────────────────────────────┐│
│  │ CodebaseService (Singleton)                         ││
│  │  ├─ getFileOutline() ──────┐                       ││
│  │  ├─ formatOutline()        │                       ││
│  │  └─ extractNodes()         │                       ││
│  └────────────────────────────┼───────────────────────┘│
│                               │                         │
│  ┌────────────────────────────┼───────────────────────┐│
│  │ 依赖导入                  ▼                       ││
│  │  ┌─────────────┐    ┌─────────────┐               ││
│  │  │definitions.ts│    │  web-tree-sitter            ││
│  │  │LANGUAGE_     │◄───│  (Tree-sitter Parser)       ││
│  │  │CONFIGS       │    │                             ││
│  │  └─────────────┘    └─────────────┘               ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

**依赖关系：**
- **导入 `definitions.ts`**：使用 `LANGUAGE_CONFIGS` 和 `EXT_TO_LANG` 进行语言和文件类型映射
- **导入 `web-tree-sitter`**：使用 Tree-sitter 进行代码解析
- **被调用方**：VSCode 扩展的命令、Tree View Provider 等功能模块

---

## 使用示例

### 基本使用流程

```typescript
import { CodebaseService } from './service';

// 1. 获取单例并初始化
const service = CodebaseService.getInstance();
await service.initialize(context);

// 2. 获取文件大纲
const uri = vscode.Uri.file('/path/to/example.ts');
const outline = await service.getFileOutline(uri);

// 3. 使用大纲数据
if (outline) {
    // 格式化输出
    console.log(service.formatOutline(outline));
    
    // 遍历处理
    for (const node of outline) {
        console.log(`${node.type}: ${node.name} (行 ${node.startLine + 1})`);
    }
}
```

### 处理内存缓存

```typescript
// 第一次调用会解析并缓存
const outline1 = await service.getFileOutline(uri);

// 后续调用从缓存返回（当前实现）
// 注意：实际生产环境应监听文件变更事件来更新缓存
```

---

## 性能注意事项

1. **WASM 懒加载**：语言 WASM 文件按需加载，避免启动时加载所有语言
2. **Parser 复用**：每个语言的 Parser 实例被缓存，避免重复创建
3. **内存缓存**：文件大纲结果缓存在内存中，重复请求直接返回
4. **AST 释放**：解析完成后调用 `tree.delete()` 释放内存
5. **未来优化**：建议添加文件变更监听器，在文件修改时使缓存失效
