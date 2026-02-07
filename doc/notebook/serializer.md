# serializer.ts

## 功能概述

Mutsumi Notebook 序列化器。负责将 Agent 对话数据与 VS Code Notebook 格式相互转换，实现对话的保存和加载功能。

## MutsumiSerializer 类

实现 `vscode.NotebookSerializer` 接口。

### 数据格式

存储格式为 JSON，结构如下：

```typescript
{
  metadata: {
    uuid: string;              // 唯一标识
    name: string;              // Agent 名称
    created_at: string;        // 创建时间
    parent_agent_id: string | null;  // 父 Agent ID
    allowed_uris: string[];    // 允许访问的 URI 列表
    model?: string;            // 使用的模型（可选）
  },
  context: AgentMessage[]      // 对话消息列表
}
```

### 方法

#### deserializeNotebook

将字节数据反序列化为 Notebook 数据。

**参数**

| 参数名 | 类型 | 说明 |
|--------|------|------|
| content | `Uint8Array` | 文件内容的字节数组 |
| _token | `vscode.CancellationToken` | 取消令牌 |

**返回值**

`Promise<vscode.NotebookData>` - 解析后的 Notebook 数据

**处理逻辑**

1. 解析 JSON 失败时创建默认 Agent 上下文
2. 按角色分类转换消息为单元格：
   - `user` → Code 单元格（可执行）
   - `system` → Markup 单元格
   - `assistant`/`tool` → Markup 单元格（显示为输出）
3. 将关联的 assistant/tool 消息分组显示为单元格输出

#### serializeNotebook

将 Notebook 数据序列化为字节数据。

**参数**

| 参数名 | 类型 | 说明 |
|--------|------|------|
| data | `vscode.NotebookData` | Notebook 数据 |
| _token | `vscode.CancellationToken` | 取消令牌 |

**返回值**

`Promise<Uint8Array>` - 序列化后的字节数组

**处理逻辑**

1. 遍历所有单元格
2. 根据 `metadata.role` 恢复消息角色
3. 从 `metadata.mutsumi_interaction` 提取关联消息
4. 输出格式化的 JSON

#### createDefaultContent (静态方法)

创建默认的 Notebook 内容。

**参数**

| 参数名 | 类型 | 说明 |
|--------|------|------|
| allowedUris | `string[]` | 允许的 URI 列表 |

**返回值**

`Uint8Array` - 编码后的默认内容

**说明**

- 从 VS Code 配置读取 `mutsumi.defaultModel` 作为默认模型
- 生成新的 UUID 和创建时间戳

### 私有方法

#### renderInteractionToMarkdown

将消息组渲染为 Markdown 格式。

**输入**: `AgentMessage[]`

**输出**: Markdown 字符串

**渲染规则**

| 消息角色 | 渲染方式 |
|----------|----------|
| assistant (reasoning_content) | 可折叠的 Thinking 区块 |
| assistant (content) | 普通文本 |
| assistant (tool_calls) | 工具调用引用块 |
| tool | 可折叠的结果区块（截断显示） |

#### serializeContentToString

将消息内容序列化为字符串。

**处理类型**

- `string`：直接返回
- `null`/`undefined`：返回空字符串
- 多模态数组：
  - `text` 类型 → 文本内容
  - `image_url` 类型 → Markdown 图片标签

### 使用示例

```typescript
const serializer = new MutsumiSerializer();

// 加载 Notebook
const notebookData = await serializer.deserializeNotebook(fileContent, token);

// 保存 Notebook
const bytes = await serializer.serializeNotebook(notebookData, token);
await vscode.workspace.fs.writeFile(uri, bytes);

// 创建新文件
const content = MutsumiSerializer.createDefaultContent(['/workspace/project']);
await vscode.workspace.fs.writeFile(uri, content);
```
