# serializer.ts

## 功能概述

`serializer.ts` 实现了 Mutsumi Notebook 的**序列化与反序列化功能**。该模块负责将 Agent 上下文数据与 VS Code Notebook 格式之间进行转换，支持持久化存储和恢复 Notebook 状态。

作为 VS Code Notebook API 的核心组件，实现了 `vscode.NotebookSerializer` 接口，管理 Agent 对话历史的保存和加载。

---

## 主要类

### `MutsumiSerializer`

实现 `vscode.NotebookSerializer` 接口，提供 Notebook 数据的序列化和反序列化功能。

#### 方法

##### `deserializeNotebook`

```typescript
async deserializeNotebook(
    content: Uint8Array,
    _token: vscode.CancellationToken
): Promise<vscode.NotebookData>
```

将二进制内容反序列化为 VS Code Notebook 数据结构。

**参数说明：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `content` | `Uint8Array` | 文件内容的二进制数据 |
| `_token` | `vscode.CancellationToken` | 取消令牌（未使用） |

**返回值：**

`vscode.NotebookData` - Notebook 数据结构，包含单元格列表和元数据。

**处理流程：**

1. **解析 JSON**：将二进制数据解码为 AgentContext 对象
2. **错误处理**：如果解析失败，创建默认的 AgentContext
3. **单元格转换**：将 AgentMessage 数组转换为 NotebookCellData 数组
4. **消息分组**：智能分组连续的消息（助手/工具消息）

**单元格映射规则：**

| 消息角色 | 单元格类型 | 单元格种类 | 说明 |
|---------|-----------|-----------|------|
| `user` | `Code` | `markdown` | 用户输入，可执行 |
| `system` | `Markup` | `markdown` | 系统消息，只读显示 |
| `assistant` | `Markup` | `markdown` | AI 响应，包含交互历史 |
| `tool` | 分组到 assistant | - | 工具结果，与助手消息合并 |

---

##### `serializeNotebook`

```typescript
async serializeNotebook(
    data: vscode.NotebookData,
    _token: vscode.CancellationToken
): Promise<Uint8Array>
```

将 VS Code Notebook 数据结构序列化为二进制内容。

**参数说明：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `data` | `vscode.NotebookData` | Notebook 数据结构 |
| `_token` | `vscode.CancellationToken` | 取消令牌（未使用） |

**返回值：**

`Uint8Array` - 序列化后的二进制数据（JSON 格式）。

**处理流程：**

1. **遍历单元格**：按顺序处理每个 Notebook 单元格
2. **角色识别**：从单元格元数据中提取角色信息
3. **交互恢复**：从 `mutsumi_interaction` 元数据恢复完整的对话历史
4. **生成 JSON**：将 `AgentContext` 编码为二进制数据

---

##### `createDefaultContent`

```typescript
static createDefaultContent(allowedUris: string[]): Uint8Array
```

创建默认的 Notebook 内容。

**参数说明：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `allowedUris` | `string[]` | 允许访问的 URI 列表 |

**返回值：**

默认的 AgentContext 二进制数据，包含新生成的 UUID 和空对话历史。

**默认元数据：**

```typescript
{
    uuid: uuidv4(),           // 新生成的唯一标识
    name: 'New Agent',        // 默认名称
    created_at: new Date().toISOString(),  // 创建时间
    parent_agent_id: null,    // 无父代理
    allowed_uris: allowedUris // 指定的允许路径
}
```

---

##### `renderInteractionToMarkdown`

```typescript
private renderInteractionToMarkdown(group: AgentMessage[]): string
```

将消息组渲染为 Markdown 格式的显示文本。

**参数说明：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `group` | `AgentMessage[]` | 消息数组（助手消息和工具消息） |

**返回值：**

Markdown 格式的字符串，用于 Notebook 单元格显示。

**渲染格式：**

| 消息类型 | 渲染格式 |
|---------|---------|
| `reasoning_content` | `<details>` 折叠块，标题为 "💭 Thinking Process" |
| `content` | 普通 Markdown 文本 |
| `tool_calls` | 引用块，显示 "🔧 **Call**: `functionName`" |
| `tool` (result) | `<details>` 折叠块，标题为 "📝 Result: toolName"，内容截断至 200 字符 |

---

## 数据结构

### AgentContext

```typescript
interface AgentContext {
    metadata: AgentMetadata;
    context: AgentMessage[];
}
```

### AgentMetadata

```typescript
interface AgentMetadata {
    uuid: string;           // Agent 唯一标识
    name: string;           // Agent 名称
    created_at: string;     // 创建时间 (ISO 格式)
    parent_agent_id: string | null;  // 父 Agent ID
    allowed_uris: string[]; // 允许访问的路径列表
}
```

### AgentMessage

```typescript
interface AgentMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content?: string;
    reasoning_content?: string;     // 推理内容（思维链）
    tool_calls?: ToolCall[];        // 工具调用
    name?: string;                  // 工具名称
    tool_call_id?: string;          // 工具调用 ID
}
```

---

## 元数据说明

### 单元格元数据 (`cell.metadata`)

| 属性 | 类型 | 说明 |
|------|------|------|
| `role` | `string` | 消息角色：'user' \| 'system' \| 'assistant' |
| `mutsumi_interaction` | `AgentMessage[]` | 完整的交互历史（用于序列化恢复） |

---

## 使用示例

### 创建新 Notebook 文件

```typescript
const content = MutsumiSerializer.createDefaultContent(['/workspace']);
// 写入 .mutsumi-notebook 文件
```

### Notebook 文件内容格式

```json
{
  "metadata": {
    "uuid": "550e8400-e29b-41d4-a716-446655440000",
    "name": "My Agent",
    "created_at": "2024-01-15T10:30:00.000Z",
    "parent_agent_id": null,
    "allowed_uris": ["/workspace/project"]
  },
  "context": [
    { "role": "user", "content": "Hello" },
    { 
      "role": "assistant", 
      "content": "Hi there!",
      "reasoning_content": "User greeted me..."
    }
  ]
}
```

---

## 依赖关系

### 导入模块

```typescript
import * as vscode from 'vscode';
import { TextDecoder, TextEncoder } from 'util';
import { AgentContext, AgentMessage, AgentMetadata } from '../types';
import { v4 as uuidv4 } from 'uuid';
```

### 类型定义来源

- `AgentContext`, `AgentMessage`, `AgentMetadata` 来自 `../types`
- `uuidv4` 用于生成唯一标识符

### 在系统中的作用

- 被 `extension.ts` 注册为 Notebook 序列化器
- 与 Notebook Controller 配合，实现完整的 Notebook 功能
- 支持文件持久化和状态恢复

---

## 文件格式

### 扩展名

`.mutsumi-notebook`

### MIME 类型

`application/json`（内部为 JSON 格式）

### 编码

UTF-8
