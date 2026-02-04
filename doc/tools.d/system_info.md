# system_info.ts

## 功能概述

`system_info.ts` 实现了系统信息获取工具，包括操作系统信息、Shell 检测、包管理器检测、容器和虚拟化工具检测等。这是 Agent 了解执行环境的基础工具，建议在其他系统操作前优先执行。

---

## 主要工具

### `systemInfoTool` - 系统信息工具

| 属性 | 值 |
|------|-----|
| 名称 | `system_info` |
| 描述 | 获取系统信息（操作系统、Shell、包管理器）。必须在 `shell_exec` 之前运行以了解环境。 |

**参数：**

无参数。

**执行流程：**

```
┌─────────────────────┐
│ 收集基本信息        │
│ - 平台              │
│ - 架构              │
│ - 系统版本          │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 检测 Shell          │
│ - 环境变量 SHELL    │
│ - 可用 Shell 列表   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 平台特定检测        │
│ - Linux: 发行版、   │
│   init 系统、包管理 │
│ - macOS: launchd、  │
│   homebrew          │
│ - Windows: 包管理、 │
│   SCM 工具          │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 通用工具检测        │
│ - 语言包管理器      │
│ - 容器和虚拟化工具  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 返回格式化信息      │
└─────────────────────┘
```

**返回值：**

格式化的多行系统信息字符串。

**输出示例（Linux）：**

```
Platform: linux (x64)
Release: 5.15.0
Default Shell (Env): /bin/bash
Available Shells: bash: /bin/bash, zsh: /usr/bin/zsh, fish: /usr/bin/fish
Init System: systemd (Controls services via systemctl/service)
Distro Info: Ubuntu 22.04.3 LTS
System Package Managers: apt, apt-get
Language Package Managers: npm, yarn, pip3
Container & Virtualization: docker, kubectl
```

**输出示例（Windows）：**

```
Platform: win32 (x64)
Release: 10.0.19045
Default Shell (Env): C:\Windows\System32\cmd.exe
Available Shells: powershell: C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe, cmd: C:\Windows\System32\cmd.exe
System Package Managers: winget, choco
Service Manager: Windows SCM (CLI tools: sc, net)
Language Package Managers: npm, yarn, pip
Container & Virtualization: docker, wsl
```

---

### `getFileSizeTool` - 文件大小工具

| 属性 | 值 |
|------|-----|
| 名称 | `get_file_size` |
| 描述 | 获取文件大小（KB）。**关键**：在读取或编辑文件前使用此工具，以决定使用部分读取还是完整读取，节省 Token。 |

**参数：**

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| `uri` | `string` | 是 | 文件 URI |

**返回值：**

| 情况 | 返回值 |
|------|--------|
| 成功 | `Size: {KB} KB ({bytes} bytes)` |
| 错误 | `'Error getting file size: {error}'` |

**输出格式：**

```
Size: 45.23 KB (46315 bytes)
```

---

### `getEnvVarTool` - 环境变量工具

| 属性 | 值 |
|------|-----|
| 名称 | `get_env_var` |
| 描述 | 读取特定系统环境变量的值 |

**参数：**

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| `name` | `string` | 是 | 环境变量名称（例如：PATH、HOME） |

**返回值：**

| 情况 | 返回值 |
|------|--------|
| 参数缺失 | `'Error: Please specify the environment variable name.'` |
| 未设置 | `'Environment variable '{name}' is not set.'` |
| 成功 | 环境变量的值 |

---

## 检测细节

### Shell 检测

检测逻辑：

```typescript
// 1. 从环境变量获取默认 Shell
const defaultShell = process.env.SHELL || 
    (platform === 'win32' ? process.env.COMSPEC : '/bin/sh');

// 2. 检测可用的 Shell
const shellCandidates = platform === 'win32' 
    ? ['powershell', 'pwsh', 'cmd', 'bash']
    : ['bash', 'zsh', 'fish', 'sh', 'csh', 'ksh'];

// 使用 which/where 命令检测
```

### Linux 特定检测

| 检测项 | 命令 |
|--------|------|
| Init 系统 | `ps -p 1 -o comm=` 或 `cat /proc/1/comm` |
| 发行版 | `cat /etc/*release \| grep PRETTY_NAME` |
| 包管理器 | `which apt/apt-get/yum/dnf/pacman/...` |

### macOS 特定检测

| 检测项 | 方法 |
|--------|------|
| Init 系统 | 固定为 `launchd` |
| Homebrew | `which brew` |

### Windows 特定检测

| 检测项 | 命令 |
|--------|------|
| 包管理器 | `where choco/winget/scoop` |
| 服务管理 | `where sc/net` |

### 容器和虚拟化工具检测

检测列表：

| 工具 | 命令/路径检查 |
|------|---------------|
| docker | `docker` / 默认路径 |
| podman | `podman` |
| kubectl | `kubectl` |
| minikube | `minikube` |
| vagrant | `vagrant` |
| wsl | `wsl` |
| virtualbox | `VBoxManage` / 默认路径 |
| vmware | `vmrun` / 默认路径 |

---

## 依赖关系

| 依赖 | 用途 |
|------|------|
| `interface.ts` | `ITool`、`ToolContext` 接口 |
| `utils.ts` | `resolveUri` 函数 |
| `vscode` | VS Code API |
| `os` | 获取平台信息 |
| `fs` | 检查文件是否存在 |
| `child_process` | 执行系统命令 |

---

## 使用场景

### 场景 1：执行命令前了解环境

```typescript
// 1. 获取系统信息
const sysInfo = await systemInfoTool.execute({}, context);
console.log(sysInfo);

// 2. 根据环境执行相应命令
if (sysInfo.includes('Platform: win32')) {
    await shellExecTool.execute({
        uri: projectPath,
        cmd: 'dir',
        shell_path: 'C:\\Windows\\System32\\cmd.exe'
    }, context);
} else {
    await shellExecTool.execute({
        uri: projectPath,
        cmd: 'ls -la',
        shell_path: '/bin/bash'
    }, context);
}
```

### 场景 2：检查文件大小决定读取策略

```typescript
// 检查文件大小
const sizeInfo = await getFileSizeTool.execute({
    uri: '/workspace/project/large-file.log'
}, context);

// 解析大小
const match = sizeInfo.match(/([\d.]+) KB/);
const sizeKB = match ? parseFloat(match[1]) : 0;

// 决定读取策略
if (sizeKB > 500) {
    // 使用部分读取
    const partial = await partiallyReadByRangeTool.execute({
        uri: '/workspace/project/large-file.log',
        start_line: 1,
        end_line: 100
    }, context);
} else {
    // 完整读取
    const full = await readFileTool.execute({
        uri: '/workspace/project/large-file.log'
    }, context);
}
```

### 场景 3：检查环境变量

```typescript
// 检查 PATH
const path = await getEnvVarTool.execute({ name: 'PATH' }, context);

// 检查 Node 版本
const nodeEnv = await getEnvVarTool.execute({ name: 'NODE_ENV' }, context);
if (nodeEnv === 'production') {
    // 生产环境特定操作
}
```

### 场景 4：确定包管理器

```typescript
const sysInfo = await systemInfoTool.execute({}, context);

let installCmd: string;
if (sysInfo.includes('apt') || sysInfo.includes('apt-get')) {
    installCmd = 'sudo apt install';
} else if (sysInfo.includes('brew')) {
    installCmd = 'brew install';
} else if (sysInfo.includes('winget')) {
    installCmd = 'winget install';
}
```

---

## 最佳实践

### 1. 优先执行

在涉及系统操作的会话开始时，首先执行 `system_info`：

```typescript
// 好的实践
const sysInfo = await systemInfoTool.execute({}, context);
// ... 根据系统信息执行后续操作

// 避免直接执行系统命令而不了解环境
// await shellExecTool.execute({ cmd: 'some-command' }); // 不推荐
```

### 2. 大文件检查

对于任何文件读取操作，先检查大小：

```typescript
async function smartReadFile(uri: string, context: ToolContext) {
    const sizeInfo = await getFileSizeTool.execute({ uri }, context);
    const sizeKB = parseFloat(sizeInfo.match(/([\d.]+)/)?.[0] || '0');
    
    if (sizeKB > 500) {
        return partiallyReadByRangeTool.execute({
            uri, start_line: 1, end_line: 100
        }, context);
    }
    return readFileTool.execute({ uri }, context);
}
```

---

## 注意事项

1. **执行时间**：某些检测需要执行系统命令，可能需要几秒钟
2. **权限限制**：某些命令可能需要特定权限才能执行
3. **环境差异**：不同系统的输出格式可能有所不同
4. **工具可用性**：某些工具可能已安装但不在 PATH 中，检测可能不完整
