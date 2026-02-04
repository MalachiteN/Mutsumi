# Codebase 模块

> 一句话概括：提供**代码库结构分析**与**Outline 生成**能力的核心模块，基于 `web-tree-sitter` 实现多语言源代码解析。

---

## 1. 文件组成与职责

```
codebase/
├── definitions.ts   # 语言配置定义
├── service.ts       # CodebaseService 核心服务
└── module.md        # 本模块文档
```

### 1.1 definitions.ts - 语言配置定义

**核心职责**：定义不同编程语言的 Tree-sitter 解析配置，维护 AST 节点类型到大纲类别的映射。

**主要内容**：
- `LanguageConfig` 接口：规范语言配置的数据结构
  - `wasmName`：Tree-sitter WASM 文件名
  - `definitions`：AST 节点类型到大纲类别（如 Class, Method）的映射表
  - `containers`：需要递归扫描子成员的节点类型集合
  - `nameField`：用于提取名称的字段名（可选）
- `LANGUAGE_CONFIGS`：支持的语言配置映射表（支持 30+ 种语言）
- `EXT_TO_LANG`：文件扩展名到语言 ID 的映射表

### 1.2 service.ts - CodebaseService 核心服务

**核心职责**：提供单例服务，封装 `web-tree-sitter` 初始化、WASM 加载、代码解析、Outline 生成和缓存管理。

**主要类与方法**：

| 成员 | 类型 | 说明 |
|------|------|------|
| `CodebaseService` | Class | 单例服务类，管理 Parser 实例和缓存 |
| `getInstance()` | Static Method | 获取单例实例 |
| `initialize(context)` | Method | 初始化 Tree-sitter 环境 |
| `getFileOutline(uri)` | Method | 生成指定文件的 Outline 结构树 |
| `getParser(langId)` | Method | 获取/初始化对应语言的 Parser |
| `extractNodes(node, config, source)` | Method | 递归遍历 AST 提取大纲节点 |

---

## 2. 关键能力

### 2.1 Outline 生成流程

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   输入文件 URI   │────▶│  扩展名映射匹配  │────▶│ WASM 按需加载   │
└─────────────────┘     │  (EXT_TO_LANG)  │     │ (web-tree-sitter)│
                        └─────────────────┘     └─────────────────┘
                                                        │
                        ┌─────────────────┐            ▼
                        │  返回 Outline   │◀───┌─────────────────┐
                        │   Node 树结构    │    │  解析为语法树   │
                        └─────────────────┘    │      (AST)      │
                               │               └─────────────────┘
                               │                       │
                               │               ┌─────────────────┐
                               └───────────────│ 递归遍历与映射  │
                                               │ (definitions)   │
                                               └─────────────────┘
```

**详细步骤**：

1. **语言检测**
   - 通过 `EXT_TO_LANG` 将文件扩展名（如 `.ts`）映射为语言 ID（`typescript`）。
   - 从 `LANGUAGE_CONFIGS` 获取对应的配置 `LanguageConfig`。

2. **Parser 初始化**
   - 检查服务是否已初始化。
   - 检查是否已有缓存的 Parser 实例。
   - 若无，从 `assets/tree-sitter/` 加载对应的 `.wasm` 文件。
   - 创建并配置 Parser。

3. **语法解析**
   - 读取文件内容。
   - 调用 `parser.parse(content)` 生成完整语法树 (AST)。

4. **节点提取**
   - 深度优先遍历 AST。
   - 使用 `config.definitions` 判断当前节点是否为关注的定义（如 `class_declaration` -> `Class`）。
   - 使用 `config.containers` 判断是否需要进入该节点内部继续扫描。
   - 提取节点名称（标识符）。

5. **结构构建**
   - 将提取的信息转换为 `OutlineNode` 对象。
   - 维护父子层级关系。

### 2.2 缓存机制

**多级缓存**：
1. **Parser 缓存** (`parsers: Map<string, Parser>`)：复用 Parser 实例，避免重复加载 WASM。
2. **语言对象缓存** (`languages: Map<string, Parser.Language>`)：复用编译后的语言定义。
3. **大纲结果缓存** (`outlineCache: Map<string, OutlineNode[]>`)：
   - Key 为文件 URI。
   - 缓存解析后的大纲结果，提升重复访问性能。
   - *注意：实际使用中应结合文件变更事件清理缓存。*

---

## 3. 模块边界

### 3.1 输入

| 输入项 | 类型 | 说明 |
|--------|------|------|
| `uri` | `vscode.Uri` | 目标文件的 VSCode URI |
| 文件内容 | `string` (可选) | 源代码文本，若未提供则从磁盘读取 |

### 3.2 输出

**OutlineNode 树结构**：

```typescript
interface OutlineNode {
    type: string;           // 大纲类别 (Class, Method, Function 等)
    name: string;           // 节点名称
    startLine: number;      // 起始行号 (0-based)
    endLine: number;        // 结束行号 (0-based)
    children: OutlineNode[]; // 子节点列表
}
```

**输出示例**：

```typescript
// TypeScript 代码:
// class User { getName() {} }

// 生成的 OutlineNode:
{
  type: "Class",
  name: "User",
  startLine: 0,
  endLine: 0,
  children: [
    {
      type: "Method",
      name: "getName",
      startLine: 0,
      endLine: 0,
      children: []
    }
  ]
}
```

### 3.3 模块依赖

**依赖项**：
- `web-tree-sitter`: 基于 WASM 的 Tree-sitter 运行时。
- `assets/tree-sitter/*.wasm`: 各语言的语法解析文件。

**被调用方**：
- Agent 上下文构建模块。
- VSCode UI 组件（树状视图、代码导航）。

---

## 4. 扩展指南

### 4.1 添加新语言支持

1. **准备 WASM**：
   - 编译或获取 `tree-sitter-<language>.wasm`。
   - 将文件放置在插件的 `assets/tree-sitter/` 目录下。

2. **配置映射 (`definitions.ts`)**：
   - 在 `LANGUAGE_CONFIGS` 中添加新语言配置：
     ```typescript
     'newlang': {
         wasmName: 'tree-sitter-newlang.wasm',
         definitions: {
             'class_def': 'Class',
             'func_def': 'Function'
         },
         containers: new Set(['class_def', 'module'])
     }
     ```

3. **关联扩展名 (`definitions.ts`)**：
   - 在 `EXT_TO_LANG` 中添加映射：
     ```typescript
     '.nl': 'newlang'
     ```

---

## 5. 总结

Codebase 模块通过 **`web-tree-sitter`** 和 **WASM** 技术实现了高性能、跨平台的多语言代码分析。其设计核心在于：

- **配置驱动**：通过 `definitions.ts` 集中管理语言规则，无需编写复杂的解析逻辑。
- **通用抽象**：将不同语言的 AST 归一化为通用的 `OutlineNode` 结构。
- **资源优化**：按需加载 WASM 文件，减少内存占用。

该模块是 Mutsumi 理解项目代码结构的基石。
