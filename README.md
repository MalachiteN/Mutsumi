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

Mutsumi 是一款 VS Code LLM Agent 插件，采用**子母 Agent 范式**，将复杂任务拆解为多个子任务并行处理，让 LLM 的注意力始终聚焦于关键之处。

---

## ✨ 核心特性

### 🥳 子母 Agent 范式（Multi-Agent）

不同于传统单对话流的长对话模式，Mutsumi 实现了**多 Agent 协作**系统：

- **任务分治能力** — 将复杂任务分解为多个子任务，由子 Agent 并行处理
- **避免注意力稀释** — 防止长对话导致的生成质量降低
- **边栏调度中心** — 通过侧边栏集中管理所有 Agent 会话

### 📝 Notebook 原生体验

告别传统侧边栏对话，Mutsumi 利用 **NotebookSerializer**：

- **VSCode 编辑器窗格** — Agent 对话页面作为 `.mtm` 文件的 Notebook Editor，与其他文件并排打开
- **灵活窗口布局** — 支持分屏、多窗口，自由组织工作空间
- **持久化会话** — 对话历史持久化到 Notebook 数据，随时恢复工作状态

### 🔄 动态上下文系统

Mutsumi 采用六阶段动态上下文管理架构：

1. 环境与宏初始化 — 加载持久化的上下文状态和宏定义
2. System Prompt 构建 — 集成 Rules 和运行时环境
3. 用户输入解析 — TemplateEngine 递归处理文件引用
4. 增量快照与版本控制 — 智能检测变更，节省 Token
5. 持久化与元数据更新 — 保存幽灵块到 Cell Metadata
6. 最终消息组装 — 前缀一致，最大化利用 LLM 的 KV Cache

### 🛠️ 预处理器与宏支持

引用文件、Rules 和 Skills 支持**预处理器命令**。用户使用 `@{define 宏名, 值}` 一类的语句定义宏，然后可调用如下包含预处理器命令的文件：

```markdown
@{ifdef 宏名} ... @{endif}
```

本项目使用 [`preprocess`](https://github.com/jsoverson/preprocess) 库实现强大的预处理能力。

### 工具调用与文件引用预执行

当用户已知 LLM 必然需要某段文件内容或工具执行结果时，可以预先执行工具调用或文件引用，将结果插入上下文的幽灵块中，令 LLM 不必浪费宝贵的上下文预算来推理出自己需要调用工具，再浪费宝贵的API额度去反复发送会话历史记录。

```markdown
@[src/main.ts]                      ← 引用文件
@[src/utils.ts:10-20]               ← 引用指定行数
@[read_file{"uri": "path/to/file"}] ← 预执行工具
```

### 🌐 多工作区原生支持

几乎所有工具操作都原生支持**多工作区**，兼容：

- 多根工作区（Multi-root Workspaces）
- 其他插件的 `FileSystemProvider` 特殊 schema
- 任何支持读写的虚拟文件系统

---

## 🚀 快速开始

### 安装

```bash
# 从源码构建
npm install
npm run compile
vsce package

# 本地安装到 VS Code
code --install-extension mutsumi-【版本号】.vsix
```

### 配置

如果你使用一般的中转 API，在 VS Code 设置中配置 `mutsumi.apiKey`、`mutsumi.baseUrl` 等，即可开始使用。

### 创建第一个 Agent

1. 按 Ctrl+Shift+P 打开命令面板
2. 点击 **Mutsumi: New Agent** 创建新会话
3. 在 `.mtm` 笔记本文件中开始对话
4. 使用 `@[文件路径]` 语法引用代码文件

---

## 🛠️ 内置工具

Mutsumi 提供丰富的内置工具，支持智能任务执行：

- **文件操作** — `read_file`, `edit_file`, `create_file`, `ls`, `get_file_size`
- **代码搜索** — `search_file_contains_keyword`, `search_file_name_includes`, `project_outline`
- **执行控制** — `shell_exec`, `git_cmd`, `get_env_var`, `system_info`
- **文件编辑** — `edit_file_search_replace`, `edit_file_full_replace`
- **Agent 编排** — `self_fork`, `get_available_models`, `task_finish`

---

## 📝 动态上下文技术详解

### 递归文件引用与工具预执行的解析

使用 `@[路径]` 语法，TemplateEngine 会递归解析嵌套引用，并预执行工具调用：

```
用户输入: "阅读 @[doc/main.md]"
    ↓
发现 @[doc/main.md] → 读取文件、运行预处理器
    ↓
发现内部引用 @[doc/utils.md] → 递归解析
    ↓
返回展开后的完整内容（main.md 已包含 utils.md）
    ↓
发现其中包括的 @[ls{"uri": "path/to/codebase"}] → 预执行工具
```

**APPEND 模式**（顶层）：内容收集到幽灵块  
**INLINE 模式**（递归层）：内容直接替换原标签嵌入父文件

### 幽灵块（Ghost Block）结构

````markdown
<content_reference>
以下是用户使用@引用的文件（或其最新版本状态）：

# Source: src/utils.ts (v1)
> Content unchanged. See previous version (v1).

# Source: src/new-feature.ts (v2)
```typescript
... (完整的新内容) ...
```
</content_reference>
````

### 宏的生命周期

- **定义**：`@{define KEY, VALUE}`
- **作用域**：空间上影响 Prompt、文件路径、文件内容、工具参数
- **持久化**：写入 Notebook Metadata，跨轮次永久有效

---

## 🙏 Credits

本项目使用以下开源项目及其许可证声明：

### 核心依赖

| 项目 | 版本 | 许可证 | 用途 |
|------|------|--------|------|
| [openai](https://github.com/openai/openai-node) | ^6.17.0 | Apache-2.0 | OpenAI API 客户端 |
| [diff](https://github.com/kpdecker/jsdiff) | ^8.0.3 | BSD-3-Clause | 文本差异对比 |
| [gray-matter](https://github.com/jonschlinkert/gray-matter) | ^4.0.3 | MIT | Markdown 元数据解析 |
| [preprocess](https://github.com/jsoverson/preprocess) | ^3.2.0 | MIT | 文件预处理器宏 |
| [uuid](https://github.com/uuidjs/uuid) | ^9.0.1 | MIT | UUID 生成 |
| [web-tree-sitter](https://github.com/tree-sitter/tree-sitter) | ^0.22.2 | MIT | 语法树解析 |

感谢所有开源贡献者！🙏

---

## 📄 许可证

本项目采用 [Apache License 2.0](LICENSE) 开源许可证。

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/MalachiteN">MalachiteN</a>
</p>
