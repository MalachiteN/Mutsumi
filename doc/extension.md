# extension.ts 技术文档

## 文件功能概述

`extension.ts` 是 Mutsumi VSCode 插件的**入口文件**，负责插件的激活和停用。它：

- 注册所有核心组件（Notebook Serializer、Controller、Sidebar 等）
- 设置事件监听器（文件打开、关闭、删除）
- 注册命令（新建 Agent、打开文件、复制引用等）
- 初始化各种服务

这是 VSCode 加载插件时首先执行的文件。

---

## 主要函数

### `activate(context: vscode.ExtensionContext): void`

**功能**：插件激活时调用，初始化所有组件。

**参数**：
- `context` - VSCode 扩展上下文，用于管理订阅资源

**完整初始化流程**：

#### 1. 初始化代码库服务

```typescript
CodebaseService.getInstance().initialize(context).catch(console.error);
```

- 初始化代码库索引服务
- 用于代码搜索和分析

#### 2. 注册 Notebook Serializer

```typescript
context.subscriptions.push(
    vscode.workspace.registerNotebookSerializer(
        'mutsumi-notebook',
        new MutsumiSerializer(),
        { transientOutputs: true }
    )
);
```

- 注册 `.mtm` 文件的序列化器
- `transientOutputs: true` 表示输出不保存到磁盘

#### 3. 设置侧边栏

```typescript
const sidebarProvider = new AgentSidebarProvider(context.extensionUri);
sidebarProvider.registerTreeView(context);
AgentOrchestrator.getInstance().setSidebar(sidebarProvider);
```

- 创建侧边栏提供者
- 注册 TreeView
- 设置到 Orchestrator

#### 4. 创建并注册 Controller

```typescript
const agentController = new AgentController();
const controller = vscode.notebooks.createNotebookController(
    'mutsumi-agent',
    'mutsumi-notebook',
    'Mutsumi Agent'
);
controller.supportedLanguages = ['markdown'];
controller.supportsExecutionOrder = true;
controller.executeHandler = (cells, notebook, ctrl) => {
    agentController.execute(cells, notebook, ctrl);
};
AgentOrchestrator.getInstance().registerController(agentController, controller);
```

- 创建 AgentController
- 创建 NotebookController
- 设置执行处理器
- 注册到 Orchestrator

#### 5. 设置生命周期事件监听

**Notebook 打开事件**：
```typescript
vscode.workspace.onDidOpenNotebookDocument(doc => {
    if (doc.notebookType === 'mutsumi-notebook') {
        const uuid = doc.metadata.uuid;
        if (uuid) {
            AgentOrchestrator.getInstance().notifyNotebookOpened(uuid, doc.uri, doc.metadata);
        }
    }
})
```

**Notebook 关闭事件**：
```typescript
vscode.workspace.onDidCloseNotebookDocument(doc => {
    if (doc.notebookType === 'mutsumi-notebook') {
        const uuid = doc.metadata.uuid;
        if (uuid) {
            AgentOrchestrator.getInstance().notifyNotebookClosed(uuid);
        }
    }
})
```

**文件删除监听**：
```typescript
const watcher = vscode.workspace.createFileSystemWatcher('**/*.mtm');
watcher.onDidDelete((uri) => {
    AgentOrchestrator.getInstance().notifyFileDeleted(uri);
});
```

#### 6. 注册自动补全

```typescript
const completionProvider = vscode.languages.registerCompletionItemProvider(
    'markdown',
    new ReferenceCompletionProvider(),
    '@'
);
```

- 在 Markdown 单元格中提供 `@` 触发的引用补全

#### 7. 注册图片粘贴支持

```typescript
context.subscriptions.push(
    vscode.languages.registerDocumentPasteEditProvider(
        { language: 'markdown' },
        new ImagePasteProvider(),
        { 
            pasteMimeTypes: ['image/png', 'image/jpeg'],
            providedPasteEditKinds: [vscode.DocumentDropOrPasteEditKind.Text]
        }
    )
);
```

- 注册 `ImagePasteProvider` 为 Markdown 单元格提供图片粘贴支持
- 支持粘贴 PNG 和 JPEG 格式的图片
- 用户可以直接将图片从剪贴板粘贴到 Notebook 单元格中

#### 8. 注册命令

**新建 Agent 命令** (`mutsumi.newAgent`)：
```typescript
vscode.commands.registerCommand('mutsumi.newAgent', async () => {
    // 1. 确保工作区文件夹存在
    // 2. 创建 .mutsumi 目录
    // 3. 初始化规则文件
    // 4. 创建新的 .mtm 文件
    // 5. 打开 Notebook 文档
});
```

**打开 Agent 文件** (`mutsumi.openAgentFile`)：
```typescript
vscode.commands.registerCommand('mutsumi.openAgentFile', async (item: AgentTreeItem) => {
    // 从侧边栏打开 Agent 文件
});
```

**复制引用** (`mutsumi.copyReference`)：
```typescript
vscode.commands.registerCommand('mutsumi.copyReference', async (uri?: vscode.Uri) => {
    // 复制文件/区域引用到剪贴板
    // 格式：@[path] 或 @[path:line] 或 @[path:start:end]
});
```

#### 9. 激活编辑支持

```typescript
activateEditSupport(context);
```

- 激活文件编辑相关的功能

---

### `deactivate(): void`

**功能**：插件停用时调用（当前为空实现）。

---

## 注册的命令列表

| 命令 ID | 功能 | 触发方式 |
|---------|------|----------|
| `mutsumi.newAgent` | 创建新的 Agent 文件 | 命令面板 |
| `mutsumi.openAgentFile` | 打开 Agent 文件 | 侧边栏右键 |
| `mutsumi.copyReference` | 复制文件引用 | 编辑器右键/资源管理器右键 |

---

## 与其他模块的关系

```
extension.ts
    ├── 创建并注册 MutsumiSerializer
    ├── 创建并设置 AgentSidebarProvider
    ├── 创建并注册 AgentController
    ├── 创建并注册 NotebookController
    ├── 初始化 CodebaseService
    ├── 注册 ReferenceCompletionProvider
    ├── 调用 activateEditSupport
    └── 与 AgentOrchestrator 交互（设置、注册、通知）
```

---

## 使用示例

### 新建 Agent 的完整流程

```typescript
// 1. 获取工作区根目录
const wsFolders = vscode.workspace.workspaceFolders;
const root = wsFolders[0].uri;

// 2. 创建 .mutsumi 目录
const agentDir = vscode.Uri.joinPath(root, '.mutsumi');
await vscode.workspace.fs.createDirectory(agentDir);

// 3. 初始化规则
await initializeRules(context.extensionUri, root);

// 4. 创建 .mtm 文件
const name = `agent-${Date.now()}.mtm`;
const newFileUri = vscode.Uri.joinPath(agentDir, name);
const initialContent = MutsumiSerializer.createDefaultContent([root.fsPath]);
await vscode.workspace.fs.writeFile(newFileUri, initialContent);

// 5. 打开文档
await vscode.window.showNotebookDocument(
    await vscode.workspace.openNotebookDocument(newFileUri)
);
```

### 复制引用格式

```
@[src/index.ts]           # 文件引用
@[src/index.ts:10]        # 行引用
@[src/index.ts:10:20]     # 区域引用（多行）
```

---

## 目录结构初始化

插件激活后会创建以下目录结构：

```
workspace/
├── .mutsumi/              # Agent 文件目录
│   ├── agent-xxx.mtm      # Agent Notebook 文件
│   └── prompts/           # 提示词规则目录
│       ├── codebase.md
│       ├── default.md
│       └── ...
└── ...
```
