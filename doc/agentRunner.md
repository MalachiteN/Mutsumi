# agentRunner.ts 技术文档

## 文件功能概述

`agentRunner.ts` 是 Mutsumi VSCode 插件的** Agent 执行引擎**，负责运行 Agent 的主循环，包括：
- 与 LLM API（OpenAI）的流式通信
- 工具调用的解析和执行
- UI 的实时渲染和更新
- 对话历史的管理

它是 Agent 实际"思考"和"行动"的核心实现。

---

## 主要接口

### `AgentRunOptions`

Agent 运行配置选项。

```typescript
export interface AgentRunOptions {
    model: string;           // LLM 模型名称，如 'gpt-4'
    apiKey: string;          // API 密钥
    baseUrl: string | undefined;  // 自定义 API 端点（可选）
    maxLoops?: number;       // 最大循环次数（默认 5）
}
```

---

## 主要类：AgentRunner

### 构造函数

```typescript
constructor(
    options: AgentRunOptions,
    tools: ToolManager,
    notebook: vscode.NotebookDocument,
    allowedUris: string[],
    isSubAgent: boolean
)
```

**参数**：
| 参数名 | 类型 | 说明 |
|--------|------|------|
| `options` | `AgentRunOptions` | 运行配置 |
| `tools` | `ToolManager` | 工具管理器实例 |
| `notebook` | `vscode.NotebookDocument` | 当前 Notebook 文档 |
| `allowedUris` | `string[]` | Agent 允许访问的 URI 列表 |
| `isSubAgent` | `boolean` | 是否为子 Agent |

---

### 类属性

| 属性名 | 类型 | 说明 |
|--------|------|------|
| `committedUiHtml` | `string` | 已提交的 UI HTML 内容（累积） |
| `openai` | `OpenAI` | OpenAI API 客户端 |
| `maxLoops` | `number` | 最大循环次数 |

---

### 核心方法

#### `run(execution, abortController, initialMessages): Promise<AgentMessage[]>`

**功能**：执行 Agent 的主循环。

**参数**：
| 参数名 | 类型 | 说明 |
|--------|------|------|
| `execution` | `vscode.NotebookCellExecution` | Notebook 单元格执行对象 |
| `abortController` | `AbortController` | 用于取消执行的控制器 |
| `initialMessages` | `AgentMessage[]` | 初始消息历史 |

**返回值**：`Promise<AgentMessage[]>` - 新产生的消息历史

**工作流程**：
1. 循环调用 LLM（最多 `maxLoops` 次）
2. 流式处理响应，实时更新 UI
3. 如果无工具调用，则结束循环
4. 解析并执行工具调用
5. 如果调用 `task_finish`，标记完成并退出
6. 将工具结果添加到消息历史
7. 保存交互元数据

---

#### `streamResponse(execution, messages, signal): Promise<object>`

**功能**：调用 LLM 并流式处理响应。

**参数**：
- `execution` - Notebook 单元格执行对象
- `messages` - 当前消息历史
- `signal` - 中止信号

**返回值**：包含 `roundContent`, `roundReasoning`, `toolCalls` 的对象

**处理逻辑**：
- 流式接收 `content`（内容）和 `reasoning_content`（推理过程）
- 实时更新 UI 显示
- 缓冲 `tool_calls` 数据

---

#### `parseToolCalls(rawToolCalls, currentContent, currentReasoning): any[]`

**功能**：解析原始工具调用数据。

**特殊处理**：
- 尝试标准 JSON 解析
- 如果失败，尝试修复多个 JSON 对象的情况（`}{` → `},{`）
- 为每个工具调用生成唯一 ID

**参数**：
- `rawToolCalls` - 原始工具调用数据
- `currentContent` - 当前内容
- `currentReasoning` - 当前推理内容

**返回值**：解析后的工具调用数组

---

#### `executeTools(execution, toolCalls, abortSignal): Promise<AgentMessage[]>`

**功能**：执行工具调用。

**参数**：
- `execution` - Notebook 单元格执行对象
- `toolCalls` - 工具调用数组
- `abortSignal` - 中止信号

**返回值**：工具结果消息数组

**处理流程**：
1. 遍历每个工具调用
2. 构建 `ToolContext`
3. 调用 `ToolManager.executeTool`
4. 捕获并处理 `TerminationError`
5. 在 UI 中显示工具调用详情（折叠面板）
6. 返回工具结果消息

---

#### `markNotebookAsFinished(): Promise<void>`

**功能**：将 Notebook 标记为已完成（设置 `is_task_finished` 元数据）。

---

### UI 渲染方法

#### `commitRoundUI(content, reasoning): void`

将当前轮的 UI 内容提交为固定 HTML。

#### `renderUI(execution, currentContent, currentReasoning): Promise<void>`

实时渲染当前轮的 UI（包含进行中内容的预览）。

#### `updateOutput(execution): Promise<void>`

更新 Notebook 单元格输出。

#### `appendErrorUI(execution, message): Promise<void>`

向 UI 追加错误信息。

---

## 与其他模块的关系

```
AgentRunner
    ├── 被 controller.ts 创建和调用（run 方法）
    ├── 使用 ToolManager 执行工具
    ├── 调用 AgentOrchestrator.reportTaskFinished 报告完成
    ├── 操作 vscode.NotebookCellExecution 更新 UI
    └── 处理 OpenAI API 流式响应
```

---

## 使用示例

### 在 Controller 中创建和运行

```typescript
const runner = new AgentRunner(
    { apiKey, baseUrl, model },
    this.tools,
    notebook,
    allowedUris,
    isSubAgent
);

const newMessages = await runner.run(execution, abortController, messages);
```

### 流式响应处理流程

```typescript
// 1. 发起流式请求
const stream = await this.openai.chat.completions.create({
    model: this.options.model,
    messages: messages,
    tools: this.tools.getToolsDefinitions(isSubAgent),
    stream: true
});

// 2. 逐块处理
for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;
    // 处理 content、reasoning、tool_calls
    await this.renderUI(execution, currentContent, currentReasoning);
}
```

---

## 错误处理

- **取消执行**：检查 `execution.token.isCancellationRequested` 和 `AbortSignal`
- **API 错误**：捕获并显示在 UI 中
- **工具执行错误**：捕获并作为工具结果返回
- **TerminationError**：立即终止 Agent 循环
