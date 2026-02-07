# prompts.ts

## 功能概述

本文件负责系统提示词的初始化和管理，包括：
- 初始化规则目录和默认规则文件
- 读取 `.mutsumi/rules` 目录下的所有 Markdown 文件
- 组装完整的系统提示词，支持动态上下文引用解析
- 为子Agent追加身份标识

## 导出的函数

### initializeRules

初始化规则目录和默认规则文件。

```typescript
export async function initializeRules(
    extensionUri: vscode.Uri, 
    workspaceUri: vscode.Uri
): Promise<void>
```

**参数:**
- `extensionUri` - 扩展的根URI
- `workspaceUri` - 工作区URI

**功能:**
1. 在工作区 `.mutsumi/rules` 目录创建默认规则文件
2. 如果 `default.md` 不存在，从扩展的 `assets` 目录复制

**创建的目录结构:**
```
workspace/
└── .mutsumi/
    └── rules/
        └── default.md
```

**示例:**
```typescript
const extUri = context.extensionUri;
const wsUri = vscode.workspace.workspaceFolders[0].uri;
await initializeRules(extUri, wsUri);
```

---

### getSystemPrompt

获取组装后的系统提示词。

```typescript
export async function getSystemPrompt(
    workspaceUri: vscode.Uri, 
    allowedUris: string[], 
    isSubAgent?: boolean
): Promise<string>
```

**参数:**
- `workspaceUri` - 工作区URI
- `allowedUris` - 允许的URI列表
- `isSubAgent` - 是否为子Agent（可选）

**返回值:** 组装后的系统提示词字符串

**组装流程:**
1. 读取 `.mutsumi/rules` 目录下所有 `.md` 文件
2. 合并所有规则文件内容，格式为 `### Rule (文件名)\n内容`
3. 追加运行时上下文（允许的URI列表）
4. 使用 `ContextAssembler` 递归解析 `@[path]` 引用
5. 如果是子Agent，追加子Agent身份描述

**输出格式:**
```markdown
### Rule (default.md)
默认规则内容...

### Rule (custom.md)
自定义规则内容...

### Runtime Context
Current Allowed URIs: ["/workspace"]

## Sub-Agent Identity
You are a Sub-Agent...
```

**示例:**
```typescript
const prompt = await getSystemPrompt(wsUri, ['/workspace'], false);
// 返回包含规则文件内容和运行时上下文的系统提示词
```

## 相关文件

- **源规则文件:** 扩展的 `assets/default.md`
- **目标规则目录:** 工作区的 `.mutsumi/rules/`

## 注意事项

- 规则文件按字母顺序读取和合并
- 支持在规则文件中使用 `@[path]` 语法引用其他文件
- 子Agent会自动追加使用 `task_finish` 工具的说明
