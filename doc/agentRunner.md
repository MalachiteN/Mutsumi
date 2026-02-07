# agentRunner.ts

## 概述

`agentRunner.ts` 实现 Agent 运行器，用于执行与 LLM 的交互和工具调用。它管理对话流程，处理流式响应、工具调用和 UI 更新，实现了核心的 Agent 执行逻辑。

## 接口

### AgentRunOptions

配置 Agent 运行器的选项。

| 属性 | 类型 | 说明 |
|------|------|------|
| `model` | `string` | 用于 LLM 调用的模型标识符 |
| `apiKey` | `string` | OpenAI API 密钥 |
| `baseUrl` | `string \| undefined` | OpenAI 兼容 API 的基础 URL |
| `maxLoops` | `number` | 工具交互循环的最大次数（可选） |

## 类

### AgentRunner

执行与 LLM 交互的主 Agent 循环的类。

#### 构造函数

```typescript
constructor(
    private options: AgentRunOptions,
    private tools: ToolManager,
    private notebook: vscode.NotebookDocument,
    private allowedUris: string[],
    private isSubAgent: boolean
)
```

**参数**:
- `options` - 配置选项
- `tools` - 用于执行工具的工具管理器
- `notebook` - Notebook 文档
- `allowedUris` - Agent 允许的 URI 列表
- `isSubAgent` - 是否为子 Agent

**说明**: 创建 OpenAI 客户端实例，设置 `maxLoops` 默认值为 30。

#### 公共方法

##### run()

执行主 Agent 循环。

```typescript
async run(
    execution: vscode.NotebookCellExecution,
    abortController: AbortController,
    initialMessages: AgentMessage[]
): Promise<AgentMessage[]>
```

**参数**:
- `execution` - 单元格执行上下文
- `abortController` - 用于取消的控制器
- `initialMessages` - 初始消息历史

**返回值**: `Promise<AgentMessage[]>` - 本次运行生成的新消息

**抛出**: 如果调用 task_finish 工具，抛出 `TerminationError`

**说明**:
- 运行与 LLM 的对话循环
- 处理流式响应、工具调用和终止条件
- 最多执行 `maxLoops` 次工具交互循环
- 如果配置，会在第一个单元格生成标题

**执行流程**:
1. 循环调用 `streamResponse()` 获取响应
2. 如果没有工具调用，直接返回内容
3. 如果有工具调用，执行工具并获取结果
4. 将工具结果添加到消息历史
5. 如果调用 `task_finish`，标记 Notebook 为完成状态
6. 循环直到达到 `maxLoops` 或任务完成

#### 私有方法

##### isFirstCell()

检查当前单元格是否是 Notebook 中的第一个单元格。

```typescript
private isFirstCell(execution: vscode.NotebookCellExecution): boolean
```

**返回值**: `boolean` - 如果是第一个单元格返回 true

##### generateTitleIfNeeded()

如果需要，为 Notebook 生成标题。

```typescript
private async generateTitleIfNeeded(allMessages: AgentMessage[]): Promise<void>
```

**说明**: 
- 检查配置中是否设置了 `titleGeneratorModel` 和 `apiKey`
- 使用 `generateTitle()` 工具函数生成标题
- 更新 Notebook 元数据中的 `name` 字段

##### markNotebookAsFinished()

在元数据中将 Notebook 标记为已完成。

```typescript
private async markNotebookAsFinished(): Promise<void>
```

**说明**: 将 `is_task_finished` 设置为 `true`。

##### streamResponse()

流式传输 LLM 响应并收集内容、推理和工具调用。

```typescript
private async streamResponse(
    execution: vscode.NotebookCellExecution,
    messages: AgentMessage[],
    signal: AbortSignal
): Promise<{roundContent: string; roundReasoning: string; toolCalls: any[]}>
```

**参数**:
- `execution` - 单元格执行上下文
- `messages` - 当前消息历史
- `signal` - 用于取消的 Abort 信号

**返回值**: 包含 `roundContent`（内容）、`roundReasoning`（推理）、`toolCalls`（工具调用）的对象

**说明**:
- 使用 OpenAI 流式 API
- 实时更新 UI 显示内容和推理
- 从流中收集工具调用参数

##### parseToolCalls()

将流中的原始工具调用解析为结构化格式。

```typescript
private parseToolCalls(rawToolCalls: any[], currentContent: string, currentReasoning: string): any[]
```

**参数**:
- `rawToolCalls` - 来自流的原始工具调用数据
- `currentContent` - 当前内容缓冲区
- `currentReasoning` - 当前推理缓冲区

**返回值**: `any[]` - 解析后的工具调用

**说明**: 
- 处理 JSON 解析，支持修复格式错误的 JSON
- 为每个工具调用生成唯一 ID

##### executeTools()

执行工具调用并返回结果。

```typescript
private async executeTools(
    execution: vscode.NotebookCellExecution,
    toolCalls: any[],
    abortSignal: AbortSignal
): Promise<{ messages: AgentMessage[]; shouldTerminate: boolean }>
```

**参数**:
- `execution` - 单元格执行上下文
- `toolCalls` - 要执行的工具调用
- `abortSignal` - 用于取消的信号

**返回值**: 包含 `messages`（工具消息）和 `shouldTerminate`（是否应终止）的对象

**说明**:
- 遍历每个工具调用
- 创建 `ToolContext` 传递给工具
- 捕获 `TerminationError` 并重新抛出
- 格式化工具输出并更新 UI

##### formatToolOutput()

将工具输出格式化为 HTML details 元素。

```typescript
private formatToolOutput(toolName: string, toolArgs: any, toolResult: string): string
```

**参数**:
- `toolName` - 工具名称
- `toolArgs` - 工具参数
- `toolResult` - 工具执行结果

**返回值**: `string` - 格式化的 HTML 字符串

**说明**: 如果结果超过 500 字符会被截断。

##### commitRoundUI()

提交当前轮的 UI 内容。

```typescript
private commitRoundUI(content: string, reasoning: string): void
```

**说明**: 将推理过程折叠显示，追加内容到 `committedUiHtml`。

##### renderUI()

将当前 UI 状态渲染到单元格输出。

```typescript
private async renderUI(execution: vscode.NotebookCellExecution, currentContent: string, currentReasoning: string): Promise<void>
```

**说明**: 组合已提交的内容、当前推理（展开显示）和当前内容，更新单元格输出。

##### updateOutput()

用已提交的 UI 内容更新单元格输出。

```typescript
private async updateOutput(execution: vscode.NotebookCellExecution): Promise<void>
```

##### appendErrorUI()

将错误消息追加到 UI。

```typescript
private async appendErrorUI(execution: vscode.NotebookCellExecution, message: string): Promise<void>
```

## 使用示例

```typescript
// 创建运行器实例
const runner = new AgentRunner(
    {
        model: 'gpt-4',
        apiKey: 'your-api-key',
        baseUrl: 'https://api.openai.com/v1',
        maxLoops: 5
    },
    toolManager,
    notebook,
    ['/workspace'],
    false
);

// 执行 Agent 循环
const newMessages = await runner.run(execution, abortController, initialMessages);
```

## 实现细节

### 流式响应处理

- 使用 OpenAI 的 `stream: true` 选项
- 实时提取 `reasoning_content` 或 `reasoning` 字段（支持推理模型）
- 每收到一个 chunk 就更新 UI，实现打字机效果

### 工具调用解析

- 从流中收集工具调用参数，支持分块传输
- 尝试修复格式错误的 JSON（如缺少逗号的分隔对象）
- 去重相同的工具调用参数

### UI 更新机制

- 使用 `committedUiHtml` 累积已完成的轮次内容
- 当前轮次的内容实时渲染
- 推理过程使用折叠的 details 元素显示
- 工具调用结果也使用折叠的 details 元素显示

### 终止处理

- `task_finish` 工具调用会设置 `shouldTerminate` 标志
- 抛出 `TerminationError` 表示需要终止执行
- 标记 Notebook 元数据中的 `is_task_finished` 为 true
