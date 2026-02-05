# types.ts 技术文档

## 文件功能概述

`types.ts` 是 Mutsumi VSCode 插件的**类型定义文件**，集中声明了项目中使用的核心 TypeScript 接口和类型。它是整个项目的类型基础，确保各模块之间的类型一致性。

---

## 接口定义

### `AgentMetadata`

Agent 的元数据接口，存储在 Notebook 文件的 metadata 中。

```typescript
export interface AgentMetadata {
    uuid: string;                    // Agent 唯一标识符
    name: string;                    // Agent 显示名称
    created_at: string;              // 创建时间（ISO 格式）
    parent_agent_id: string | null;  // 父 Agent UUID（主 Agent 为 null）
    allowed_uris: string[];          // Agent 允许访问的 URI 列表
    is_task_finished?: boolean;      // 任务是否已完成（可选）
}
```

**用途**：
- 保存到 Notebook 文件元数据
- 用于识别 Agent 身份和权限范围
- 跟踪 Agent 层级关系

---

### `AgentMessage`

Agent 消息接口，用于构建对话历史。

```typescript
export interface AgentMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';  // 消息角色
    content: MessageContent | null;                  // 消息内容（文本或多模态）
    tool_calls?: any[];                              // 工具调用（Assistant 消息）
    tool_call_id?: string;                           // 工具调用 ID（Tool 消息）
    name?: string;                                   // 工具名称（Tool 消息）
    reasoning_content?: string;                      // 推理内容（如 DeepSeek R1）
}
```

**角色说明**：
| 角色 | 说明 |
|------|------|
| `user` | 用户输入的消息 |
| `assistant` | AI 助手的回复 |
| `system` | 系统提示词 |
| `tool` | 工具执行结果 |

**content 字段说明**：
- 可以是简单的字符串（纯文本消息）
- 也可以是 `MessageContent` 数组（多模态消息，包含文本和图片）
- 为 `null` 表示空内容

**用途**：
- 构建发送到 LLM 的消息历史
- 保存单元格交互记录
- 支持工具调用链
- 支持多模态内容（文本+图片）

---

### `AgentContext`

Agent 上下文接口，代表一个 Agent 的完整状态。

```typescript
export interface AgentContext {
    metadata: AgentMetadata;         // Agent 元数据
    context: AgentMessage[];         // 对话历史
}
```

**用途**：
- 序列化/反序列化 Notebook 内容
- 在内存中维护 Agent 状态

---

### `ToolRequest`

工具请求接口。

```typescript
export interface ToolRequest {
    name: string;      // 工具名称
    arguments: any;    // 工具参数
}
```

**用途**：
- 解析 LLM 的工具调用请求
- 内部工具调用传递

---

### `ToolResult`

工具结果接口。

```typescript
export interface ToolResult {
    content: string;      // 结果内容
    isError?: boolean;    // 是否为错误结果
}
```

**用途**：
- 封装工具执行结果
- 错误状态标记

---

## 类型定义

### `AgentRuntimeStatus`

Agent 运行时状态类型。

```typescript
export type AgentRuntimeStatus = 'standby' | 'running' | 'pending' | 'finished';
```

**状态说明**：
| 状态 | 说明 |
|------|------|
| `standby` | 待机状态（主 Agent，未运行） |
| `running` | 正在运行 |
| `pending` | 待定状态（子 Agent，未运行未完成） |
| `finished` | 任务已完成 |

---

### `ContentPartText`

文本内容部分类型，用于多模态消息中的文本段。

```typescript
export type ContentPartText = { 
    type: 'text'; 
    text: string 
};
```

**字段说明**：
| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | `'text'` | 固定为 `'text'`，标识这是文本内容 |
| `text` | `string` | 实际的文本内容 |

**用途**：
- 在多模态消息中表示文本段落
- 与 `ContentPartImage` 组合构建富媒体消息

---

### `ContentPartImage`

图片内容部分类型，用于多模态消息中的图片。

```typescript
export type ContentPartImage = { 
    type: 'image_url'; 
    image_url: { 
        url: string; 
        detail?: 'auto' | 'low' | 'high' 
    } 
};
```

**字段说明**：
| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | `'image_url'` | 固定为 `'image_url'`，标识这是图片内容 |
| `image_url.url` | `string` | 图片的 URL 或 Base64 数据 URI |
| `image_url.detail` | `'auto' \| 'low' \| 'high'` | 可选，图片质量/细节级别（默认 `'auto'`） |

**detail 级别说明**：
| 级别 | 说明 |
|------|------|
| `'auto'` | 自动选择合适的细节级别（默认） |
| `'low'` | 低分辨率，适合图标、表情等简单图片 |
| `'high'` | 高分辨率，适合需要精细分析的图片 |

**用途**：
- 在多模态消息中嵌入图片
- 支持通过 URL 或 Base64 编码传递图片数据
- 控制 LLM 对图片的处理细节级别

---

### `MessageContent`

消息内容类型，支持纯文本或多模态内容数组。

```typescript
export type MessageContent = string | (ContentPartText | ContentPartImage)[];
```

**类型说明**：
- `string`：纯文本消息内容
- `(ContentPartText | ContentPartImage)[]`：多模态内容数组，可混合文本和图片

**用途**：
- 作为 `AgentMessage.content` 的类型
- 支持向后兼容的简单字符串消息
- 支持多模态消息（文本+图片组合）

**示例**：
```typescript
// 纯文本消息
const textContent: MessageContent = "请分析这张图片";

// 多模态消息（文本+图片）
const multimodalContent: MessageContent = [
    { type: 'text', text: '请描述这张图片的内容：' },
    { 
        type: 'image_url', 
        image_url: { 
            url: 'data:image/png;base64,iVBORw0KGgo...',
            detail: 'high'
        } 
    }
];
```

---

## 接口定义（续）

### `AgentStateInfo`

Agent 状态信息接口，用于运行时的状态管理。

```typescript
export interface AgentStateInfo {
    uuid: string;                    // Agent UUID
    parentId: string | null;         // 父 Agent UUID
    name: string;                    // Agent 名称
    fileUri: string;                 // 文件 URI（字符串格式）
    
    // 状态标志位
    isWindowOpen: boolean;           // 窗口是否打开
    isRunning: boolean;              // 是否正在运行
    isTaskFinished: boolean;         // 任务是否完成
    
    // 缓存元数据
    prompt?: string;                 // 任务提示（可选）
}
```

**用途**：
- 在 `AgentOrchestrator` 的注册表中存储
- 用于侧边栏 TreeView 展示
- 跟踪 Agent 的实时状态

---

## 类型关系图

```
┌────────────────────────────────────────────────────────────┐
│                      AgentContext                           │
│  ┌─────────────────────┐    ┌───────────────────────────┐  │
│  │   AgentMetadata     │    │    AgentMessage[]         │  │
│  │  ├─ uuid            │    │                           │  │
│  │  ├─ name            │    │  ├─ role                  │  │
│  │  ├─ created_at      │    │  ├─ content               │  │
│  │  ├─ parent_agent_id │    │  │   (MessageContent)     │  │
│  │  ├─ allowed_uris    │    │  ├─ tool_calls?           │  │
│  │  └─ is_task_finished│    │  ├─ tool_call_id?         │  │
│  │                     │    │  ├─ name?                 │  │
│  └─────────────────────┘    │  └─ reasoning_content?    │  │
│                             └───────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────┐
│                    MessageContent                           │
│              (string | ContentPart[])                       │
└────────────────────────────────────────────────────────────┘
                            │
            ┌───────────────┴───────────────┐
            ▼                               ▼
┌─────────────────────────┐    ┌────────────────────────────┐
│    ContentPartText      │    │     ContentPartImage       │
│  ├─ type: 'text'        │    │  ├─ type: 'image_url'      │
│  └─ text: string        │    │  └─ image_url: {           │
│                         │    │       url: string          │
│                         │    │       detail?: 'auto'      │
│                         │    │              | 'low'       │
│                         │    │              | 'high'      │
│                         │    │     }                      │
└─────────────────────────┘    └────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────┐
│                    AgentStateInfo                           │
│  ├─ uuid                                                    │
│  ├─ parentId                                                │
│  ├─ name                                                    │
│  ├─ fileUri                                                 │
│  ├─ isWindowOpen                                            │
│  ├─ isRunning                                               │
│  ├─ isTaskFinished                                          │
│  └─ prompt?                                                 │
└────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────┐
│                AgentRuntimeStatus                           │
│              (standby | running | pending | finished)       │
└────────────────────────────────────────────────────────────┘
```

---

## 使用示例

### 创建 Agent 上下文

```typescript
const agentContext: AgentContext = {
    metadata: {
        uuid: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Code Analyzer',
        created_at: '2024-01-15T10:30:00Z',
        parent_agent_id: null,
        allowed_uris: ['/workspace/src'],
        is_task_finished: false
    },
    context: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Analyze this code.' }
    ]
};
```

### 构建消息历史

```typescript
const messages: AgentMessage[] = [
    { role: 'system', content: 'System prompt...' },
    { role: 'user', content: 'User question...' },
    { 
        role: 'assistant', 
        content: 'Let me check...',
        tool_calls: [{ id: 'call_1', function: { name: 'read_file', arguments: '{}' } }]
    },
    { 
        role: 'tool', 
        tool_call_id: 'call_1',
        name: 'read_file',
        content: 'File content...'
    }
];
```

### 多模态消息示例

```typescript
// 发送包含图片的消息
const multimodalMessage: AgentMessage = {
    role: 'user',
    content: [
        { type: 'text', text: '请分析这张截图中的错误信息：' },
        { 
            type: 'image_url', 
            image_url: { 
                url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...',
                detail: 'high'
            } 
        },
        { type: 'text', text: '这是我在运行测试时遇到的错误。' }
    ]
};

// 简单的文本消息（向后兼容）
const textMessage: AgentMessage = {
    role: 'user',
    content: '请帮我分析这段代码的问题。'
};
```

### 状态管理

```typescript
const agentState: AgentStateInfo = {
    uuid: '550e8400-e29b-41d4-a716-446655440000',
    parentId: null,
    name: 'Code Analyzer',
    fileUri: 'file:///workspace/.mutsumi/agent-xxx.mtm',
    isWindowOpen: true,
    isRunning: true,
    isTaskFinished: false
};

// 计算状态
const status: AgentRuntimeStatus = agent.isRunning ? 'running' 
    : agent.isTaskFinished ? 'finished'
    : agent.parentId ? 'pending'
    : 'standby';
```

---

## 与其他模块的关系

| 模块 | 使用类型 |
|------|----------|
| `agentOrchestrator.ts` | `AgentStateInfo`, `AgentRuntimeStatus` |
| `agentRunner.ts` | `AgentMessage`, `MessageContent` |
| `controller.ts` | `AgentMessage`, `ContentPartText`, `ContentPartImage` |
| `extension.ts` | `AgentMetadata`（间接） |
| `toolManager.ts` | 工具相关类型（来自 tools.d/interface） |
| `notebook/serializer.ts` | `AgentContext`, `AgentMetadata` |
| `sidebar/*.ts` | `AgentStateInfo`, `AgentRuntimeStatus` |

---

## 扩展说明

这些类型是项目的核心契约：

1. **AgentMetadata** - 持久化存储在 Notebook 文件中
2. **AgentMessage** - 符合 OpenAI API 的消息格式，支持多模态内容
3. **AgentStateInfo** - 运行时内存中的状态表示
4. **AgentRuntimeStatus** - UI 展示和逻辑判断的状态枚举
5. **ContentPartText/ContentPartImage/MessageContent** - 多模态消息内容类型

添加新类型时应考虑：
- 与 OpenAI API 的兼容性
- 序列化/反序列化的需求
- 向后兼容性
- 多模态内容的处理（图片大小、格式限制）
