# utils.ts

## 概述

上下文管理工具模块，提供处理多模态消息、文件引用解析、资源读取、Ghost Block 处理等实用功能。

该模块是 Mutsumi 插件动态上下文系统的核心支撑，负责：
- 图片消息的解析与 Base64 编码转换
- 用户消息中的 Markdown 图片语法处理
- 文件引用字符串的解析（支持行范围指定）
- Ghost Block 的标记与剥离
- 工具调用的执行封装

---

## 常量

### `GHOST_BLOCK_MARKER`

Ghost Block 标记常量，用于在序列化时过滤临时内容。

```typescript
export const GHOST_BLOCK_MARKER = '<content_reference>';
```

**说明：**
- 该标记用于标识动态插入的上下文引用内容
- 在消息持久化到 notebook 前会被 `stripGhostBlock()` 函数移除
- 确保临时上下文不会污染保存的对话历史

---

### `IMG_REGEX`

Markdown 图片语法正则表达式，匹配 `![alt](uri)` 格式。

```typescript
export const IMG_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/g;
```

**捕获组：**
- `$1` - 图片的 alt 文本（描述）
- `$2` - 图片的 URI 或路径

**使用场景：**
- 解析用户粘贴的图片
- 将 Markdown 图片语法转换为多模态消息格式

---

## 函数

### `getLanguageIdentifier()`

根据文件扩展名获取对应的 Markdown 代码块语言标识符。

```typescript
export function getLanguageIdentifier(ext: string): string
```

**参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| `ext` | `string` | 文件扩展名（不含点号） |

**返回值：**
- `string` - 对应的语言标识符，如果没有映射则返回空字符串

**支持的语言映射：**

| 扩展名 | 语言标识符 |
|--------|-----------|
| ts | typescript |
| tsx | tsx |
| js, jsx | javascript, jsx |
| py | python |
| rs | rust |
| go | go |
| java | java |
| c, cpp, cc, h, hpp | c, cpp |
| cs | csharp |
| html, htm | html |
| css, scss, sass, less | css, scss, sass, less |
| json | json |
| yaml, yml | yaml |
| md | markdown |
| sh, bash, zsh | bash, bash, zsh |
| ps1 | powershell |
| vue, svelte, astro | vue, svelte, astro |
| ... | ... |

**示例：**
```typescript
getLanguageIdentifier('ts');      // 'typescript'
getLanguageIdentifier('py');      // 'python'
getLanguageIdentifier('unknown'); // ''
```

---

### `readImageAsBase64()`

读取图片文件并转换为 Base64 数据 URL 格式。

```typescript
export async function readImageAsBase64(uriStr: string): Promise<string | null>
```

**参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| `uriStr` | `string` | 图片文件的 URI 字符串 |

**返回值：**
- `Promise<string | null>` - Base64 编码的数据 URL，失败返回 `null`

**支持的操作：**
- **本地文件** (`file://`)：读取并转换为 Base64
- **网络图片** (`http://`, `https://`)：直接返回原 URL
- **其他协议**：返回 `null`

**自动检测 MIME 类型：**
| 扩展名 | MIME 类型 |
|--------|-----------|
| png | image/png |
| webp | image/webp |
| gif | image/gif |
| 其他 | image/jpeg |

**示例：**
```typescript
const base64 = await readImageAsBase64('file:///path/to/image.png');
// 返回: "data:image/png;base64,iVBORw0KGgo..."

const url = await readImageAsBase64('https://example.com/img.jpg');
// 返回: "https://example.com/img.jpg"
```

---

### `parseUserMessageWithImages()`

解析用户消息文本，将其中嵌入的 Markdown 图片转换为多模态内容格式。

```typescript
export async function parseUserMessageWithImages(text: string): Promise<MessageContent>
```

**参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| `text` | `string` | 用户输入的原始消息文本 |

**返回值：**
- `Promise<MessageContent>` - 如果包含图片则返回内容部分数组，否则返回原字符串

**处理逻辑：**
1. 使用 `IMG_REGEX` 匹配所有 Markdown 图片语法
2. 将文本分割为多个部分（文本 + 图片）
3. 对每个图片调用 `readImageAsBase64()` 读取
4. 组装为 `ContentPartText` 和 `ContentPartImage` 数组

**错误处理：**
- 图片读取失败时，保留原始的 Markdown 语法作为文本

**示例：**
```typescript
const text = '请看这张图片: ![screenshot](file:///path/to/img.png) 谢谢！';
const content = await parseUserMessageWithImages(text);
// 返回:
// [
//   { type: 'text', text: '请看这张图片: ' },
//   { type: 'image_url', image_url: { url: 'data:image/png;base64,...', detail: 'auto' } },
//   { type: 'text', text: ' 谢谢！' }
// ]
```

---

### `stripGhostBlock()`

从消息内容中剥离 Ghost Block，确保临时引用内容不会被持久化。

```typescript
export function stripGhostBlock(content: MessageContent): MessageContent
```

**参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| `content` | `MessageContent` | 消息内容（字符串或内容部分数组） |

**返回值：**
- `MessageContent` - 剥离 Ghost Block 后的内容

**处理规则：**
- **字符串内容**：找到 `GHOST_BLOCK_MARKER` 标记，截取标记之前的部分
- **数组内容**：过滤掉包含 Ghost Block 标记的文本部分

**使用场景：**
- 在保存 notebook 前清理消息内容
- 防止动态上下文污染持久化存储

**示例：**
```typescript
const content = '用户消息\n<content_reference>\n临时上下文内容';
const cleaned = stripGhostBlock(content);
// 返回: '用户消息'

const arrayContent = [
  { type: 'text', text: '正常文本' },
  { type: 'text', text: '<content_reference>\n临时内容' },
  { type: 'image_url', image_url: { url: '...', detail: 'auto' } }
];
const cleanedArray = stripGhostBlock(arrayContent);
// 返回: [{ type: 'text', text: '正常文本' }, { type: 'image_url', ... }]
```

---

### `extractBracketContent()`

从指定位置开始提取方括号内的内容，支持嵌套方括号。

```typescript
export function extractBracketContent(text: string, start: number): { content: string, endIdx: number }
```

**参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| `text` | `string` | 要解析的文本 |
| `start` | `number` | 起始索引（从该位置开始查找 `[`） |

**返回值：**
| 属性 | 类型 | 说明 |
|------|------|------|
| `content` | `string` | 提取的括号内内容（不含外层括号） |
| `endIdx` | `number` | 结束括号的位置索引，失败返回 `-1` |

**算法说明：**
- 使用深度计数器处理嵌套方括号
- 遇到 `[` 深度 +1，遇到 `]` 深度 -1
- 当深度归零时找到匹配的结束括号

**示例：**
```typescript
const text = '[outer [inner] content]';
const result = extractBracketContent(text, 0);
// 返回: { content: 'outer [inner] content', endIdx: 24 }
```

---

### `parseReference()`

解析文件引用字符串，提取 URI 和可选的行范围。

```typescript
export function parseReference(ref: string, root: string): { uri: vscode.Uri, startLine?: number, endLine?: number }
```

**参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| `ref` | `string` | 引用字符串，格式：`path[:startLine[:endLine]]` |
| `root` | `string` | 工作区根目录路径 |

**返回值：**
| 属性 | 类型 | 说明 |
|------|------|------|
| `uri` | `vscode.Uri` | 解析后的文件 URI |
| `startLine` | `number` | 起始行号（1-based，可选） |
| `endLine` | `number` | 结束行号（1-based，可选） |

**支持的引用格式：**
| 格式 | 说明 |
|------|------|
| `file.txt` | 仅文件路径 |
| `file.txt:10` | 文件 + 起始行 |
| `file.txt:10:20` | 文件 + 行范围 |
| `/absolute/path/file.ts` | 绝对路径 |
| `file:///path/to/file.ts` | URI 格式 |

**示例：**
```typescript
// 相对路径
parseReference('src/index.ts:10:20', '/workspace');
// 返回: { uri: Uri('/workspace/src/index.ts'), startLine: 10, endLine: 20 }

// 绝对路径
parseReference('/home/user/file.txt:5', '/workspace');
// 返回: { uri: Uri('/home/user/file.txt'), startLine: 5 }

// URI 格式
parseReference('file:///path/to/file.md', '/workspace');
// 返回: { uri: Uri('file:///path/to/file.md') }
```

---

### `readResource()`

读取资源内容，支持文件、目录和行范围截取。

```typescript
export async function readResource(uri: vscode.Uri, start?: number, end?: number): Promise<string>
```

**参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| `uri` | `vscode.Uri` | 资源 URI |
| `start` | `number` | 起始行号（1-based，可选） |
| `end` | `number` | 结束行号（1-based，可选） |

**返回值：**
- `Promise<string>` - 资源内容

**处理逻辑：**
- **目录**：返回目录条目列表，格式为 `[DIR] name` 或 `[FILE] name`
- **文件**：
  - 无行范围：返回完整内容
  - 有起始行：返回从该行开始到文件末尾
  - 有行范围：返回指定范围的行

**注意：**
- 行号转换为 0-based 索引：`start - 1`
- 支持 Windows (`\r\n`) 和 Unix (`\n`) 换行符

**示例：**
```typescript
// 读取完整文件
const content = await readResource(Uri.file('/path/to/file.ts'));

// 读取指定行范围
const lines = await readResource(Uri.file('/path/to/file.ts'), 10, 20);
// 返回第 10-20 行的内容

// 读取目录
const dirContent = await readResource(Uri.file('/path/to/dir'));
// 返回:
// [DIR] subdir
// [FILE] file1.ts
// [FILE] file2.ts
```

---

### `isMarkdownFile()`

检查 URI 是否指向 Markdown 文件。

```typescript
export function isMarkdownFile(uri: vscode.Uri): boolean
```

**参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| `uri` | `vscode.Uri` | 要检查的 URI |

**返回值：**
- `boolean` - 如果是 `.md` 文件返回 `true`

**示例：**
```typescript
isMarkdownFile(Uri.file('/path/to/readme.md'));  // true
isMarkdownFile(Uri.file('/path/to/file.ts'));    // false
```

---

### `shouldRecurseFile()`

检查文件是否应该被递归解析引用。

```typescript
export function shouldRecurseFile(uri: vscode.Uri): boolean
```

**参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| `uri` | `vscode.Uri` | 要检查的 URI |

**返回值：**
- `boolean` - 如果是 `.md` 或 `.txt` 文件返回 `true`

**使用场景：**
- 在预处理阶段决定是否对文件内容进行递归引用解析
- Markdown 和纯文本文件可能包含其他文件引用

**示例：**
```typescript
shouldRecurseFile(Uri.file('/path/to/doc.md'));   // true
shouldRecurseFile(Uri.file('/path/to/note.txt')); // true
shouldRecurseFile(Uri.file('/path/to/code.ts'));  // false
```

---

### `executeToolCall()`

执行指定名称的工具调用。

```typescript
export async function executeToolCall(name: string, args: any, allowedUris: string[]): Promise<string>
```

**参数：**
| 参数 | 类型 | 说明 |
|------|------|------|
| `name` | `string` | 工具名称 |
| `args` | `any` | 工具参数 |
| `allowedUris` | `string[]` | Agent 允许访问的 URI 列表 |

**返回值：**
- `Promise<string>` - 工具执行结果

**实现细节：**
- 通过 `ToolManager.getInstance()` 获取工具管理器单例
- 构建 `ToolContext` 上下文对象
- 调用 `tm.executeTool()` 执行工具
- `noApproval` 参数设为 `false`，表示需要用户审批

**使用场景：**
- 封装工具调用执行逻辑
- 统一处理工具上下文和权限控制

**示例：**
```typescript
const result = await executeToolCall(
  'read_file',
  { uri: 'file:///path/to/file.ts' },
  ['/workspace']
);
// 返回文件内容或错误信息
```

---

## 类型导出

该模块依赖以下类型（从 `../types` 导入）：

- `MessageContent` - 消息内容类型
- `ContentPartText` - 文本内容部分
- `ContentPartImage` - 图片内容部分
- `ContextItem` - 上下文项类型

---

## 依赖关系

```
utils.ts
├── vscode (VSCode API)
├── path (Node.js 路径模块)
├── util.TextDecoder (文本解码)
├── ../toolManager (ToolManager 单例)
├── ../tools.d/interface (ToolContext 接口)
└── ../types (核心类型定义)
```
