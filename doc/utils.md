# utils.ts

## 概述

Mutsumi VSCode 插件的工具函数文件。提供对话分割、标题生成、文件名处理等实用功能。

## 函数

### `splitIntoRounds(messages: AgentMessage[]): AgentMessage[][]`

将对话按用户提示分割成轮次（私有函数）。

**参数：**
- `messages` - 完整的消息历史

**返回：**
- `AgentMessage[][]` - 消息数组的数组，每个子数组代表一轮对话

**逻辑：**
- 过滤掉 system 角色的消息
- 每轮从 user 消息开始，到下一个 user 消息之前结束
- 返回所有轮次的数组

---

### `generateTitle(messages, apiKey, baseUrl, model): Promise<string>`

基于对话上下文生成简洁标题。

**参数：**
- `messages` - 对话消息历史
- `apiKey` - OpenAI API 密钥
- `baseUrl` - OpenAI 基础 URL（可选）
- `model` - 用于标题生成的模型标识符

**返回：**
- `Promise<string>` - 生成的标题字符串

**功能流程：**
1. 分割对话为轮次
2. 取最近 6 轮对话（或全部，如果少于 6 轮）
3. 构建上下文 JSON（限制 4000 字符）
4. 调用 LLM 生成标题
5. 清理文件名（sanitizeFileName）
6. 截断至 30 字符

**标题要求提示词：**
- 长度 10-20 字符
- 不含特殊字符 `\/:*?"<>|`
- 仅返回标题文本，无解释或前缀

---

### `sanitizeFileName(name: string): string`

清理字符串，使其可作为安全的文件名。

**参数：**
- `name` - 原始名称

**返回：**
- `string` - 适合文件系统使用的清理后名称

**清理规则：**
1. 将 `\/:?"<>|` 替换为 `-`
2. 将多个空格压缩为单个空格
3. 去除首尾空格

**示例：**
```typescript
sanitizeFileName('file:name?test'); // "file-name-test"
```

---

### `ensureUniqueFileName(baseName, existingNames): string`

确保文件名唯一，必要时添加数字后缀。

**参数：**
- `baseName` - 无扩展名的基础文件名
- `existingNames` - 现有文件名数组，用于检查

**返回：**
- `string` - 唯一的文件名

**逻辑：**
1. 如果 `baseName` 不在 `existingNames` 中，直接返回
2. 否则尝试 `baseName-1`、`baseName-2`...直到找到不存在的名称

**示例：**
```typescript
ensureUniqueFileName('agent', ['agent', 'agent-1']); // "agent-2"
```

## 函数关系

```
generateTitle
├── splitIntoRounds
└── sanitizeFileName

ensureUniqueFileName (独立)
```

## 使用场景

| 函数 | 使用场景 |
|------|----------|
| `generateTitle` | 自动重命名 notebook 文件时生成描述性标题 |
| `sanitizeFileName` | 清理用户输入或 LLM 生成的文件名 |
| `ensureUniqueFileName` | 创建新 agent 文件时避免覆盖现有文件 |
