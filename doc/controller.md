# controller.ts 技术文档

## 文件功能概述

`controller.ts` 是 Mutsumi VSCode 插件的** Notebook 执行控制器**，作为 VSCode Notebook API 和 Agent 执行引擎之间的桥梁。它负责：

- 处理 Notebook 单元格的执行请求
- 管理执行生命周期（开始、结束、错误处理）
- 协调配置读取和上下文准备
- 与 `AgentOrchestrator` 同步 Agent 状态

---

## 主要类：AgentController

### 类属性

| 属性名 | 类型 | 说明 |
|--------|------|------|
| `tools` | `ToolManager` | 工具管理器实例 |
| `executionOrder` | `number` | 执行顺序计数器 |

---

### 核心方法

#### `execute(cells, notebook, controller): Promise<void>`

**功能**：执行指定的 Notebook 单元格（VSCode Notebook Controller 的入口点）。

**参数**：
| 参数名 | 类型 | 说明 |
|--------|------|------|
| `cells` | `vscode.NotebookCell[]` | 要执行的单元格数组 |
| `notebook` | `vscode.NotebookDocument` | Notebook 文档 |
| `controller` | `vscode.NotebookController` | Notebook 控制器 |

**工作流程**：
1. 获取 Notebook 的 UUID
2. 调用 `AgentOrchestrator.notifyAgentStarted()` 标记 Agent 开始运行
3. 遍历并处理每个单元格
4. 在 finally 块中调用 `AgentOrchestrator.notifyAgentStopped()`

---

#### `processCell(cell, notebook, controller): Promise<void>`

**功能**：处理单个 Notebook 单元格的执行。

**参数**：
| 参数名 | 类型 | 说明 |
|--------|------|------|
| `cell` | `vscode.NotebookCell` | 要执行的单元格 |
| `notebook` | `vscode.NotebookDocument` | Notebook 文档 |
| `controller` | `vscode.NotebookController` | Notebook 控制器 |

**详细工作流程**：

**1. 获取配置**
```typescript
const config = vscode.workspace.getConfiguration('mutsumi');
const apiKey = config.get<string>('apiKey');
const baseUrl = config.get<string>('baseUrl');
const model = config.get<string>('model') || 'gpt-3.5-turbo';
```

**2. 初始化执行**
- 创建 `NotebookCellExecution` 对象
- 设置执行顺序
- 记录开始时间

**3. 验证配置**
- 如果缺少 `apiKey`，显示错误并结束执行

**4. 设置取消机制**
```typescript
const abortController = new AbortController();
const tokenDisposable = execution.token.onCancellationRequested(() => {
    abortController.abort();
});
```

**5. 准备上下文**
- 调用 `buildInteractionHistory()` 构建交互历史
- 获取 `messages`, `allowedUris`, `isSubAgent`

**6. 初始化并运行 Agent**
```typescript
const runner = new AgentRunner(
    { apiKey, baseUrl, model },
    this.tools,
    notebook,
    allowedUris,
    isSubAgent
);
const newMessages = await runner.run(execution, abortController, messages);
```

**7. 保存元数据**
- 将新的交互消息保存到单元格元数据

**8. 清理**
- 结束执行
- 释放 `tokenDisposable`

---

## 错误处理

### 取消检测

```typescript
const isCancellation = 
    err.name === 'APIUserAbortError' || // OpenAI 特定错误
    err.name === 'AbortError' ||        // 标准中止错误
    execution.token.isCancellationRequested;

if (isCancellation) {
    execution.end(false, Date.now()); 
    return;
}
```

### 其他错误

- 显示错误输出
- 标记执行失败
- 记录结束时间

---

## 与其他模块的关系

```
AgentController
    ├── 被 extension.ts 创建
    ├── 被注册到 vscode.NotebookController.executeHandler
    ├── 使用 ToolManager 管理工具
    ├── 使用 AgentRunner 执行 Agent 循环
    ├── 调用 buildInteractionHistory() 准备上下文
    └── 与 AgentOrchestrator 同步状态（开始/停止）
```

---

## 配置项

Controller 读取以下 VSCode 配置：

| 配置项 | 键名 | 默认值 | 说明 |
|--------|------|--------|------|
| API Key | `mutsumi.apiKey` | - | OpenAI API 密钥 |
| Base URL | `mutsumi.baseUrl` | - | 自定义 API 端点 |
| Model | `mutsumi.model` | `gpt-3.5-turbo` | 使用的模型 |

---

## 使用示例

### 在 extension.ts 中注册

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
```

### 执行流程

```
用户点击执行按钮
    ↓
VSCode 调用 controller.executeHandler
    ↓
AgentController.execute(cells, notebook, controller)
    ↓
通知 AgentOrchestrator: Agent 开始
    ↓
遍历 cells 调用 processCell
    ↓
    ├─ 读取配置
    ├─ 创建执行对象
    ├─ 构建交互历史
    ├─ 创建 AgentRunner
    ├─ 运行 Agent
    ├─ 保存结果
    └─ 结束执行
    ↓
通知 AgentOrchestrator: Agent 停止
```
