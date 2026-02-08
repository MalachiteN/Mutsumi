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

## 内部函数

### parseUserMessageWithImages

解析 Markdown 图片语法 `![alt](uri)` 为多模态消息格式。

### readImageAsBase64

读取本地图片并转为 Base64。
