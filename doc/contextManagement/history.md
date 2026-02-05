# history.ts - 对话历史上下文构建模块

## 功能概述

`history.ts` 负责构建 Agent 的对话历史上下文。它将系统提示、历史对话记录、上下文引用和当前用户输入组合成一个完整的 `AgentMessage` 数组，供 LLM 调用使用。

## 导入依赖

| 模块 | 说明 |
|------|------|
| `vscode` | VSCode API，用于访问 Notebook 文档 |
| `../types` | 类型定义，包含 `AgentMessage` 和 `AgentMetadata` |
| `./prompts` | 系统提示模块，提供 `getSystemPrompt` 函数 |
| `../notebook/contextResolver` | 上下文解析器，处理 `@` 引用 |

## 主要函数

### buildInteractionHistory

构建完整的交互历史上下文。

#### 函数签名

```typescript
export async function buildInteractionHistory(
    notebook: vscode.NotebookDocument,
    currentCellIndex: number,
    currentPrompt: string
): Promise<{ messages: AgentMessage[], allowedUris: string[], isSubAgent: boolean }>
```

#### 参数说明

| 参数 | 类型 | 说明 |
|------|------|------|
| `notebook` | `vscode.NotebookDocument` | 当前的 Notebook 文档对象 |
| `currentCellIndex` | `number` | 当前 Cell 的索引位置 |
| `currentPrompt` | `string` | 用户当前输入的提示内容 |

#### 返回值

| 字段 | 类型 | 说明 |
|------|------|------|
| `messages` | `AgentMessage[]` | 构建完成的对话消息数组 |
| `allowedUris` | `string[]` | 允许的 URI 路径列表 |
| `isSubAgent` | `boolean` | 是否为子 Agent |

#### 功能流程

1. **获取系统提示 (System Prompt)**
   - 从 Notebook 元数据中提取 `allowed_uris` 和 `parent_agent_id`
   - 判断是否为子 Agent (`isSubAgent`)
   - 调用 `getSystemPrompt()` 动态生成系统提示
   - 将系统提示作为第一条 `role: 'system'` 消息

2. **加载历史对话**
   - 遍历当前 Cell 之前的所有 Cell
   - 提取每个 Cell 的 `role` 元数据（默认为 `'user'`）
   - 读取 Cell 内容并添加到消息数组
   - 处理 `mutsumi_interaction` 元数据中的交互记录

3. **处理上下文引用**
   - 解析当前 Prompt 中的 `@` 引用（如 `@[path:...]`）
   - 调用 `ContextResolver.resolveReferencesInText()` 读取引用内容
   - 将引用内容作为附加 User 消息注入

4. **添加当前用户输入**
   - 调用 `parseUserMessageWithImages()` 处理用户消息中的图片标记
   - 将图片转换为多模态内容格式
   - 保留原始 `@` 标记，方便 LLM 理解用户指代
   - 作为最后一条 User 消息添加

### parseUserMessageWithImages

解析用户消息中的 Markdown 图片标记，将其转换为多模态内容格式。

#### 函数签名

```typescript
function parseUserMessageWithImages(text: string): { type: 'text', text: string } | { type: 'image_url', image_url: { url: string, detail: string } }[]
```

#### 功能说明

- **图片正则表达式**：`/!\[([^\]]*)\]\(([^)]+)\)/g`
  - 匹配 Markdown 图片语法 `![alt](uri)`
  - 捕获图片描述 (`alt`) 和图片路径 (`uri`)

- **处理流程**：
  1. 扫描用户消息文本，查找所有 Markdown 图片标记
  2. 对每个匹配的图片路径，调用 `readImageAsBase64()` 读取图片内容
  3. 将图片转换为 OpenAI API 兼容的多模态格式
  4. 如果没有图片标记，返回原始文本对象

#### 输出格式

当检测到图片时，返回多模态内容数组：

```typescript
// 文本部分
{ type: 'text', text: '用户消息内容（已移除图片标记）' }

// 图片部分（每个图片一个对象）
{
  type: 'image_url',
  image_url: {
    url: 'data:image/png;base64,iVBORw0KGgo...',
    detail: 'auto'
  }
}
```

### readImageAsBase64

将图片文件读取为 Base64 编码的数据 URL 格式。

#### 函数签名

```typescript
async function readImageAsBase64(uriStr: string): Promise<string>
```

#### 参数说明

| 参数 | 类型 | 说明 |
|------|------|------|
| `uriStr` | `string` | 图片文件的 URI 路径字符串 |

#### 返回值

返回 Base64 数据 URL，格式为：`data:image/{format};base64,{base64Data}`

#### 支持格式

| 格式 | MIME Type |
|------|-----------|
| PNG | `image/png` |
| JPEG/JPG | `image/jpeg` |
| GIF | `image/gif` |
| WebP | `image/webp` |

## 数据结构

### AgentMessage

```typescript
interface AgentMessage {
    role: 'system' | 'user' | 'assistant';
    content: string | (ContentPartText | ContentPartImage)[];
}

interface ContentPartText {
    type: 'text';
    text: string;
}

interface ContentPartImage {
    type: 'image_url';
    image_url: {
        url: string;
        detail: 'auto' | 'low' | 'high';
    };
}
```

### AgentMetadata

```typescript
interface AgentMetadata {
    allowed_uris?: string[];
    parent_agent_id?: string;
    role?: string;
    mutsumi_interaction?: AgentMessage[];
}
```

## 使用示例

### 基本用法

```typescript
import { buildInteractionHistory } from './contextManagement/history';

// 在 Notebook Controller 中使用
const { messages, allowedUris, isSubAgent } = await buildInteractionHistory(
    notebook,
    currentCell.index,
    userPrompt
);

// 将 messages 传递给 LLM API
const response = await llmAPI.chat(messages);
```

### 多模态消息示例

```typescript
// 用户输入包含图片
const userPrompt = '请分析这张图：![图表](file:///workspace/chart.png)';

// buildInteractionHistory 会自动处理图片
// 生成的消息格式：
{
  role: 'user',
  content: [
    { type: 'text', text: '请分析这张图：' },
    {
      type: 'image_url',
      image_url: {
        url: 'data:image/png;base64,iVBORw0KGgo...',
        detail: 'auto'
      }
    }
  ]
}
```

## 与其他模块的关系

```
history.ts
    ├── 调用 → prompts.ts (getSystemPrompt)
    │         获取动态生成的系统提示
    ├── 调用 → notebook/contextResolver.ts (ContextResolver)
    │         解析 @ 引用路径
    ├── 调用 → vscode.workspace.fs.readFile()
    │         读取图片文件内容
    └── 读取 ← NotebookDocument.metadata
              获取 allowed_uris, parent_agent_id 等元数据
```

## 注意事项

1. **异步函数**：`buildInteractionHistory` 是异步函数，需要 `await` 调用
2. **上下文注入**：`@` 引用解析的内容会作为独立消息注入，而非替换原文
3. **历史顺序**：严格按照 Cell 索引顺序构建历史，确保对话逻辑正确
4. **元数据依赖**：依赖 Notebook Cell 的元数据来识别角色和交互记录
5. **多模态支持**：图片必须使用 Markdown 语法 `![alt](uri)` 标记才能被解析
6. **图片大小限制**：Base64 编码后可能增加消息体积，建议适当压缩图片
