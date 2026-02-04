# shell_exec.ts

## 功能概述

`shell_exec.ts` 实现了 Shell 命令执行工具，允许 Agent 在指定工作目录中执行任意 Shell 命令。出于安全考虑，所有命令执行都需要用户通过侧边栏显式批准。

---

## 主要工具

### `shellExecTool`

| 属性 | 值 |
|------|-----|
| 名称 | `shell_exec` |
| 描述 | 执行 Shell 命令。需要用户批准。**重要**：在执行前应先运行 `system_info` 了解环境。 |

**参数：**

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| `uri` | `string` | 是 | 命令执行的工作目录（CWD） |
| `cmd` | `string` | 是 | 要执行的 Shell 命令 |
| `shell_path` | `string` | 否 | Shell 可执行文件的绝对路径（例如：/bin/bash, C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe）。如果省略，使用系统默认 Shell |

**执行流程：**

```
┌─────────────────────┐
│ 接收参数            │
│ (uri, cmd,          │
│  shell_path?)       │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 验证参数            │
│ uri 和 cmd 不能为空 │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 解析 URI 获取 CWD   │
│ 提取 Shell 名称     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 请求用户批准        │
│ 显示命令和 Shell    │
│ 详情                │
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
└────┬────┘ │消息      │
     │      └─────────┘
     ▼
┌─────────────────────┐
│ 返回命令输出        │
│ STDOUT/STDERR/Error │
└─────────────────────┘
```

**返回值：**

| 情况 | 返回值 |
|------|--------|
| 参数缺失 | `'Error: Missing "uri" or "cmd" argument.'` |
| 用户拒绝 | `'User rejected the shell command execution.'` |
| 执行成功 | 包含 STDOUT、STDERR 和错误消息的格式化输出 |
| 无输出 | `'Command executed with no output.'` |

**输出格式：**

```
STDOUT:
{标准输出内容}

STDERR:
{标准错误内容}

ERROR:
{错误消息}
```

---

## Shell 配置

### 默认 Shell

如果不指定 `shell_path`，使用系统默认 Shell：

```typescript
const execOptions: cp.ExecOptions = { cwd };
if (shellPath) {
    execOptions.shell = shellPath;
}
```

### 指定 Shell

可以显式指定要使用的 Shell：

```typescript
// Linux/macOS
await shellExecTool.execute({
    uri: '/workspace/project',
    cmd: 'ls -la && npm test',
    shell_path: '/bin/bash'
}, context);

// Windows
await shellExecTool.execute({
    uri: 'C:\\project',
    cmd: 'dir && npm test',
    shell_path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
}, context);
```

---

## 依赖关系

| 依赖 | 用途 |
|------|------|
| `interface.ts` | `ITool`、`ToolContext` 接口 |
| `utils.ts` | `resolveUri`、`requestApproval` 函数 |
| `vscode` | VS Code API |
| `child_process` | 执行 Shell 命令 |
| `path` | 提取 Shell 名称 |

---

## 使用场景

### 场景 1：列出目录内容

```typescript
const result = await shellExecTool.execute({
    uri: '/workspace/project',
    cmd: 'ls -la'
}, context);
```

### 场景 2：运行测试

```typescript
const result = await shellExecTool.execute({
    uri: '/workspace/project',
    cmd: 'npm test'
}, context);
```

### 场景 3：构建项目

```typescript
const result = await shellExecTool.execute({
    uri: '/workspace/project',
    cmd: 'npm run build'
}, context);
```

### 场景 4：使用特定 Shell 特性

```typescript
// 使用 Bash 特性
const result = await shellExecTool.execute({
    uri: '/workspace/project',
    cmd: 'for f in *.ts; do echo "Processing $f"; done',
    shell_path: '/bin/bash'
}, context);
```

### 场景 5：安装依赖

```typescript
const result = await shellExecTool.execute({
    uri: '/workspace/project',
    cmd: 'npm install lodash @types/lodash'
}, context);
```

---

## 安全考虑

1. **用户批准**：所有 Shell 命令都必须经过用户批准才能执行
2. **侧边栏通知**：批准请求显示在 Mutsumi 侧边栏中
3. **命令透明**：用户可以看到完整的命令内容和使用的 Shell
4. **工作目录限制**：命令在指定的 `uri` 目录中执行
5. **系统信息建议**：工具描述建议先运行 `system_info` 了解环境

---

## 与 system_info 的关系

工具描述强调先运行 `system_info`：

```
**IMPORTANT**: Run `system_info` first to find available shells and their paths.
```

这样可以了解：
- 操作系统类型
- 可用的 Shell 及其路径
- 包管理器可用性

示例工作流：

```typescript
// 1. 获取系统信息
const sysInfo = await systemInfoTool.execute({}, context);
console.log(sysInfo);
// Platform: linux (x64)
// Default Shell (Env): /bin/bash
// Available Shells: bash: /bin/bash, zsh: /usr/bin/zsh

// 2. 根据系统信息执行命令
const result = await shellExecTool.execute({
    uri: '/workspace/project',
    cmd: 'npm install',
    shell_path: '/bin/bash'  // 已知可用
}, context);
```

---

## 注意事项

1. **命令安全**：用户应该仔细检查命令内容，避免执行危险操作（如 `rm -rf /`）
2. **超时处理**：当前实现没有设置超时，长时间运行的命令会一直等待
3. **环境变量**：命令继承 VS Code 进程的环境变量
4. **输出缓冲**：大量输出可能会被截断或缓冲
5. **路径格式**：Windows 路径使用 `\\`，Unix 路径使用 `/`
