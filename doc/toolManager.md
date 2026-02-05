# toolManager.ts 技术文档

## 文件功能概述

`toolManager.ts` 是 Mutsumi VSCode 插件的**工具管理器**，负责：

- 管理所有可用的工具（注册、分类）
- 根据 Agent 类型（主 Agent / 子 Agent）提供不同的工具集
- 执行具体的工具调用
- 将工具定义转换为 OpenAI Function Calling 格式

它是 Agent 与外部环境交互的"工具箱"。

---

## 主要类：ToolManager

### 类属性

| 属性名 | 类型 | 说明 |
|--------|------|------|
| `commonTools` | `Map<string, ITool>` | 通用工具（主/子 Agent 都可用） |
| `mainOnlyTools` | `Map<string, ITool>` | 仅主 Agent 可用的工具 |
| `subOnlyTools` | `Map<string, ITool>` | 仅子 Agent 可用的工具 |

---

### 构造函数

在构造函数中注册所有工具：

```typescript
constructor() {
    // 注册通用工具
    this.registerCommon(readFileTool);
    this.registerCommon(lsTool);
    // ... 更多通用工具

    // 注册子 Agent 专用工具
    this.registerSub(taskFinishTool);
}
```

---

### 工具分类

#### 通用工具（Common Tools）

| 工具 | 功能 |
|------|------|
| `read_file` | 读取文件内容 |
| `ls` | 列出目录内容 |
| `shell_exec` | 执行 Shell 命令 |
| `edit_file_full_replace` | 全文替换文件 |
| `edit_file_search_replace` | 搜索替换文件内容 |
| `partially_read_by_range` | 按行范围读取文件 |
| `partially_read_around_keyword` | 按关键词读取上下文 |
| `search_file_contains_keyword` | 搜索文件内容 |
| `search_file_name_includes` | 搜索文件名 |
| `get_file_size` | 获取文件大小 |
| `get_env_var` | 获取环境变量 |
| `system_info` | 获取系统信息 |
| `mkdir` | 创建目录 |
| `create_file` | 创建新文件 |
| `git_cmd` | 执行 Git 命令 |
| `project_outline` | 生成项目大纲 |
| `get_warning_error` | 获取诊断信息 |
| `self_fork` | 创建并行子 Agent |
| `get_available_models` | 获取可用模型列表及其标签 |

#### 子 Agent 专用工具（Sub Only Tools）

| 工具 | 功能 |
|------|------|
| `task_finish` | 标记任务完成并返回结果 |

---

### 核心方法

#### `getToolsDefinitions(isSubAgent: boolean): OpenAI.Chat.ChatCompletionTool[]`

**功能**：获取工具定义列表，用于 OpenAI API 调用。

**参数**：
- `isSubAgent` - 是否为子 Agent

**返回值**：OpenAI Chat Completion Tool 定义数组

**逻辑**：
```typescript
const tools: ITool[] = [
    ...this.commonTools.values(),
    ...(isSubAgent ? this.subOnlyTools.values() : this.mainOnlyTools.values())
];
return tools.map(t => t.definition);
```

---

#### `executeTool(name, args, context, isSubAgent): Promise<string>`

**功能**：执行指定的工具。

**参数**：
| 参数名 | 类型 | 说明 |
|--------|------|------|
| `name` | `string` | 工具名称 |
| `args` | `any` | 工具参数 |
| `context` | `ToolContext` | 工具执行上下文 |
| `isSubAgent` | `boolean` | 是否为子 Agent |

**返回值**：`Promise<string>` - 工具执行结果

**访问控制逻辑**：
1. 首先在 `commonTools` 中查找
2. 如果未找到，根据 `isSubAgent` 在 `subOnlyTools` 或 `mainOnlyTools` 中查找
3. 如果仍未找到，检查是否因权限问题不可用，返回相应错误信息
4. 执行工具并返回结果

**错误消息**：
- 子 Agent 尝试使用主 Agent 工具：`'Tool 'xxx' is not available for Sub-Agents.'`
- 主 Agent 尝试使用子 Agent 工具：`'Tool 'xxx' is only available for Sub-Agents.'`
- 未知工具：`'Error: Unknown tool 'xxx''`

---

### 私有注册方法

#### `registerCommon(tool: ITool): void`

注册通用工具。

#### `registerMain(tool: ITool): void`

注册主 Agent 专用工具。

#### `registerSub(tool: ITool): void`

注册子 Agent 专用工具。

---

## 工具接口

### `ITool`

工具必须实现的接口：

```typescript
interface ITool {
    name: string;                                    // 工具名称
    definition: OpenAI.Chat.ChatCompletionTool;      // OpenAI 工具定义
    execute(args: any, context: ToolContext): Promise<string>;  // 执行函数
}
```

### `ToolContext`

工具执行上下文：

```typescript
interface ToolContext {
    allowedUris: string[];                           // 允许访问的 URI
    notebook: vscode.NotebookDocument;               // Notebook 文档
    execution: vscode.NotebookCellExecution;         // 单元格执行对象
    abortSignal: AbortSignal;                        // 中止信号
    appendOutput: (content: string) => Promise<void>; // 追加输出函数
}
```

---

## 与其他模块的关系

```
ToolManager
    ├── 被 AgentRunner 创建和使用
    ├── 被 controller.ts 创建
    ├── 调用各个工具模块（tools.d/*）
    ├── 转换工具定义为 OpenAI 格式
    └── 执行工具调用并返回结果
```

---

## 使用示例

### 在 AgentRunner 中使用

```typescript
// 创建 ToolManager
const tools = new ToolManager();

// 获取工具定义（用于 OpenAI API）
const toolDefinitions = tools.getToolsDefinitions(isSubAgent);

// 执行工具
const result = await tools.executeTool(
    'read_file',
    { uri: 'src/index.ts' },
    context,
    isSubAgent
);
```

### 工具定义示例

```typescript
export const readFileTool: ITool = {
    name: 'read_file',
    definition: {
        type: 'function',
        function: {
            name: 'read_file',
            description: 'Read the contents of a file at the given URI',
            parameters: {
                type: 'object',
                properties: {
                    uri: {
                        type: 'string',
                        description: 'The file URI or path to read'
                    }
                },
                required: ['uri']
            }
        }
    },
    execute: async (args, context) => {
        // 执行逻辑
    }
};
```

---

## 工具权限设计

```
┌─────────────────────────────────────────────────────────┐
│                      主 Agent                            │
│  ┌─────────────────────────────────────────────────┐    │
│  │              通用工具（Common）                   │    │
│  │  • 文件操作  • Shell  • Git  • 搜索  • ...       │    │
│  └─────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────┐    │
│  │           主 Agent 专用工具（Main Only）          │    │
│  │              （当前为空，预留扩展）                │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                      子 Agent                            │
│  ┌─────────────────────────────────────────────────┐    │
│  │              通用工具（Common）                   │    │
│  │  • 文件操作  • Shell  • Git  • 搜索  • ...       │    │
│  └─────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────┐    │
│  │           子 Agent 专用工具（Sub Only）           │    │
│  │  • task_finish - 标记任务完成                    │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

这种设计确保：
- 只有子 Agent 可以调用 `task_finish` 结束任务
- 子 Agent 拥有与主 Agent 几乎相同的工具能力
- 未来可灵活扩展主/子 Agent 的专用工具
