# contextManagement 模块

## 整体功能概述

contextManagement 模块负责管理和组装 Agent 的上下文信息。

采用 "Ghost Block" 上下文注入机制，将所有规则、文件引用和工具结果动态注入到最新的 User Message 末尾。这种设计提升了长上下文场景下的指令遵循能力和上下文感知准确性。

## 核心流程

1. **解析 (Parsing)**: `ContextAssembler` 解析 User Prompt 中的 `@[...]` 引用。
2. **收集 (Collection)**: 将解析出的文件、工具结果以及系统规则统一收集为 `ContextItem`。
3. **累积 (Accumulation)**: `history.ts` 会回溯整个对话历史，累积所有出现过的上下文项，确保模型不会"忘记"之前看过的文件。
4. **注入 (Injection)**: 所有上下文项被序列化为一个 JSON 结构的 `<content_reference>` 块，追加到当前回合的 User Message 末尾。

## 文件关系

```
┌─────────────────────────────────────────────────────────────────┐
│                     preprocessor.ts                             │
│              预处理器，处理条件编译和宏定义                       │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                   contextAssembler.ts                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              ContextAssembler 类                          │  │
│  │  ┌──────────────────┐  ┌──────────────────────────────┐ │  │
│  │  │    preprocess    │  │        prepareSkill          │ │  │
│  │  └──────────────────┘  └──────────────────────────────┘ │  │
│  │  ┌──────────────────┐  ┌──────────────────────────────┐ │  │
│  │  │ assembleDocument │  │       resolveContext         │ │  │
│  │  │ (INLINE 展开)    │  │  (收集 ContextItem[])        │ │  │
│  │  └──────────────────┘  └──────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌───────────────────────────┐    ┌──────────────────────────────┐
│       prompts.ts          │    │       history.ts             │
│  ┌─────────────────────┐  │    │  ┌────────────────────────┐  │
│  │   getRulesContext   │  │    │  │buildInteractionHistory │  │
│  │ (返回 ContextItem[])│  │    │  └───────────┬────────────┘  │
│  └─────────────────────┘  │    │              │               │
│  ┌─────────────────────┐  │    │  1. 获取静态 SystemPrompt     │
│  │   getSystemPrompt   │  │    │  2. 获取 Rules ContextItem   │
│  │    (仅静态身份)      │  │    │  3. 扫描历史收集 ContextItem │
│  └─────────────────────┘  │    │  4. 生成 <content_reference> │
└───────────────────────────┘    │  5. 注入当前 User Message     │
                                 └──────────────────────────────┘
```

## 架构特点

- **System Prompt**: 仅保留身份设定，不包含规则和动态内容。
- **User Message**: 发送给 API 的 User Message 会包含 `<content_reference>` 块，包含所有上下文信息。
- **ContextAssembler**: 提供 `resolveContext` 方法，支持返回结构化数据。
- **History**: 承担上下文状态管理的职责（使用 Map 去重）。

## 语法支持

- 文件引用: `@[path/to/file]`
- 工具调用: `@[tool_name{args}]`
- 预处理: `@{ifdef ...}`
- 图片: `![alt](uri)`

## 数据结构：Ghost Block

发送给模型的最终 User Message 结构示例：

```markdown
User input text here...

<content_reference>
{
  "rules": [
    { "name": "default.md", "content": "..." }
  ],
  "files": {
    "src/main.ts": "import..."
  },
  "tools": [
    { "name": "ls", "args": {"uri": "."}, "result": "..." }
  ]
}
</content_reference>
```
