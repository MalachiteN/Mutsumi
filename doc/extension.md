# extension.ts

## 概述

VSCode Mutsumi 插件的主入口文件。负责插件的激活、注册所有组件（notebook序列化器、侧边栏、控制器、命令等），以及处理各种事件监听。

## 函数

### `fileExists(uri: vscode.Uri): Promise<boolean>`

检查指定 URI 的文件是否存在。

**参数：**
- `uri` - 要检查的 URI

**返回：**
- `Promise<boolean>` - 文件存在返回 true

---

### `activate(context: vscode.ExtensionContext): void`

激活插件的主函数。注册所有扩展组件，包括：
- Notebook 序列化器（mutsumi-notebook 类型）
- 侧边栏提供器
- Notebook 控制器
- 事件监听器（打开/关闭 notebook、保存自动重命名、文件删除监控）
- 代码补全提供器（用于 @ 引用语法）
- 图片粘贴支持
- 各种命令（新建Agent、选择模型、重新生成标题等）

**参数：**
- `context` - VSCode 扩展上下文，用于注册可释放资源

**主要功能流程：**
1. 初始化代码库服务
2. 注册 notebook 序列化器
3. 设置侧边栏并注册到 orchestrator
4. 创建 notebook 控制器并设置执行处理器
5. 注册各种事件监听器（打开/关闭 notebook、自动重命名、文件删除）
6. 注册代码补全提供器（@ 触发）
7. 注册图片粘贴支持
8. 注册所有命令
9. 激活编辑支持

---

### `registerCommands(context: vscode.ExtensionContext): void`

注册所有插件命令。

**注册的命令：**

| 命令 | 命令ID | 功能 |
|------|--------|------|
| 新建Agent | `mutsumi.newAgent` | 在 .mutsumi 目录创建新的 agent 文件 |
| 选择模型 | `mutsumi.selectModel` | 为当前 notebook 选择 LLM 模型 |
| 重新生成标题 | `mutsumi.regenerateTitle` | 基于对话内容生成新标题 |
| 调试系统提示 | `mutsumi.debugSystemPrompt` | 输出当前系统提示到输出面板 |
| 打开Agent文件 | `mutsumi.openAgentFile` | 从侧边栏打开 agent 文件 |
| 复制引用 | `mutsumi.copyReference` | 复制文件引用到剪贴板（支持行号范围） |

---

### `deactivate(): void`

插件停用时的清理函数。当前为空实现。

## 重要实现细节

### 自动重命名机制
- 保存 notebook 时，根据 metadata.name 自动重命名文件
- 处理文件名冲突（添加 -1, -2 后缀）
- 使用 isAutoRenaming 标志防止递归

### 文件引用格式
- 完整文件：`@[path/to/file]`
- 单行：`@[path/to/file:line]`
- 多行范围：`@[path/to/file:start:end]`

### 模型选择
- 从配置 `mutsumi.models` 读取可用模型列表
- 更新 notebook metadata 中的 model 字段

### 标题生成
- 需要配置 `mutsumi.apiKey` 和 `mutsumi.titleGeneratorModel` 或 `mutsumi.defaultModel`
- 收集 notebook 中所有 code cell 的对话历史
- 调用 LLM 生成 10-30 字符的标题
