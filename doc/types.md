# types.ts

## 概述

Mutsumi VSCode 插件的核心类型定义文件。定义了 agent 会话元数据、消息格式、工具接口和运行时状态等类型。

## 接口

### `AgentMetadata`

Agent 会话的元数据，存储在 notebook metadata 中。

**属性：**

| 属性 | 类型 | 说明 |
|------|------|------|
| `uuid` | `string` | Agent 的唯一标识符 |
| `name` | `string` | Agent 的显示名称 |
| `created_at` | `string` | ISO 时间戳，记录创建时间 |
| `parent_agent_id` | `string \| null` | 父 agent ID（如果是子 agent），否则为 null |
| `allowed_uris` | `string[]` | Agent 允许访问的 URI 列表 |
| `is_task_finished?` | `boolean` | 任务是否已完成（可选） |
| `model?` | `string` | 此 agent 使用的模型标识符（可选） |
| `contextItems?` | `ContextItem[]` | 持久化的上下文项（文件、规则）（可选） |
| `macroContext?` | `Record<string, string>` | 持久化的宏定义（宏名称到宏值的映射）（可选） |
| `sub_agents_list?` | `string[]` | 此 Agent 创建的子 Agent UUID 列表（可选） |

#### `macroContext` 字段说明

- **macroContext** (可选): `Record<string, string>`
  - 持久化的宏定义（宏名称到宏值的映射）
  - 存储在 notebook 的 metadata 中
  - 跨会话保持用户定义的宏
  - 用于在 rules 和引用文件中实现条件编译

#### 使用场景

1. 用户在 prompt 中定义宏：`@{define USE_TYPESCRIPT, "true"}`
2. 宏被提取并应用到 rules 和引用文件
3. 宏被保存到 `metadata.macroContext`
4. 下次会话时从 metadata 恢复宏定义

#### 示例 Notebook Metadata

```json
{
  "metadata": {
    "uuid": "...",
    "name": "Agent Name",
    "macroContext": {
      "USE_TYPESCRIPT": "true",
      "API_VERSION": "v2"
    },
    "contextItems": [...]
  },
  "context": [...]
}
```

---

### `ContentPartText`

多模态消息的文本内容部分。

```typescript
type ContentPartText = { type: 'text'; text: string };
```

---

### `ContentPartImage`

多模态消息的图像内容部分。

```typescript
type ContentPartImage = { 
  type: 'image_url'; 
  image_url: { 
    url: string; 
    detail?: 'auto' | 'low' | 'high' 
  } 
};
```

---

### `MessageContent`

消息内容类型，可以是纯字符串或多模态部分数组。

```typescript
type MessageContent = string | (ContentPartText | ContentPartImage)[];
```

---

### `AgentMessage`

Agent 对话中的消息。

**属性：**

| 属性 | 类型 | 说明 |
|------|------|------|
| `role` | `'user' \| 'assistant' \| 'system' \| 'tool'` | 消息发送者角色 |
| `content` | `MessageContent \| null` | 消息内容，如果只有工具调用则为 null |
| `tool_calls?` | `any[]` | Assistant 请求的工具调用 |
| `tool_call_id?` | `string` | 此消息响应的工具调用 ID |
| `name?` | `string` | 被调用工具的名称 |
| `reasoning_content?` | `string` | 模型的推理/思考内容 |

---

### `AgentContext`

完整的 agent 上下文，包括元数据和对话历史。

**属性：**

| 属性 | 类型 | 说明 |
|------|------|------|
| `metadata` | `AgentMetadata` | Agent 元数据 |
| `context` | `AgentMessage[]` | 对话消息历史 |

---

### `ToolRequest`

Agent 发出的工具请求。

**属性：**

| 属性 | 类型 | 说明 |
|------|------|------|
| `name` | `string` | 要执行的工具名称 |
| `arguments` | `any` | 工具的参数 |

---

### `ToolResult`

工具执行的结果。

**属性：**

| 属性 | 类型 | 说明 |
|------|------|------|
| `content` | `string` | 结果内容（字符串形式） |
| `isError?` | `boolean` | 工具执行是否出错（可选） |

---

### `AgentRuntimeStatus`

Agent 的运行时状态。

```typescript
type AgentRuntimeStatus = 'standby' | 'running' | 'pending' | 'finished';
```

**状态说明：**

| 状态 | 说明 |
|------|------|
| `standby` | 主 agent，未运行 |
| `running` | 正在执行中 |
| `pending` | 子 agent，等待运行 |
| `finished` | 任务已完成 |

---

### `AgentStateInfo`

Agent 的运行时状态信息。

**属性：**

| 属性 | 类型 | 说明 |
|------|------|------|
| `uuid` | `string` | Agent 的唯一标识符 |
| `parentId` | `string \| null` | 父 agent ID（如果是子 agent） |
| `name` | `string` | Agent 的显示名称 |
| `fileUri` | `string` | Agent 存储的文件 URI 字符串 |
| `isWindowOpen` | `boolean` | notebook 窗口是否当前打开 |
| `isRunning` | `boolean` | agent 是否正在运行 |
| `isTaskFinished` | `boolean` | agent 任务是否已完成 |
| `prompt?` | `string` | 缓存的提示文本（可选） |
| `childIds?` | `Set<string>` | 子 Agent UUID 集合，用于构建树结构（可选） |

### `ContextItem`

持久化的上下文项，用于存储文件、工具结果或规则等内容。

```typescript
interface ContextItem {
    type: 'file' | 'tool' | 'rule';
    key: string;
    content: string;
    metadata?: any;
}
```

**属性：**

| 属性 | 类型 | 说明 |
|------|------|------|
| `type` | `'file' \| 'tool' \| 'rule'` | 上下文项的类型 |
| `key` | `string` | 上下文项的唯一标识键 |
| `content` | `string` | 上下文项的内容 |
| `metadata?` | `any` | 额外的元数据信息（可选） |

**类型说明：**

| 类型值 | 说明 |
|--------|------|
| `file` | 文件内容，key 通常为文件路径 |
| `tool` | 工具执行结果，key 为工具调用标识 |
| `rule` | 规则文档内容，key 为规则名称或路径 |

---

## 类型关系

```
AgentContext
├── metadata: AgentMetadata
│   └── contextItems?: ContextItem[]
└── context: AgentMessage[]
    ├── role
    ├── content: MessageContent (string | ContentPart[])
    │   └── ContentPart: ContentPartText | ContentPartImage
    ├── tool_calls?
    ├── tool_call_id?
    ├── name?
    └── reasoning_content?

ToolRequest → ToolResult

AgentStateInfo (运行时状态)
```
