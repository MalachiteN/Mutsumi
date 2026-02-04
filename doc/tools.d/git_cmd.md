# git_cmd.ts

## 功能概述

`git_cmd.ts` 实现了 Git 命令执行工具，允许 Agent 在指定目录中执行 Git 命令。出于安全考虑，所有 Git 命令执行都需要用户通过 UI 通知显式批准。

---

## 主要工具

### `gitCmdTool`

| 属性 | 值 |
|------|-----|
| 名称 | `git_cmd` |
| 描述 | 在指定目录中执行 Git 命令。需要通过 UI 通知获得用户显式批准。 |

**参数：**

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| `uri` | `string` | 是 | 仓库根目录或子目录的 URI（工作目录） |
| `args` | `string` | 是 | Git 命令参数（例如："status"、"commit -m \"msg\""）。**不要**包含 "git" 前缀 |

**执行流程：**

```
┌─────────────────────┐
│ 接收参数 (uri, args)│
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 验证参数            │
│ uri 和 args 不能为空│
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 解析 URI 获取路径   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 处理 args 参数      │
│ - 去除首尾空格      │
│ - 去除 "git " 前缀  │
│   （如果模型误加）  │
│ - 构建完整命令      │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 请求用户批准        │
│ 显示命令详情        │
└──────────┬──────────┘
           │
      ┌────┴────┐
      │         │
      ▼         ▼
┌─────────┐ ┌─────────┐
│  批准   │ │  拒绝   │
└────┬────┘ └────┬────┘
     │           │
     ▼           ▼
┌─────────┐ ┌─────────┐
│执行命令  │ │返回拒绝  │
│返回结果  │ │消息      │
└─────────┘ └─────────┘
```

**返回值：**

| 情况 | 返回值 |
|------|--------|
| 参数缺失 | `'Error: Missing "uri" or "args" argument.'` |
| 用户拒绝 | `'User rejected the git command execution.'` |
| 执行成功 | 包含 STDOUT、STDERR 和错误码的格式化输出 |
| 无输出 | `'Git command executed successfully with no output.'` |

**输出格式：**

```
STDOUT:
{标准输出内容}

STDERR:
{标准错误内容}

ERROR CODE: {code}
MESSAGE: {错误消息}
```

---

## 命令处理

### 前缀处理

工具会自动去除可能由 AI 模型误加的 "git " 前缀：

```typescript
const cleanArgs = gitArgs.trim().replace(/^git\s+/i, '');
const fullCmd = `git ${cleanArgs}`;
```

### 示例转换

| 输入 args | 处理后 |
|-----------|--------|
| `"status"` | `git status` |
| `"git log --oneline"` | `git log --oneline` |
| `"  git commit -m 'fix'  "` | `git commit -m 'fix'` |
| `"GIT status"` | `git status` |

---

## 依赖关系

| 依赖 | 用途 |
|------|------|
| `interface.ts` | `ITool`、`ToolContext` 接口 |
| `utils.ts` | `resolveUri`、`requestApproval` 函数 |
| `vscode` | VS Code API |
| `child_process` | 执行 Git 命令 |

---

## 使用场景

### 场景 1：查看仓库状态

```typescript
const result = await gitCmdTool.execute({
    uri: '/workspace/project',
    args: 'status'
}, context);
```

### 场景 2：查看提交历史

```typescript
const result = await gitCmdTool.execute({
    uri: '/workspace/project',
    args: 'log --oneline -10'
}, context);
```

### 场景 3：查看文件差异

```typescript
const result = await gitCmdTool.execute({
    uri: '/workspace/project',
    args: 'diff src/main.ts'
}, context);
```

### 场景 4：添加和提交更改

```typescript
// 添加文件
await gitCmdTool.execute({
    uri: '/workspace/project',
    args: 'add src/new-feature.ts'
}, context);

// 提交
await gitCmdTool.execute({
    uri: '/workspace/project',
    args: 'commit -m "Add new feature"'
}, context);
```

### 场景 5：切换分支

```typescript
const result = await gitCmdTool.execute({
    uri: '/workspace/project',
    args: 'checkout -b feature-branch'
}, context);
```

---

## 安全考虑

1. **用户批准**：所有 Git 命令都必须经过用户批准才能执行
2. **侧边栏通知**：批准请求显示在 Mutsumi 侧边栏中
3. **命令透明**：用户可以看到完整的 Git 命令内容
4. **工作目录限制**：命令在指定的 `uri` 目录中执行，防止意外操作其他仓库

---

## 注意事项

1. **不要包含 "git" 前缀**：`args` 参数应该只包含命令参数
2. **路径处理**：`uri` 参数支持相对路径（相对于工作区根）和绝对路径
3. **错误处理**：Git 命令的错误信息会完整返回，包括 STDERR 和错误码
4. **执行环境**：命令在子进程中执行，使用指定的目录作为工作目录
5. **同步执行**：命令执行是异步的，使用 Promise 返回结果
