本项目（Mutsumi）是一个 VSCode LLM Agent 插件。

项目核心代码（包括插件注册、工具注册、Agent 基本功能的运作等）位于 src/。

UI 上，本项目使用 NotebookSerializer 呈现 Agent 对话页面，允许同时打开多个 Agent 窗口，使用边栏进行调度。

对话页面相关资料见 src/notebook/。

边栏UI相关见 src/sidebar/。

本插件支持内置工具调用，所有的内置工具实现位于 src/tools.d。

工具注册于 src/toolManager.ts。

本项目支持由用户和文档动态为 Agent 组装上下文。

例如在 User Prompt 和 rules 文档中使用 `@[……]` schema 将指定的文件（可指定具体行数）和强制预执行的工具调用结果插入到 SystemPrompt 中。

请你也使用该语法为子 Agents 提供完善的上下文。

动态上下文提供器模块见 src/contextManagement/。

当你需要检查该项目的错误时，请直接尝试执行 `npm run compile`, 这是最直观的。

该项目的原则是要兼容多根工作区和其他插件的 `FileSystemProvider` 指定的特殊 schema。

因此，代码中遇到所有涉及 Mutsumi 自身，又涉及工作区的操作，必须尝试从工作区列表 [0] 去读取 `.mutsumi` 目录（将工作区0作为 Mutsumi 主工作区）。你可以预设工作区[0]一定是本地的。

代码中涉及文件的操作，不到最后一步取出文件内容前，都必须使用 `vscode.Uri` 而非 Path。不同函数/方法、模块之间的通信，也必须使用 Uri 而不是 Path。