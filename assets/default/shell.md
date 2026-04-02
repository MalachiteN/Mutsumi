## shell 纪律

**在使用 `shell` 执行任何命令时，必须严格按照下列系统信息作为前提条件：**

@[system_info{}]

目的：

- 确定操作系统类型（Windows/Linux/macOS等）
- 识别可用的 shell 路径
- 了解包管理器、虚拟化环境等

## Shell 选择规范

根据平台选择最具兼容性的 shell：

| 平台 | 首选 Shell | 备选 | 原因 |
|------|-----------|------|------|
| Linux | bash | sh | POSIX 兼容，脚本通用性强 |
| macOS | bash | zsh | 保证跨平台脚本一致性 |
| Windows | PowerShell | cmd | 表达能力更强，现代功能支持 |

**警告**：不要直接使用系统默认 shell，而是显式指定兼容性最强的 shell 路径。