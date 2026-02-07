# history.ts

## 功能概述

本文件负责构建 Agent 的对话历史上下文，包括：
- 获取系统提示词并处理用户提示中的上下文引用
- 从 Notebook 历史单元格加载对话记录
- 解析用户消息中的图片引用，转换为多模态内容格式

## 导出的函数

### buildInteractionHistory

构建 Agent 的交互历史，返回完整的消息列表供 LLM 使用。

```typescript
export async function buildInteractionHistory(
    notebook: vscode.NotebookDocument,
    currentCellIndex: number,
    currentPrompt: string
): Promise<{ 
    messages: AgentMessage[], 
    allowedUris: string[], 
    isSubAgent: boolean 
}>
```

**参数:**
- `notebook` - Notebook 文档对象
- `currentCellIndex` - 当前单元格索引
- `currentPrompt` - 当前用户输入的提示文本

**返回值:**
包含三个字段的对象：
- `messages` - 消息列表（第一条是系统提示，最后一条是当前用户输入）
- `allowedUris` - 允许访问的URI列表（来自 Notebook 元数据）
- `isSubAgent` - 是否为子Agent标识

**消息构建流程:**
1. 获取系统提示词（动态构建）
2. 解析当前提示中的 `@[path]` 引用并追加到系统提示
3. 遍历历史单元格，加载对话记录
4. 解析当前用户提示中的图片，转换为多模态格式
5. 添加当前用户提示到消息列表

**示例:**
```typescript
const { messages, allowedUris, isSubAgent } = await buildInteractionHistory(
    notebook, 
    5, 
    'Hello'
);
// messages[0] 是系统提示
// messages[messages.length-1] 是当前用户输入
```

## 内部函数

### parseUserMessageWithImages

解析用户消息中的图片引用，转换为多模态内容格式。

```typescript
async function parseUserMessageWithImages(text: string): Promise<MessageContent>
```

**参数:**
- `text` - 用户输入文本

**返回值:**
- 如果包含图片，返回内容对象数组
- 否则返回原始文本字符串

**支持的图片格式:**
Markdown 图片语法 `![alt](uri)`

**输出格式示例:**
```typescript
[
  { type: 'text', text: 'Hello ' },
  { type: 'image_url', image_url: { url: 'data:image/png;base64,...', detail: 'auto' } },
  { type: 'text', text: ' world' }
]
```

### readImageAsBase64

读取图片文件并转换为 Base64 编码的数据URL。

```typescript
async function readImageAsBase64(uriStr: string): Promise<string | null>
```

**参数:**
- `uriStr` - 图片URI字符串

**返回值:**
- Base64 编码的图片数据URL，格式为 `data:image/png;base64,...`
- 读取失败时返回 null

**支持的协议:**
- `file://` - 本地文件
- `http://` / `https://` - 网络图片（直接返回URL）

**自动识别的MIME类型:**
- `.png` → `image/png`
- `.jpg/.jpeg` → `image/jpeg`
- `.webp` → `image/webp`
- `.gif` → `image/gif`
