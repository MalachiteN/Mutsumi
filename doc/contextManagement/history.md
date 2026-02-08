# history.ts

## 功能概述

本文件负责构建 Agent 的对话历史 (Context Window)。

采用 Ghost Block 注入机制解决长对话中 System Prompt 被遗忘以及文件被重复读取的问题：

1. **System Prompt 极简化**: 仅保留最基本的身份指令。
2. **上下文跟随 User Message**: 所有的规则 (Rules)、用户引用的文件 (Files)、预执行的工具结果 (Tools) 都被打包成一个 JSON 结构的 "Ghost Block"。
3. **动态追加**: 这个 Ghost Block 被追加到**当前最新的 User Message** 末尾。
4. **历史累积**: 扫描历史对话，收集之前所有 User Message 中引用的上下文，确保模型在当前回合仍能访问之前引用的文件，而无需重新读取。

## 导出的函数

### buildInteractionHistory

构建发送给 LLM 的完整消息列表。

```typescript
export async function buildInteractionHistory(
    notebook: vscode.NotebookDocument,
    currentCellIndex: number,
    currentPrompt: string
): Promise<{ 
    messages: AgentMessage[], 
    allowedUris: string[], 
    isSubAgent: boolean 
}>
```

**构建流程:**

1. **生成静态 System Prompt**: 调用 `prompts.getSystemPrompt`。
2. **初始化上下文收集器 (Map)**: 用于去重和累积上下文项。
3. **收集规则**: 调用 `prompts.getRulesContext`，存入收集器。
4. **回溯历史**: 
   - 遍历之前的 User Cell。
   - 对每个历史 User Prompt 调用 `ContextAssembler.resolveContext`，提取引用的文件和工具。
   - 将提取出的项存入收集器（自动去重：同名文件覆盖，同参数工具覆盖）。
   - 将历史消息（**不带 Ghost Block**）加入消息列表。
5. **处理当前 Prompt**:
   - 解析当前 Prompt 中的引用，存入收集器。
   - 解析图片多模态内容。
6. **构建 Ghost Block**:
   - 将收集器中所有内容（规则 + 历史引用 + 当前引用）序列化为 `<content_reference>` JSON 块。
   - 格式如下：
     ```xml
     <content_reference>
     {
       "rules": [ ... ],
       "files": { "path/to/file": "content..." },
       "tools": [ { "name": "...", "args": ..., "result": "..." } ]
     }
     </content_reference>
     ```
7. **注入**: 将 Ghost Block 追加到当前 User Message 的 `content` 中。

**结果:**
模型总是能在最新的 User 消息末尾看到所有相关的上下文信息，如同拥有了完美的"短期记忆"。

## buildInteractionHistory 函数中的 MacroContext 流程

MacroContext 支持用户在 Prompt 中定义宏，这些宏可以在 Rules 文件中被引用，实现动态规则配置。宏定义支持持久化，跨对话轮次保持有效。

### 1. 从当前 Prompt 提取宏定义

使用 `extractMacroDefinitions(currentPrompt)` 提取用户定义的宏：

```typescript
// Extract macro definitions from current user prompt
const userDefinedMacros = extractMacroDefinitions(currentPrompt);
```

支持的宏定义语法：
```
#define MACRO_NAME value
#define API_ENDPOINT https://api.example.com
#define MAX_RETRIES 5
```

### 2. 创建共享的 MacroContext

创建共享的 `MacroContext` 实例，并加载持久化的宏：

```typescript
// Create shared MacroContext and populate with persisted macros
const sharedMacroContext = new MacroContext();

// Load persisted macros from notebook metadata (if any)
if (metadata.macroContext) {
    sharedMacroContext.setMacros(metadata.macroContext);
}

// Override/add with user-defined macros from current prompt
userDefinedMacros.forEach((value, key) => {
    sharedMacroContext.define(key, value);
});
```

流程说明：
- 创建 `sharedMacroContext = new MacroContext()`
- 从 notebook metadata 加载持久化的宏（`metadata.macroContext`）
- 使用 `setMacros()` 方法加载持久化宏
- 使用用户新定义的宏覆盖/补充已有宏

### 3. 传递 MacroContext 给上下文处理函数

将共享的 MacroContext 传递给需要它的函数：

```typescript
// Load Global Rules with macro substitution
const rulesItems = await getRulesContext(wsUri, allowedUris, sharedMacroContext);

// Resolve current prompt context with macros
const currentContext = await ContextAssembler.resolveContextWithMacros(
    currentPrompt,
    wsUri.fsPath,
    allowedUris,
    sharedMacroContext
);

// Refresh persisted files with macro support
const freshItems = await ContextAssembler.resolveContextWithMacros(
    `@[${item.key}]`,
    wsUri.fsPath,
    allowedUris,
    sharedMacroContext
);
```

涉及函数：
- `getRulesContext(wsUri, allowedUris, sharedMacroContext)` - 加载并处理 Rules 文件
- `ContextAssembler.resolveContextWithMacros(currentPrompt, wsUri.fsPath, allowedUris, sharedMacroContext)` - 解析上下文引用

### 4. 持久化宏定义

将宏保存到 notebook metadata，确保跨对话轮次保持有效：

```typescript
const newMetadata = {
    ...metadata,
    contextItems: newContextItems,
    macroContext: sharedMacroContext.getMacrosObject()
};
const notebookEdit = vscode.NotebookEdit.updateNotebookMetadata(newMetadata);
edit.set(notebook.uri, [notebookEdit]);
await vscode.workspace.applyEdit(edit);
```

持久化内容：
- 将宏保存到 notebook metadata: `macroContext: sharedMacroContext.getMacrosObject()`
- 使用 `getMacrosObject()` 获取可序列化的宏定义对象

## 宏的生命周期

宏的生命周期跨越多个对话轮次，实现"长期记忆"效果：

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           宏的生命周期流程                                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  首次交互                                                                │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌──────────┐ │
│  │ 用户定义宏  │ → │ 应用到 Rules│ → │应用到引用文件│ → │保存到metadata│ │
│  └─────────────┘    └─────────────┘    └─────────────┘    └──────────┘ │
│       ↑                                                    │            │
│       └────────────────────────────────────────────────────┘            │
│                           持久化存储                                    │
│                                                                         │
│  后续交互                                                                │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌──────────┐ │
│  │从metadata加载│ → │合并新定义宏  │ → │应用到所有上下文│ → │再次保存   │ │
│  │ 已有宏      │    │ (覆盖/补充)  │    │             │    │          │ │
│  └─────────────┘    └─────────────┘    └─────────────┘    └──────────┘ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 首次交互
1. **用户定义宏** → 在 Prompt 中使用 `#define` 语法定义宏
2. **应用到 Rules** → Rules 文件中的 `{{MACRO_NAME}}` 被替换为宏值
3. **应用到引用文件** → 动态上下文中的宏引用被替换
4. **保存到 metadata** → 宏定义被序列化保存到 notebook metadata

### 后续交互
1. **加载持久化宏** → 从 notebook metadata 中恢复之前保存的宏
2. **合并新定义宏** → 用户新定义的宏会覆盖同名旧宏，或作为新宏添加
3. **应用到所有上下文** → 合并后的宏应用到 Rules、引用文件等所有上下文
4. **再次保存** → 更新后的宏集合再次保存到 metadata

### 使用示例

**用户 Prompt:**
```
#define API_VERSION v2
#define TIMEOUT 30

请帮我检查 @rules/api-rules.md 中的配置是否正确。
```

**Rules 文件 (api-rules.md):**
```markdown
# API 调用规则

- 所有 API 调用必须使用版本 {{API_VERSION}}
- 请求超时设置为 {{TIMEOUT}} 秒
```

**实际生效的规则:**
```markdown
# API 调用规则

- 所有 API 调用必须使用版本 v2
- 请求超时设置为 30 秒
```

在下一次对话中，即使用户不再定义这些宏，之前定义的 `API_VERSION` 和 `TIMEOUT` 仍然会从 metadata 中加载并应用。

## 内部函数

### parseUserMessageWithImages

解析 Markdown 图片语法 `![alt](uri)` 为多模态消息格式。

### readImageAsBase64

读取本地图片并转为 Base64。
