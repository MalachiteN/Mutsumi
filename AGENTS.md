# Mutsumi 项目开发指南（精简版）

> 本文件面向 AI 编码 Agent，介绍 Mutsumi 项目的架构设计理念和开发原则。
> Mutsumi（若叶睦）是一款 VS Code 多 Agent 笔记本环境插件。

---

## 项目概述

Mutsumi 是一款基于 VS Code 的 LLM Agent 插件，采用**子母 Agent 范式**，将复杂任务拆解为多个子任务并行处理。

### 核心特性

- **🥳 子母 Agent 范式**：支持任务分治，避免长对话导致的注意力稀释
- **📝 Notebook 原生体验**：利用 VS Code Notebook API 实现 `.mtm` 文件格式的 Agent 对话
- **🔄 动态上下文系统**：支持 `@[文件引用]` 语法、工具预执行和宏定义
- **🛠️ 预处理器支持**：实现条件编译和宏替换
- **🌐 多工作区原生支持**：兼容多根工作区和 FileSystemProvider 特殊 schema

### 技术栈

| 类别 | 技术 |
|------|------|
| 运行环境 | Node.js + VS Code Extension API |
| 开发语言 | TypeScript |
| 核心能力 | LLM API 调用、语义代码分析、向量搜索、HTTP 服务 |

---

## 项目架构

### 分层架构

```
src/
├── adapters/          # 适配器层 - UI/传输解耦
├── agent/             # Agent 核心逻辑（执行循环、编排、LLM 客户端）
├── codebase/          # 代码库服务（RAG 向量搜索）
├── contextManagement/ # 动态上下文管理（模板引擎）
├── httpServer/        # HTTP API 服务
├── notebook/          # Notebook UI 实现
├── sidebar/           # 侧边栏视图
├── tools.d/           # 内置工具实现
└── 入口及类型定义
```

### 架构设计原则

1. **适配器模式**：通过抽象接口，Agent 核心与 UI 完全解耦
2. **URI 优先**：所有文件操作使用 `vscode.Uri`，支持多工作区和远程文件系统
3. **工作区 [0] 约定**：Mutsumi 自身数据存储在工作区列表 [0] 的 `.mutsumi` 目录
4. **分层工具系统**：工具注册 → 工具集 → 权限 → 具体实现

---

## 构建和开发

### 常用命令

```bash
npm i           # 安装依赖
npm run compile # 编译 TypeScript
vsce package    # 打包为 VSIX 文件
```

### 开发调试

1. 按 F5 启动 Extension Development Host
2. 在新窗口中测试插件功能

---

## 编码规范

### 文件操作规范

**必须使用 `vscode.Uri` 而非字符串路径：**

```typescript
// ✅ 正确
const uri = vscode.Uri.file('/absolute/path');
const content = await vscode.workspace.fs.readFile(uri);

// ❌ 错误
const content = fs.readFileSync('/absolute/path');
```

**工具函数位于 tools.d/utils**，提供 URI 解析和权限检查能力。

### 错误处理

工具执行应返回统一格式：

```typescript
try {
    const result = await operation();
    return { status: 'success', result };
} catch (error) {
    return { 
        status: 'error', 
        error: error instanceof Error ? error.message : String(error) 
    };
}
```

---

## 核心模块概念

### 1. Notebook 系统 (.mtm 文件)

- `.mtm` 文件是 JSON 格式，包含 Agent 元数据和对话历史
- `Code` Cell → 用户输入 / `Markup` Cell → 助手回复
- 临时引用内容使用 Ghost Block 机制，保存时自动剥离

### 2. 动态上下文系统

**文件引用语法：**

```markdown
@[path/to/file]                    # 引用整个文件
@[path/to/file:10:20]             # 引用行范围
@[toolName{"arg": "value"}]       # 预执行工具
```

**处理流程：** 提取宏定义 → 扫描标签 → 递归处理嵌套引用 → 输出

### 3. 工具系统

**能力模型：**

工具能力由配置中的 `toolSets` 字段定义，基础组合包括：
- `read` - 文件读取、搜索、信息查询（只读）
- `deliver` - 文件写入、编辑、shell 执行（写入操作）
- `dispatch` - Agent 编排（`dispatch_subagents`, `get_agent_types`）

AgentType 通过组合这些工具集定义能力边界。例如：
- `chat`: `[]`
- `orchestrator`: `['read', 'deliver', 'dispatch']`
- `planner`: `['read', 'dispatch']`
- `implementer`: `['read', 'deliver', 'dispatch']`
- `reviewer`: `['read']`

**非根 Agent 的完成义务：**

存在 `parent_agent_id` 的 Agent（即通过 `dispatch_subagents` 创建的 Agent）运行时额外获得 `task_finish` 工具，用于向父 Agent 报告完成状态。

**审批流程：**

```
工具调用请求 → 检查自动审批 → 
  是 → 直接执行
  否 → 创建审批请求 → 侧边栏显示 → 用户批准/拒绝 → 执行或返回错误
```

### 4. 子母 Agent 范式

**生命周期：**

```
父 Agent
    ↓ dispatch_subagents
创建子 Agent (多个并行)
    ↓ 各自执行
子 Agent 调用 task_finish
    ↓ 通知父 Agent
父 Agent 收集结果 → 继续执行
```

### 5. RAG 向量搜索

- 内存 SQLite + 向量扩展
- 自动持久化到 `.mutsumi/cache/`
- 基于哈希的增量更新
- 语义分块（函数/类边界）优先，固定窗口回退

### 6. HTTP Server

提供 RESTful API 管理 Agent 和聊天，支持 SSE 流式响应。

---

## 重要参考

### 类型定义

参见 `src/types.ts` 中的核心类型：
- `AgentMetadata` - Agent 元数据
- `AgentMessage` - 消息格式
- `ITool` / `ToolContext` - 工具接口

### 工具实现规范

新工具需实现 `ITool` 接口，包括：
- `name` - 工具名称
- `definition` - JSON Schema 描述
- `execute` - 执行函数（含权限检查）
- `prettyPrint` (可选) - 自定义渲染

### 配置优先级

模型选择优先级（从高到低）：
1. 请求参数中的 `model`
2. Notebook 元数据中的 `model`
3. VS Code 配置 `mutsumi.defaultModel`

---

## 文件命名约定

| 文件/目录 | 用途 |
|-----------|------|
| `*.mtm` | Mutsumi Notebook 文件（Agent 会话） |
| `.mutsumi/` | Mutsumi 配置和数据目录 |
| `.mutsumi/rules/` | 规则文件（.md） |
| `.mutsumi/skills/` | 技能文件（SKILL.md） |
| `.mutsumi/cache/` | 缓存数据（RAG 等） |
| `src/tools.d/` | 内置工具实现（.d 表示目录） |

---

## 开发注意事项

### 多工作区支持

所有涉及工作区的操作应使用工作区 [0] 作为 Mutsumi 主工作区：

```typescript
const workspaceRoot = vscode.workspace.workspaceFolders?.[0];
if (workspaceRoot) {
    const mutsumiDir = vscode.Uri.joinPath(workspaceRoot.uri, '.mutsumi');
}
```

### 权限控制

- 工具执行前必须检查 `allowedUris` 权限
- 文件操作必须解析为绝对 URI 后检查

---

## 扩展阅读

- [VS Code Notebook API](https://code.visualstudio.com/api/extension-guides/notebook)
- [VS Code Extension API](https://code.visualstudio.com/api)

---

## 许可证

本项目采用 [Apache License 2.0](LICENSE) 开源许可证。
