# service.ts

代码结构大纲生成服务。使用 Tree-sitter 解析源代码并提取类、函数、方法等定义。

---

## 接口

### OutlineNode

大纲树中的节点结构。

| 属性 | 类型 | 说明 |
|------|------|------|
| type | string | 节点类型，如 'Class', 'Function', 'Method' |
| name | string | 节点名称/标识符 |
| startLine | number | 起始行号（从 0 开始） |
| endLine | number | 结束行号（从 0 开始） |
| children | OutlineNode[] | 子节点数组 |

---

## 类

### CodebaseService

单例服务类，用于解析代码文件并生成结构大纲。

#### 静态方法

##### getInstance()

获取 CodebaseService 的单例实例。

```typescript
public static getInstance(): CodebaseService
```

- **返回**: `CodebaseService` - 单例实例

#### 实例方法

##### initialize()

初始化 Tree-sitter 解析库。使用其他方法前必须调用此方法。

```typescript
public async initialize(context: vscode.ExtensionContext): Promise<void>
```

- **参数**:
  - `context`: VSCode 扩展上下文
- **返回**: `Promise<void>`
- **抛出**: 初始化失败时抛出错误

##### getFileOutline()

生成源文件的结构大纲。解析文件内容并提取类、函数、方法等定义。结果被缓存。

```typescript
public async getFileOutline(uri: vscode.Uri, content?: string): Promise<OutlineNode[] | null>
```

- **参数**:
  - `uri`: 要分析的文件的 URI
  - `content?`: 可选的文件内容。如未提供，将从磁盘读取文件
- **返回**: `Promise<OutlineNode[] | null>` - 根大纲节点数组，解析失败时返回 null

##### formatOutline()

将大纲节点格式化为可读的字符串表示。用于调试和显示大纲结构。

```typescript
public formatOutline(nodes: OutlineNode[], depth?: number): string
```

- **参数**:
  - `nodes`: 要格式化的节点数组
  - `depth?`: 当前缩进深度（用于递归）
- **返回**: `string` - 格式化后的字符串

**示例输出**:
```
- Class MyClass
  - Method myMethod
- Function myFunction
```

---

## 私有方法（内部实现）

### getLanguage(langId: string)

加载并返回指定语言 ID 的 Tree-sitter Language 对象。首次加载后会被缓存。

### getParser(langId: string)

获取或创建指定语言的 Tree-sitter 解析器。首次创建后会被缓存。

### extractNodes(node, config, source)

从 Tree-sitter 语法树中递归提取大纲节点。

### getNodeName(node, source)

从语法节点中提取标识符/名称。使用多种策略：字段名查找、标识符子节点查找。

---

## 缓存机制

服务内部维护以下缓存：

| 缓存 | 类型 | 用途 |
|------|------|------|
| parsers | Map<string, Parser> | 语言解析器缓存 |
| languages | Map<string, Parser.Language> | 语言对象缓存 |
| outlineCache | Map<string, OutlineNode[]> | 文件大纲缓存（uri -> 节点数组）|
