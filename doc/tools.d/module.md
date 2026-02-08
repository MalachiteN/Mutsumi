# tools.d 模块

> **一句话概括**：定义Mutsumi Agent可使用的所有工具，提供统一的ITool接口规范和完整的安全审批机制。

---

## 1. 文件组成分类

### 1.1 核心接口层
| 文件 | 职责 | 说明 |
|------|------|------|
| `interface.ts` | 核心接口定义 | `ToolContext`、`ITool`、`TerminationError` |
| `utils.ts` | 工具基座设施 | 审批请求管理、路径安全检查、访问控制、**EditFileSessionManager 会话管理** |

### 1.2 文件操作工具
| 文件 | 职责 | 说明 |
|------|------|------|
| `read_file.ts` | 读取完整文件 | 全文读取文件内容 |
| `read_partial.ts` | 部分读取文件 | 按行范围或关键词上下文读取 |
| `edit_file_search_replace.ts` | 精准编辑 | 使用SEARCH/REPLACE块进行精确替换，**支持多替换块，格式标记为`<<<<<<<SEARCH`** |
| `edit_file_full_replace.ts` | 全文替换 | 完整替换文件内容 |
| `fs_write_ops.ts` | 文件写入操作 | 创建文件、目录等写入操作 |
| `ls.ts` | 目录浏览 | 列出目录内容 |

### 1.3 搜索工具
| 文件 | 职责 | 说明 |
|------|------|------|
| `search_fs.ts` | 文件搜索 | 递归搜索文件内容(`search_file_contains_keyword`)和文件名(`search_file_name_includes`) |
| `project_outline.ts` | 项目大纲 | 使用Tree-sitter解析生成代码结构大纲 |
| `get_warning_error.ts` | 诊断信息 | 获取工作区/文件的警告和错误信息 |

### 1.4 系统执行工具
| 文件 | 职责 | 说明 |
|------|------|------|
| `shell_exec.ts` | Shell命令执行 | 执行系统命令（需用户审批） |
| `system_info.ts` | 系统信息获取 | 获取OS、Shell、包管理器等环境信息 |
| `git_cmd.ts` | Git操作 | 执行Git命令（需用户审批） |

### 1.5 Agent控制工具
| 文件 | 职责 | 说明 |
|------|------|------|
| `agent_control.ts` | Agent生命周期 | `self_fork`（创建子Agent）和`task_finish`（完成任务报告）的实现 |

### 1.6 编辑辅助工具
| 文件 | 职责 | 说明 |
|------|------|------|
| `edit_file.ts` | 编辑工具入口 | 文件编辑功能的统一入口，**支持从侧边栏重新打开Diff编辑器（`mutsumi.reopenEditDiff`命令），使用EditFileSessionManager管理会话** |
| `edit_codelens_provider.ts` | CodeLens提供器 | 在Diff视图中提供审查用的CodeLens |
| `edit_codelens_types.ts` | CodeLens类型定义 | 编辑相关的CodeLens类型声明 |

---

## 2. 工具架构

### 2.1 ITool接口规范

所有工具必须实现`ITool`接口，确保工具的一致性和可管理性：

```typescript
interface ITool {
    /** 工具名称 */
    readonly name: string;
    
    /** 工具描述 */
    readonly description: string;
    
    /** 参数JSON Schema */
    readonly parameters: JSONSchema;
    
    /** 是否需要用户审批 */
    readonly requireApproval: boolean;
    
    /** 工具执行函数 */
    execute(args: unknown, context: ToolContext): Promise<unknown>;
}
```

### 2.2 审批机制

安全敏感操作必须通过审批流程：

```
┌─────────────────┐
│  工具执行请求    │
└────────┬────────┘
         ▼
┌─────────────────┐     是     ┌─────────────────┐
│  requireApproval? │────────▶│  显示审批弹窗    │
└────────┬────────┘           │  (用户确认/拒绝) │
         │ 否                 └────────┬────────┘
         ▼                            ▼
┌─────────────────┐           ┌─────────────────┐
│   直接执行       │           │  批准 → 执行    │
│                 │           │  拒绝 → 报错    │
└─────────────────┘           └─────────────────┘
```

**核心组件**：
- `ApprovalRequestManager` - 管理待审批请求队列
- **`createRequest` 方法** - 创建审批请求并返回 ID 和 Promise，用于异步处理审批结果
- `requestApproval()` - 发起审批流程并等待用户响应

### 2.3 编辑会话管理

**EditFileSessionManager** 提供活动编辑文件会话的管理：

- 跟踪当前所有活动的文件编辑会话
- 支持从侧边栏重新打开已关闭的 Diff 编辑器
- 通过 `mutsumi.reopenEditDiff` 命令触发
- 每个会话维护完整的编辑状态和元数据

### 2.4 错误处理

工具使用专用错误类型进行流程控制：

| 错误类型 | 用途 | 行为 |
|----------|------|------|
| `TerminationError` | 任务终止信号 | 优雅终止当前任务，不回滚 |
| 普通Error | 执行错误 | 报告错误，可能触发重试 |

---

## 3. 安全设计

### 3.1 路径安全检查

所有涉及文件路径的工具必须通过安全检查：

```typescript
// utils.ts 提供的核心安全函数
resolveUri(uri: string, cwd: string): URI          // 解析并规范化路径
checkAccess(uri: URI, allowedUris: URI[]): boolean // 检查路径是否在允许范围内
```

**安全策略**：
1. **路径规范化** - 解析相对路径、消除`..`遍历
2. **范围限制** - 只允许访问`allowedUris`定义的路径
3. **越界拒绝** - 访问范围外路径时直接报错

### 3.2 权限控制矩阵

| 工具类别 | 审批要求 | 原因 |
|----------|----------|------|
| 文件读取 | 否 | 只读操作，风险低 |
| 文件编辑 | 是 | 会修改用户代码，需确认 |
| 文件写入 | 是 | 创建/删除文件，影响文件系统 |
| Shell执行 | 是 | 执行任意命令，高风险 |
| Git操作 | 是 | 修改版本控制，需确认 |
| Agent控制 | 否 | 内部管理操作 |

---

## 4. 模块边界

### 4.1 与ToolManager的集成

```typescript
// tools.d/index.ts (模块入口)
import { readFileTool } from './read_file';
import { shellExecTool } from './shell_exec';
// ... 其他工具导入

export function registerTools(toolManager: ToolManager): void {
    toolManager.register(readFileTool);
    toolManager.register(shellExecTool);
    // ... 注册所有工具
}
```

### 4.2 模块职责边界

```
┌─────────────────────────────────────────────┐
│              ToolManager (上层)              │
│  - 维护工具注册表                            │
│  - 处理LLM工具调用请求                        │
│  - 管理工具执行生命周期                       │
└─────────────────────┬───────────────────────┘
                      │ 调用ITool接口
                      ▼
┌─────────────────────────────────────────────┐
│              tools.d (本模块)                │
│  - 实现具体工具逻辑                          │
│  - 定义ITool接口标准                         │
│  - 提供审批和路径安全设施                     │
│  - EditFileSessionManager 管理编辑会话       │
└─────────────────────┬───────────────────────┘
                      │ 调用VSCode API / Node API
                      ▼
┌─────────────────────────────────────────────┐
│              运行时环境 (下层)                │
│  - VSCode Extension API                      │
│  - Node.js API                               │
│  - 系统Shell                                  │
└─────────────────────────────────────────────┘
```

### 4.3 使用示例

```typescript
// 在Extension激活时注册所有工具
import { registerTools } from './tools';

export function activate(context: vscode.ExtensionContext) {
    const toolManager = new ToolManager();
    registerTools(toolManager);
    
    // toolManager现在拥有所有工具，可供LLM调用
}
```

---

## 5. 新功能摘要

本模块近期新增以下重要功能：

| 功能 | 所在文件 | 说明 |
|------|----------|------|
| **多SEARCH/REPLACE块支持** | `edit_file_search_replace.ts` | 单次调用可执行多个替换操作，格式标记更新为`<<<<<<<SEARCH`（无空格） |
| **侧边栏重新打开Diff** | `edit_file.ts` | 通过 `mutsumi.reopenEditDiff` 命令从历史会话恢复Diff编辑器 |
| **EditFileSessionManager** | `utils.ts`, `edit_file.ts` | 统一管理活动编辑会话，支持会话持久化和恢复 |
| **createRequest方法** | `utils.ts` | 创建带ID的审批请求，返回Promise用于异步处理 |

> 详细内容请参阅各工具的详细文档。

---

## 6. 文档索引

| 文档 | 内容 |
|------|------|
| [interface.md](./interface.md) | ToolContext、ITool、TerminationError接口定义 |
| [utils.md](./utils.md) | ApprovalRequestManager、EditFileSessionManager、路径安全函数 |
| [read_file.md](./read_file.md) | 文件读取工具 |
| [read_partial.md](./read_partial.md) | 部分文件读取工具 |
| [edit_file_search_replace.md](./edit_file_search_replace.md) | 精准文本替换工具（含多替换块支持） |
| [edit_file_full_replace.md](./edit_file_full_replace.md) | 全文替换工具 |
| [fs_write_ops.md](./fs_write_ops.md) | 文件写入操作工具 |
| [ls.md](./ls.md) | 目录浏览工具 |
| [search_fs.md](./search_fs.md) | 文件搜索工具 |
| [project_outline.md](./project_outline.md) | 项目大纲生成工具 |
| [get_warning_error.md](./get_warning_error.md) | 诊断信息获取工具 |
| [shell_exec.md](./shell_exec.md) | Shell命令执行工具 |
| [system_info.md](./system_info.md) | 系统信息获取工具 |
| [git_cmd.md](./git_cmd.md) | Git操作工具 |
| [agent_control.md](./agent_control.md) | Agent生命周期控制工具 |
| [edit_file.md](./edit_file.md) | 编辑工具入口（含Diff重新打开功能） |
| [edit_codelens_provider.md](./edit_codelens_provider.md) | 编辑CodeLens提供器 |
| [edit_codelens_types.md](./edit_codelens_types.md) | 编辑CodeLens类型 |
