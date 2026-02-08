<!-- LOGO & HEADER SECTION -->
<div align="center">

  <h1>🥳 Mutsumi</h1>
  
  <p><strong>VS Code 多 Agent 笔记本环境</strong></p>
  
  <!-- TODO: 在此处添加 Shields.io 徽章 -->
  <!--
  [![Version](https://img.shields.io/visual-studio-marketplace/v/MalachiteN.mutsumi)](https://marketplace.visualstudio.com/items?itemName=MalachiteN.mutsumi)
  -->
  [![License](https://img.shields.io/github/license/MalachiteN/Mutsumi)](LICENSE)
  [![VS Code Version](https://img.shields.io/badge/VS%20Code-%5E1.108.0-blue)](https://code.visualstudio.com/)
  
  <!-- TODO: 在此处添加演示 GIF/截图 -->
  <!-- <img src="assets/demo.gif" alt="Mutsumi Demo" width="800"> -->
</div>

---

## ✨ 核心特性

### 📎 动态上下文组装与 `@[...]` / `@{...}` 语法

Mutsumi 的**核心创新**在于其强大的动态上下文系统，给予你确定性地控制 Agent 能看到什么的能力：

**文件与工具引用** (`@[...]`):

| 语法 | 说明 |
|------|------|
| `@[path/to/file]` | 引入整个文件内容 |
| `@[path/to/file:10]` | 引入特定行（第10行） |
| `@[path/to/file:10:20]` | 引入行范围（第10-20行） |
| `@[tool_name{"arg": "value"}]` | 预执行工具并注入结果 |

**预处理器命令** (`@{...}`) - 条件编译与宏定义：

| 语法 | 说明 |
|------|------|
| `@{define MACRO, "VALUE"}` | 定义一个宏 |
| `@{ifdef MACRO}` / `@{ifndef MACRO}` | 如果（未）定义了宏则包含内容 |
| `@{if MACRO IS "value"}` | 条件判断（IS/ISNT/CONTAINS/MATCHES...） |
| `@{else}` / `@{endif}` | 否则分支 / 结束条件块 |

另外，当你按下 `@` 时，就会弹出自动补全，无须学习，直接上手！

**可用于:**
- 用户 Prompt 中进行按需上下文注入
- Rules 文档（`.mutsumi/rules/*.md`）中创建可复用的上下文模板
- Skills 文档中定义自包含的能力

**效果**: 引用的文件和工具输出直接注入系统提示词，消除冗余工具调用并降低延迟。预处理器让你在单一规则文件中支持多平台、多环境的条件化配置。

<!-- TODO: 添加上下文组装截图 -->

### 👻 幽灵上下文块（Ghost Context Block）

通过创新的**幽灵上下文块**机制，引用的文件和 Rules 不再直接塞进 System Prompt，而是在运行时动态注入：

- **运行时注入**: 引用的文件和工具输出以 `<content_reference>` 标记块形式附加，在请求 LLM 前实时组装
- **零冗余**: 幽灵块内容不存储在对话历史中，避免 Token 浪费
- **即时更新**: 修改被引用的文件后，下次请求自动使用最新内容，无需重启对话
- **可视化审查**: 通过 Notebook 工具栏的 **"View Context Items"** 按钮查看当前会话的所有上下文项

这让大型项目的规则文档可以被多个 Agent 共享，同时保持对话历史的精简。

### 🎯 Skill 系统 - 参数化可复用能力

**Skills** 是可复用的能力模块，使用 Markdown 文件定义，支持预处理器宏：

```markdown
---
Description: "生成 API 端点文档"
Params:
  - language
  - endpoint
---

@{if language IS "zh"}
请用中文编写文档。
@{else}
Please write documentation in English.
@{endif}

为端点 `@{endpoint}` 生成包含以下内容的文档：
- 请求方法
- 参数说明
- 响应示例
```

**特点：**
- **参数化**: 通过 Front Matter 定义参数，Skill 被调用时自动展开为宏
- **条件编译**: 使用预处理器根据参数生成不同的提示词内容
- **自动发现**: 放在 `.mutsumi/skills/` 目录下的 `.skill.md` 文件自动注册为工具
- **缓存机制**: 编译后的 Skill 缓存到 `.mutsumi/skills/cache/`，避免重复解析

在对话中使用：`skill_name{"language": "zh", "endpoint": "/api/users"}`

### 🔄 子母 Agent 架构

基于动态上下文系统，Mutsumi 实现**子 Agent 系统**来处理复杂任务，同时降低 Token 成本：

- **Fork**: 母 Agent 使用 `self_fork` 生成子 Agent 来处理特定子任务
- **单一职责**: 每个子 Agent 专注于一个任务并立即返回，最小化上下文窗口占用，集中 Attention
- **成本优化**: 调度器 Agent 基于自然语言理解自主决定任务规模、分解策略，对简单子任务使用便宜模型（如 `stepfun/step-3.5-flash`），将昂贵模型（如 `google/gemini-3-pro-preview`）保留给复杂协调任务

### 📓 基于 Notebook 的对话界面

基于 VS Code 原生 Notebook API 构建，提供无缝的开发者体验：

- **`.mtm` 文件格式**: 自定义文件扩展名，以 JSON 格式存储 Agent 元数据和对话上下文
- **多 Agent 标签页**: 同时在多个笔记本标签页中工作
- **并行观察**: 分割编辑器窗格，并排监控多个 Agent 输出
- **持久化会话**: Agent 状态、历史和元数据跨会话保持
- **流式响应**: 实时逐 Token 显示，支持推理内容

**Notebook 工具栏:**
- 🔄 **切换模型**: 快速切换当前 Agent 使用的 LLM
- 📝 **重新生成标题**: 基于对话内容自动生成描述性标题
- 🐛 **Debug Context**: 查看完整的 LLM 上下文（包含 System、User、Assistant 消息）
- 📋 **View Context Items**: 查看当前注入的所有文件和 Rules
- 🔄 **Recompile Skills**: 重新编译所有 Skills（开发时使用）

<!-- TODO: 添加 Notebook UI 截图/GIF -->

### 🌳 侧边栏监控与控制

专用侧边栏视图，实现完整的 Agent 监管：

**Agent 树视图**
- 可视化 Agent 层级结构（母子关系）
- 实时监控状态：⚪ 待机 | 🔁 运行中 | 🕰️ 等待中 | ✅ 已完成
- 快速导航到任意 Agent 的笔记本

**审批队列**
- 审查具有潜在风险的待处理工具调用
- 一键批准/拒绝操作

<!-- TODO: 添加侧边栏截图 -->

### 🛠️ 内置工具生态系统

19+ 生产就绪工具，按权限级别组织：

**通用工具** (所有 Agent)
- 文件操作: `read_file`, `ls`, `mkdir`, `create_file`
- 编辑: `edit_file_full_replace`, `edit_file_search_replace`
- 导航: `partially_read_by_range`, `partially_read_around_keyword`
- 搜索: `search_file_contains_keyword`, `search_file_name_includes`
- 系统: `shell_exec`, `system_info`, `get_env_var`, `get_file_size`
- 版本控制: `git_cmd`
- 分析: `project_outline`, `get_warning_error`
- 元: `self_fork`, `get_available_models`

**子 Agent 专属**
- `task_finish`: 向母 Agent 报告任务完成

<!-- TODO: 添加工具使用示例 GIF -->

### 🌲 代码库分析

基于 Tree-sitter 的代码结构分析：

- **支持 30+ 语言**: TypeScript、Python、Rust、Go、Java、C/C++ 等
- **结构大纲**: 提取类、函数、方法及其层级关系
- **零配置**: 开箱即用，自动语言检测

### 🖼️ 多模态支持

- **图片粘贴**: 直接复制粘贴图片到对话中（自动保存到临时目录）
- **视觉模型**: 兼容支持图片输入的多模态 LLM
- **Markdown 集成**: 图片以标准 Markdown `![alt](uri)` 语法粘贴

### 🎯 开发者体验

- **@ 补全**: 输入 `@` 触发文件路径、目录、工具名和参数列表的 IntelliSense
- **自动生成标题**: 基于对话上下文由 LLM 生成描述性标题
- **快速切换模型**: 工具栏按钮随时切换 LLM 模型
- **系统提示调试**: 一键输出生成的完整 LLM 上下文用于故障排查

---

## 🚀 快速开始

### 环境要求

- VS Code `^1.108.0`
- OpenAI 兼容的 API 端点和 Key（OpenRouter、AIHubMix、ZenMux 等）

### 安装

<!-- TODO: 发布后更新 Marketplace 链接 -->
<!--
**从 VS Code Marketplace 安装**（推荐）
```
在扩展视图中搜索 "Mutsumi" → 安装
```
-->
**从 VSIX 安装**
```bash
# 从 Github Actions 下载最新的 .vsix
code --install-extension mutsumi-x.x.x.vsix
```

### 配置

打开 VS Code 设置（`Ctrl+,`）并配置：

| 设置项 | 说明 | 默认值 |
|---------|------|---------|
| `mutsumi.apiKey` | 你的 OpenAI API 密钥 | `""` |
| `mutsumi.baseUrl` | API 基础 URL | `https://api.openai.com/v1` |
| `mutsumi.models` | 可用模型及其标签 | 见下方 |
| `mutsumi.defaultModel` | 默认 Agent 模型 | `moonshotai/kimi-k2.5` |
| `mutsumi.titleGeneratorModel` | 自动生成标题所用模型 | `stepfun/step-3.5-flash` |

**推荐的模型配置：**

```json
{
  "mutsumi.models": {
    "stepfun/step-3.5-flash": "速度超快，偶有幻觉，适合简单任务",
    "moonshotai/kimi-k2.5": "性能与成本平衡，适合一般编码",
    "google/gemini-3-pro-preview": "极高智能，适合复杂架构规划",
    "openai/gpt-5.2-codex": "高级推理，适合复杂编码任务",
    "anthropic/claude-haiku-4.5": "可靠的代码阅读和文档生成"
  }
}
```

### 创建你的第一个 Agent

1. **打开命令面板**（`Ctrl+Shift+P`）
2. 运行: `Mutsumi: New Agent`
3. 一个新的 `.mtm` 文件将在 Notebook 编辑器中打开
4. 输入你的提示词并按 `Ctrl+Enter` 执行

**带上下文引用的示例：**
```
请分析这个文件并给出改进建议：
@[src/utils.ts]
@[src/main.ts:10:30]
```

**使用预处理器实现条件化提示:**
```
@{if LANG IS "zh"}
请用中文回答
@{else}
Please answer in English
@{endif}
```

**在 User Prompt 中定义宏：**
```
@{define TASK, "refactoring"}
@{define TARGET, "src/core/*.ts"}

请完成 @{TASK} 任务，目标文件：@{TARGET}
```

<!-- TODO: 添加快速开始 GIF -->

---

## 📖 使用指南

### 母子 Agent 工作流

在母 Agent 中请求任务分解：
```markdown
分析这个大型代码库并重构认证模块。
使用 self_fork 来委托：
1. 一个 Agent 分析当前认证实现
2. 一个 Agent 研究最佳实践
3. 一个 Agent 设计新架构
```

调度器将：
1. 创建 3 个子 Agent，分配适当的提示词
2. 根据任务复杂度分配合适的模型
3. 阻塞等待所有结果
4. 综合最终建议

### 编写带上下文的 Rules

创建 `.mutsumi/rules/my_rule.md`：

```markdown
# 我的项目规则

在进行更改前始终引用这些文件：
@[src/config.ts]
@[src/types.ts:1:50]

处理数据库时：
@[shell_exec{"uri": "path/to/db", "cmd": "sqlite3 example.db 'SELECT * FROM attrs;'", "shell_path": "/usr/bin/bash"}]
```

### 创建自定义 Skills

创建 `.mutsumi/skills/my_skill.skill.md`：

```markdown
---
Description: "根据参数生成不同类型的代码注释"
Params:
  - lang
  - style
---

@{if lang IS "zh"}
用中文生成
@{else}
Generate in English
@{endif}

风格要求：@{style}
```

在对话中调用：`my_skill{"lang": "zh", "style": "JSDoc"}`

### 预处理器命令详解

**宏定义与条件编译:**
```
@{define ENV, "development"}
@{define VERSION, "2.0.0"}

@{ifdef DEBUG}
调试信息：当前处于调试模式
@{endif}

@{if VERSION MATCHES "^2\\."}
这是 2.x 版本的功能
@{else}
这是旧版本兼容代码
@{endif}
```

**支持的测试操作符:**
- `IS` / `ISNT`: 完全相等 / 不相等
- `CONTAINS` / `DOESNT_CONTAIN`: 包含 / 不包含子串
- `MATCHES` / `DOESNT_MATCH`: 正则匹配 / 不匹配

**嵌套条件:**
```
@{ifdef OUTER}
外部条件
@{ifdef INNER}
内部条件
@{endif}
@{endif}
```

### 预执行工具

强制工具执行并将结果注入上下文：

```
开始前，这是当前项目结构：
@[ls{"uri": "."}]

以及 Git 状态：
@[git_cmd{"args": "status --short"}]
```

### 调试上下文

点击 Notebook 工具栏的 **"Debug Context"** 按钮，可查看：
- 完整的 LLM 消息列表（System / User / Assistant）
- 幽灵块中注入的文件内容
- 实际发送给模型的完整上下文

这对于排查为什么 Agent "看不到" 某个文件特别有用。

---

## 🛡️ 安全与隐私

- **URI 白名单**: 每个 Agent 都有可配置的 `allowed_uris`，限制文件系统访问
- **权限分离**: 子 Agent 不能使用母 Agent 专属工具；母 Agent 不能触发 `task_finish`
- **审批系统**: 具有潜在风险的操作（Shell 执行、文件删除）需要用户显式批准
- **无遥测**: 所有 API 调用直接发送到你配置的端点；数据不会经过我们的服务器（well actually 我们根本没服务器）

---

## 🤝 贡献

### 开发环境搭建

```bash
git clone https://github.com/MalachiteN/Mutsumi.git
cd Mutsumi
npm install
npm run compile
# 在 VS Code 中按 F5 启动扩展开发主机
```

---

## 📝 许可证

[Apache 2.0](LICENSE) © MalachiteN

---

## 🙏 致谢

- 基于 [VS Code Notebook API](https://code.visualstudio.com/api/extension-guides/notebook) 构建
- 代码解析由 [Tree-sitter](https://tree-sitter.github.io/tree-sitter/) 提供支持
- OpenAI 客户端库用于 LLM 交互

---

<div align="center">
  
  **Made with ❤️ by Malachite**
  
</div>
