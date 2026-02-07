# toolManager.ts

## 概述

Agent 工具的注册和执行管理器。维护独立的工具注册表（通用工具、仅主 agent 工具、仅子 agent 工具），提供工具定义获取和工具执行功能。

## 类

### `ToolManager`

管理工具的注册和执行。

#### 属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `commonTools` | `Map<string, ITool>` | 所有 agent 都可用的工具 |
| `mainOnlyTools` | `Map<string, ITool>` | 仅主 agent 可用的工具 |
| `subOnlyTools` | `Map<string, ITool>` | 仅子 agent 可用的工具 |
| `instance` (static) | `ToolManager` | 单例实例 |

#### 构造函数

```typescript
constructor()
```

创建新的 ToolManager 实例并注册所有工具。如果是第一个实例，设置为单例。

---

#### 静态方法

##### `getInstance(): ToolManager`

获取 ToolManager 的单例实例。

**返回：**
- `ToolManager` - 单例实例

---

#### 私有方法

##### `registerAllTools(): void`

注册所有内置工具到各自的注册表。

**通用工具（commonTools）：**

| 工具 | 功能 |
|------|------|
| `readFileTool` | 读取文件内容 |
| `lsTool` | 列出目录内容 |
| `shellExecTool` | 执行 shell 命令 |
| `editFileFullReplaceTool` | 完整替换文件内容 |
| `editFileSearchReplaceTool` | 搜索替换文件内容 |
| `partiallyReadByRangeTool` | 按行范围读取文件 |
| `partiallyReadAroundKeywordTool` | 按关键字读取文件上下文 |
| `searchFileContainsKeywordTool` | 搜索包含关键字的文件 |
| `searchFileNameIncludesTool` | 搜索文件名包含关键字的文件 |
| `getFileSizeTool` | 获取文件大小 |
| `getEnvVarTool` | 获取环境变量 |
| `systemInfoTool` | 获取系统信息 |
| `mkdirTool` | 创建目录 |
| `createNewFileTool` | 创建新文件 |
| `gitCmdTool` | 执行 git 命令 |
| `projectOutlineTool` | 生成项目代码结构大纲 |
| `getWarningErrorTool` | 获取工作区警告和错误 |
| `selfForkTool` | 创建子 agent |
| `getAvailableModelsTool` | 获取可用模型列表 |

**仅子 agent 工具（subOnlyTools）：**

| 工具 | 功能 |
|------|------|
| `taskFinishTool` | 子 agent 完成任务 |

---

##### `registerCommon(tool: ITool): void`

将工具注册为通用工具（所有 agent 可用）。

##### `registerMain(tool: ITool): void`

将工具注册为仅主 agent 可用。

##### `registerSub(tool: ITool): void`

将工具注册为仅子 agent 可用。

---

#### 公共方法

##### `getToolsDefinitions(isSubAgent: boolean): OpenAI.Chat.ChatCompletionTool[]`

获取格式化为 OpenAI API 的工具定义。

**参数：**
- `isSubAgent` - 是否为子 agent 请求

**返回：**
- `OpenAI.Chat.ChatCompletionTool[]` - 工具定义数组

**过滤逻辑：**
- 所有 agent：通用工具
- 主 agent：通用工具 + 仅主 agent 工具
- 子 agent：通用工具 + 仅子 agent 工具

---

##### `executeTool(name, args, context, isSubAgent): Promise<string>`

使用给定参数和上下文执行工具。

**参数：**
- `name` - 要执行的工具名称
- `args` - 工具的参数
- `context` - 执行上下文（ToolContext）
- `isSubAgent` - 调用者是否为子 agent

**返回：**
- `Promise<string>` - 工具执行结果（字符串）

**执行流程：**
1. 在通用工具中查找
2. 如未找到，根据 `isSubAgent` 在对应注册表中查找
3. 如仍未找到，返回错误信息（区分权限错误和未知工具）
4. 调用工具的 `execute` 方法

**错误处理：**
- 子 agent 尝试使用主 agent 工具：返回权限错误
- 主 agent 尝试使用子 agent 工具：返回权限错误
- 未知工具：返回未知工具错误

## 工具分类说明

### 权限控制

```
┌─────────────────┐
│   通用工具       │  ← 所有 agent 可用
├─────────────────┤
│  主 agent 工具   │  ← 仅主 agent 可用
├─────────────────┤
│  子 agent 工具   │  ← 仅子 agent 可用
└─────────────────┘
```

### 设计目的

- **通用工具**：基础文件操作、搜索、执行等所有 agent 都需要的能力
- **子 agent 专用**：`task_finish` 只有子 agent 需要调用，用于向父 agent 报告完成状态

## 使用示例

```typescript
const toolManager = new ToolManager();

// 获取主 agent 的工具定义
const mainTools = toolManager.getToolsDefinitions(false);

// 获取子 agent 的工具定义
const subTools = toolManager.getToolsDefinitions(true);

// 执行工具
const result = await toolManager.executeTool(
  'read_file',
  { uri: 'file.txt' },
  context,
  false
);
```
