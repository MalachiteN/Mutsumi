# Mutsumi 核心模块文档

本文档汇总了 Mutsumi VSCode LLM Agent 插件核心源代码的说明。

## 模块概述

核心模块位于 `src/` 目录，负责插件的入口、Agent生命周期管理、类型定义、工具注册等基础功能。

## 文件关系

```
extension.ts (入口)
    ├── controller.ts (单元格执行控制)
    ├── agentOrchestrator.ts (Agent调度)
    │       └── agentRunner.ts (Agent运行)
    ├── toolManager.ts (工具管理)
    ├── types.ts (类型定义)
    └── utils.ts (工具函数)
```

## 各文件功能

| 文件 | 主要功能 |
|------|----------|
| extension.ts | 插件主入口，注册6个命令，处理activate/deactivate |
| controller.ts | AgentController类，管理Notebook单元格执行生命周期 |
| agentOrchestrator.ts | AgentOrchestrator单例，管理Agent生命周期、fork会话、UI状态 |
| agentRunner.ts | AgentRunner类，处理流式响应、工具调用解析、UI更新 |
| toolManager.ts | ToolManager类，管理19个内置工具的注册和执行，支持主/子agent权限控制 |
| types.ts | 核心类型定义：AgentMetadata、AgentMessage、ToolRequest/Result等 |
| utils.ts | 工具函数：标题生成、文件名清理、唯一文件名保证 |

## 主要导出项

### 类型定义 (types.ts)
- `AgentMetadata` - Agent元数据
- `AgentMessage` - Agent消息格式
- `ToolRequest` / `ToolResult` - 工具调用请求和结果
- `ExecutionStatus` - 执行状态枚举

### 类
- `AgentOrchestrator` - Agent调度器（单例）
- `AgentRunner` - Agent运行器
- `AgentController` - 单元格执行控制器
- `ToolManager` - 工具管理器（单例）

### 函数
- `activate()` / `deactivate()` - 插件生命周期
- `generateHeading()` - 标题生成
- `sanitizeFileName()` - 文件名清理

## 子模块

- [codebase](./codebase/) - 代码库分析服务
- [contextManagement](./contextManagement/) - 动态上下文组装
- [notebook](./notebook/) - Notebook序列化和补全
- [sidebar](./sidebar/) - 侧边栏UI组件
- [tools.d](./tools.d/) - 内置工具实现
