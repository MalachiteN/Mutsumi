# prompts.ts

## 功能概述

本文件负责管理系统提示词 (System Prompt) 和规则上下文 (Rules Context)。

`prompts.ts` 的职责：
- **System Prompt**: 仅包含最基本的静态信息（运行时上下文、子 Agent 身份标识），不包含具体的规则内容。
- **Rules Context**: 负责读取规则文件，并将其解析为结构化的 `ContextItem` 列表，供 `history.ts` 注入到 User Message 中。

## 导出的函数

### initializeRules

初始化规则目录和默认规则文件。

```typescript
export async function initializeRules(
    extensionUri: vscode.Uri, 
    workspaceUri: vscode.Uri
): Promise<void>
```

负责在 `.mutsumi/rules` 创建 `default.md`。

---

### getSystemPrompt

获取**静态**系统提示词。

```typescript
export async function getSystemPrompt(
    workspaceUri: vscode.Uri, 
    allowedUris: string[], 
    isSubAgent?: boolean
): Promise<string>
```

**返回值:** 
仅包含运行时上下文和身份标识的字符串。

**示例输出:**
```markdown
### Runtime Context
Current Allowed URIs: ["/workspace"]

## Sub-Agent Identity
You are a Sub-Agent...
```

**注意:** 不包含规则文件的内容。

---

### getRulesContext

获取规则文件内容作为上下文项。

```typescript
export async function getRulesContext(
    workspaceUri: vscode.Uri, 
    allowedUris: string[]
): Promise<ContextItem[]>
```

**功能:**
1. 读取 `.mutsumi/rules` 目录下所有 `.md` 文件
2. 对每个文件内容进行 `INLINE` 模式的完全展开（解析嵌套引用）
3. 返回 `ContextItem[]` 列表

**ContextItem 结构:**
```typescript
{
    type: 'rule',
    key: 'default.md', // 文件名
    content: '...解析后的规则内容...'
}
```

**设计意图:**
将规则视为一种特殊的上下文资源，与用户引用的文件和工具结果一起，在构建消息历史时统一注入。这确保了规则内容始终"跟随"最新的用户消息，避免在长对话中被注意力机制忽略。
