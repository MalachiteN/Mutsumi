# prompts.ts - 系统提示管理模块

## 功能概述

`prompts.ts` 负责管理系统提示（System Prompt）的初始化和动态生成。它管理 `.mutsumi/rules/` 目录下的规则文件，根据 Agent 类型（主 Agent 或子 Agent）加载相应的系统提示，并动态附加运行时上下文。

## 导入依赖

| 模块 | 说明 |
|------|------|
| `vscode` | VSCode API，用于文件系统操作 |
| `util` | Node.js 工具模块，提供 `TextDecoder` 和 `TextEncoder` |

## 主要函数

### initializeRules

初始化规则目录，从插件 assets 目录复制默认规则文件。

#### 函数签名

```typescript
export async function initializeRules(
    extensionUri: vscode.Uri,
    workspaceUri: vscode.Uri
): Promise<void>
```

#### 参数说明

| 参数 | 类型 | 说明 |
|------|------|------|
| `extensionUri` | `vscode.Uri` | 插件扩展的 URI |
| `workspaceUri` | `vscode.Uri` | 工作空间的 URI |

#### 功能流程

1. **创建规则目录**：在工作空间下创建 `.mutsumi/rules/` 目录
2. **复制默认规则**：
   - `default.md` → 主 Agent 默认规则
   - `default-subagent.md` → 子 Agent 默认规则
3. **跳过已存在文件**：如果文件已存在，则不覆盖

#### 目录结构

```
workspace/
└── .mutsumi/
    └── rules/
        ├── default.md          # 主 Agent 规则（从 assets 复制）
        └── default-subagent.md # 子 Agent 规则（从 assets 复制）
```

---

### getSystemPrompt

动态生成系统提示内容，根据 Agent 类型选择相应的规则文件。

#### 函数签名

```typescript
export async function getSystemPrompt(
    workspaceUri: vscode.Uri,
    allowedUris: string[],
    isSubAgent: boolean = false
): Promise<string>
```

#### 参数说明

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `workspaceUri` | `vscode.Uri` | - | 工作空间 URI |
| `allowedUris` | `string[]` | - | 允许的 URI 路径列表 |
| `isSubAgent` | `boolean` | `false` | 是否为子 Agent |

#### 返回值

返回组合后的系统提示字符串，包含：
- 所有适用的规则文件内容
- 运行时上下文信息（Allowed URIs）

#### 规则加载逻辑

| Agent 类型 | 使用的默认规则 | 忽略的规则 |
|------------|----------------|------------|
| 主 Agent (`isSubAgent: false`) | `default.md` | `default-subagent.md` |
| 子 Agent (`isSubAgent: true`) | `default-subagent.md` | `default.md` |

**自定义规则**：所有其他 `.md` 文件都会被加载，不受 Agent 类型影响。

#### 输出格式示例

```markdown
### Rule (default.md)
[主 Agent 默认规则内容]

### Rule (custom-rule.md)
[自定义规则内容]

### Runtime Context
Current Allowed URIs: ["/src", "/tests"]
```

## 使用示例

### 初始化规则

```typescript
import { initializeRules } from './contextManagement/prompts';

// 在插件激活时调用
export async function activate(context: vscode.ExtensionContext) {
    const workspaceUri = vscode.workspace.workspaceFolders![0].uri;
    await initializeRules(context.extensionUri, workspaceUri);
}
```

### 获取系统提示

```typescript
import { getSystemPrompt } from './contextManagement/prompts';

// 构建系统提示
const systemPrompt = await getSystemPrompt(
    workspaceUri,
    ['/src/contextManagement', '/doc'],
    false  // 主 Agent
);

console.log(systemPrompt);
// 输出包含规则和运行时上下文的完整提示
```

## 与其他模块的关系

```
prompts.ts
    ├── 调用 ← VSCode API
    │         vscode.workspace.fs.createDirectory()
    │         vscode.workspace.fs.readDirectory()
    │         vscode.workspace.fs.readFile()
    │         vscode.workspace.fs.copy()
    │
    ├── 读取 ← extension/assets/
    │         default.md
    │         default-subagent.md
    │
    └── 写入 → workspace/.mutsumi/rules/
              规则文件存储位置

被调用者:
    └── history.ts → getSystemPrompt()
        在构建对话历史时获取系统提示
```

## 文件格式说明

### 规则文件格式

规则文件为 Markdown 格式，支持任意 Markdown 语法：

```markdown
# Agent 角色定义

你是 Mutsumi，一个 AI 编程助手...

## 能力
- 代码分析与重构
- 文档生成
- 调试辅助

## 约束
- 遵循项目编码规范
- 不执行危险操作
```

### 运行时上下文

`getSystemPrompt` 会自动追加运行时上下文：

```markdown
### Runtime Context
Current Allowed URIs: ["/src", "/tests"]
```

这部分信息帮助 Agent 了解当前的操作边界。

## 注意事项

1. **文件编码**：使用 UTF-8 编码读取和写入文件
2. **错误处理**：读取/写入失败时会打印错误日志但继续执行
3. **规则优先级**：默认规则会首先加载，自定义规则按文件名排序追加
4. **线程安全**：文件操作是异步的，避免并发修改
5. **增量更新**：`initializeRules` 不会覆盖已存在的规则文件，保护用户自定义配置
