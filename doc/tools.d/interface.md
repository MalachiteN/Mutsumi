# interface.ts

## 功能概述

`interface.ts` 是 `tools.d` 模块的核心接口定义文件，定义了所有工具需要实现的标准接口和共享类型。它为整个工具系统提供了类型安全和统一的契约。

---

## 核心类型定义

### `TerminationError` 类

自定义错误类，用于表示执行被用户终止的情况。

```typescript
export class TerminationError extends Error {
    constructor(message: string = 'Execution terminated by user')
}
```

**使用场景：**
- 用户拒绝操作（如拒绝编辑确认）
- 用户取消正在执行的操作
- 任务被系统中止

---

### `ToolContext` 接口

工具执行时所需的上下文信息容器。

| 属性 | 类型 | 描述 |
|------|------|------|
| `allowedUris` | `string[]` | Agent 被允许访问的 URI 路径列表（访问控制） |
| `notebook` | `vscode.NotebookDocument?` | 当前 Notebook 文档引用 |
| `execution` | `vscode.NotebookCellExecution?` | 当前单元格执行对象 |
| `appendOutput` | `(content: string) => Promise<void>?` | 向 Notebook 输出追加内容的回调函数 |
| `abortSignal` | `AbortSignal?` | 用于监听取消信号的中止信号 |

**使用示例：**

```typescript
const context: ToolContext = {
    allowedUris: ['/workspace/project'],
    notebook: currentNotebook,
    execution: cellExecution,
    appendOutput: async (content) => {
        await execution.appendOutput(new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.text(content)
        ]));
    },
    abortSignal: controller.signal
};
```

---

### `ITool` 接口

所有工具必须实现的标准接口。

```typescript
export interface ITool {
    name: string;
    definition: OpenAI.Chat.ChatCompletionTool;
    execute(args: any, context: ToolContext): Promise<string>;
}
```

| 属性 | 类型 | 描述 |
|------|------|------|
| `name` | `string` | 工具的唯一标识名称 |
| `definition` | `OpenAI.Chat.ChatCompletionTool` | OpenAI API 格式的工具定义（用于 Function Calling） |
| `execute` | `(args, context) => Promise<string>` | 工具的实际执行函数 |

**实现示例：**

```typescript
export const myTool: ITool = {
    name: 'my_tool',
    definition: {
        type: 'function',
        function: {
            name: 'my_tool',
            description: 'Tool description',
            parameters: {
                type: 'object',
                properties: { /* ... */ },
                required: ['param1']
            }
        }
    },
    execute: async (args, context) => {
        // 工具逻辑
        return 'Result';
    }
};
```

---

## 依赖关系

| 依赖 | 用途 |
|------|------|
| `vscode` | 访问 VS Code API 类型（NotebookDocument, NotebookCellExecution） |
| `openai` | OpenAI 聊天补全工具类型定义 |

---

## 与其他模块的关系

```
interface.ts
    ↑
    ├── 被所有工具模块导入（read_file.ts, ls.ts 等）
    ├── 被 Agent 核心模块使用
    └── 作为工具注册和调用的契约基础
```

---

## 最佳实践

1. **错误处理**：使用 `TerminationError` 表示用户主动终止的操作
2. **访问控制**：始终检查 `context.allowedUris` 限制 Agent 的文件系统访问范围
3. **输出反馈**：使用 `context.appendOutput` 向用户提供实时反馈
4. **取消支持**：监听 `context.abortSignal` 实现可取消的操作
