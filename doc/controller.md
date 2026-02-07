# controller.ts

## 概述

Agent 控制器，负责执行 notebook 单元格。管理 agent 执行的生命周期，包括配置加载、单元格处理和与 AgentRunner 的协调。

## 类

### `AgentController`

控制 agent notebook 的执行。

#### 属性

| 属性 | 类型 | 说明 |
|------|------|------|
| `tools` | `ToolManager` | 工具管理器实例，为 agent 提供工具 |
| `executionOrder` | `number` | 执行顺序计数器，跟踪单元格执行序列 |

#### 构造函数

```typescript
constructor()
```

创建新的 AgentController 实例，初始化工具管理器和执行顺序计数器。

#### 方法

##### `execute(cells, notebook, controller): Promise<void>`

执行一个或多个 notebook 单元格。

**参数：**
- `cells` - 要执行的单元格数组
- `notebook` - notebook 文档
- `controller` - notebook 控制器

**功能：**
- 通知 orchestrator agent 开始执行
- 依次处理每个单元格
- 通知 orchestrator agent 停止执行（无论成功或失败）

---

##### `processCell(cell, notebook, controller): Promise<void>`

处理单个 notebook 单元格（私有方法）。

**参数：**
- `cell` - 要处理的单元格
- `notebook` - notebook 文档
- `controller` - notebook 控制器

**执行流程：**

1. **加载配置**
   - apiKey、baseUrl、models、defaultModel
   - 从 notebook metadata 或配置获取 model

2. **检查 API Key**
   - 未设置时显示错误并结束执行

3. **创建执行会话**
   - 创建 NotebookCellExecution
   - 设置执行顺序
   - 启动执行计时

4. **设置取消处理**
   - 创建 AbortController
   - 监听取消请求，触发 abort

5. **构建交互历史**
   - 调用 `buildInteractionHistory`
   - 获取消息历史、允许的 URI、是否子 agent

6. **运行 Agent**
   - 创建 AgentRunner 实例
   - 调用 `runner.run()` 执行 agent 循环
   - 获取新生成的消息

7. **保存元数据**
   - 将交互历史保存到单元格 metadata
   - metadata 键为 `mutsumi_interaction`

8. **错误处理**
   - 区分取消错误（正常结束）
   - 其他错误显示在单元格输出中

9. **清理**
   - 释放 token 监听器

## 重要实现细节

### 配置优先级
1. Notebook metadata 中的 model
2. VSCode 配置中的 defaultModel
3. 默认 'gpt-3.5-turbo'

### 取消处理
- 使用 AbortController 支持取消
- 检查错误类型：APIUserAbortError、AbortError、isCancellationRequested
- 取消时正常结束执行，不显示错误

### 元数据存储
- 交互历史存储在单元格 metadata 的 `mutsumi_interaction` 字段
- 使用 WorkspaceEdit 和 NotebookEdit 更新元数据

### 执行顺序
- 使用 `executionOrder` 计数器递增
- 每个单元格执行有唯一的顺序号
