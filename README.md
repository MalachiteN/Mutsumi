# Mutsumi - 好想成为人类啊😭

Mutsumi 是一个~~多首的怪物~~ VSCode 的 AI Agent 插件。它也是一个集成了 **NotebookSerializer UI**、**分治能力** 的开发辅助工具。

## 特性

*   **Notebook 交互界面**：摒弃传统的聊天边栏，利用 VSCode 原生 Notebook 渲染富文本、代码块和 diff 视图，提供清晰的上下文管理。
*   **多 Agent 协作**：支持主 Agent 将复杂任务拆解，通过 `self_fork` 机制创建并行的子 Agent 执行独立子任务 ~~🥷若叶睦那么多首啊~~。
*   **工程思维**：内置的 Mutsumi Agent 能够分析项目结构、读取代码签名并进行任务分解。

## 如何编译

本项目采用 TypeScript 开发，以下是标准的调试和打包流程。

### 环境准备
```bash
npm install
```

### 测试运行
1.  执行编译命令：
    ```bash
    npm run compile
    ```
2.  在 VSCode 中按 `F5` (在弹出的“选择调试器”窗口中选择 "VSCode 扩展开发")。
3.  这将打开一个新的扩展开发宿主窗口，你可以在其中测试插件功能。

### 打包安装

执行以下命令生成 `.vsix` 安装包：
```bash
npm run package
```

或直接 `vsce package`。

## 关于文档目录 (`doc/`) 的重要说明

⚠️ **人类开发者请注意：没有人类了！** ⚠️

项目根目录下的 `doc/` 目录及其内容是 **完全由 AI 生成** 的。
*   **用途**：这些文件旨在作为 AI Agents (包括 Mutsumi 自身) 的上下文参考和知识库。
*   **准确性警告**：内容可能包含 "AI 味" 很重的表述、逻辑偏差、甚至幻觉。
*   **阅读建议**：**严重不建议人类阅读**。请勿将其视为该项目的官方技术文档或绝对真理。

## 快速上手

1.  安装插件。
2.  按 Ctrl+Shift+P 打开命令面板，输入或选择 Mutsumi: New Agent。
3.  在 Cell 中输入你的指令（例如："分析当前项目的目录结构"）并 Shift+Enter 开始执行。
4.  关注 VSCode 侧边栏，批准 Agent 的执行请求。

## License

[Apache 2.0](LICENSE)