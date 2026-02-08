# Notebook 模块

## 功能概述

Notebook 模块负责 Mutsumi 插件的对话界面核心功能，包括：

1. **Notebook 序列化**：实现 Agent 对话数据的持久化存储和加载
2. **智能补全**：提供 `@` 触发的文件、目录、工具引用补全

该模块基于 VS Code Notebook API 构建，允许以单元格形式呈现 Agent 对话。

## 文件关系

```
┌─────────────────────┐     ┌─────────────────────┐
│   completionProvider.ts   │     │     serializer.ts     │
│  (自动补全提供器)         │     │  (Notebook 序列化器)  │
└─────────────────────┘     └─────────────────────┘
           │                            │
           │ 触发条件: @                │ 数据格式: JSON
           │ 补全内容:                  │ 单元格类型:
           │ - 文件引用                 │ - Code (user)
           │ - 目录引用                 │ - Markup (system/assistant)
           │ - 工具调用                 │
           ▼                            ▼
         VS Code Notebook API
```

## 文件说明

| 文件 | 主要导出 | 功能 |
|------|----------|------|
| `completionProvider.ts` | `ReferenceCompletionProvider` | 提供 `@` 触发的智能补全 |
| `serializer.ts` | `MutsumiSerializer` | 对话数据的序列化/反序列化 |

## 主要导出项

### ReferenceCompletionProvider

- **实现**: `vscode.CompletionItemProvider`
- **触发字符**: `@`
- **补全来源**:
  - 工作区文件（自动排除忽略目录）
  - 工作区根目录
  - `ToolManager` 注册的工具
- **工具调用格式**: `[工具名{参数}]`（无参数时为 `[工具名{}]`）

### MutsumiSerializer

- **实现**: `vscode.NotebookSerializer`
- **核心方法**:
  - `deserializeNotebook()` - 从文件加载对话
  - `serializeNotebook()` - 保存对话到文件
  - `createDefaultContent()` - 创建新对话
- **数据格式**: JSON，包含元数据和消息上下文

## 数据流

```
用户输入 → completionProvider (补全提示)
              ↓
Notebook 保存 → serializer.serializeNotebook() → JSON 文件
              ↓
Notebook 打开 → serializer.deserializeNotebook() → 单元格显示
```
