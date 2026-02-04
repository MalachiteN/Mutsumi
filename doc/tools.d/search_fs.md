# search_fs.ts

## 功能概述

`search_fs.ts` 实现了文件系统搜索工具，包括文件内容搜索和文件名搜索。这些工具帮助 Agent 在项目中快速定位文件和代码片段。

---

## 主要工具

### `searchFileContainsKeywordTool` - 文件内容搜索

| 属性 | 值 |
|------|-----|
| 名称 | `search_file_contains_keyword` |
| 描述 | 在文件中搜索关键词。返回文件路径和行号。等效于 `grep -rn keyword uri` |

**参数：**

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| `uri` | `string` | 是 | 开始搜索的目录 URI |
| `keyword` | `string` | 是 | 要搜索的关键词 |

**执行流程：**

```
┌─────────────────────┐
│ 接收参数            │
│ (uri, keyword)      │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 验证参数            │
│ uri 和 keyword      │
│ 不能为空            │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 构建搜索模式        │
│ - 根目录: uri       │
│ - 模式: **/*        │
│ - 遵循 .gitignore   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 查找文件列表        │
│ vscode.workspace.   │
│   findFiles()       │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 并发搜索文件内容    │
│ Promise.all()       │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 返回结果            │
└─────────────────────┘
```

**返回值：**

| 情况 | 返回值 |
|------|--------|
| 参数缺失 | `'Error: Missing arguments.'` |
| 无文件 | `'No files found in directory.'` |
| 无匹配 | `'No matches found.'` |
| 成功 | 格式化的匹配结果列表 |

**输出格式：**

```
relative/path/file1.ts:15:    const result = keyword + value;
relative/path/file1.ts:42:    function processKeyword() {
another/file.js:8:  import { keyword } from './utils';
```

格式：`{relativePath}:{lineNumber}:{lineContent}`

**行长度限制**：单行超过 300 字符会被截断并添加 `...`

---

### `searchFileNameIncludesTool` - 文件名搜索

| 属性 | 值 |
|------|-----|
| 名称 | `search_file_name_includes` |
| 描述 | 查找文件名包含指定字符串的文件。等效于 `find uri -name "*name_includes*"` |

**参数：**

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| `uri` | `string` | 是 | 开始搜索的目录 URI |
| `name_includes` | `string` | 是 | 文件名必须包含的字符串 |

**执行流程：**

```
┌─────────────────────┐
│ 接收参数            │
│ (uri, name_includes)│
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 验证参数            │
│ uri 和 name_includes│
│ 不能为空            │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 构建 Glob 模式      │
│ **/*{name_includes}*│
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 查找匹配文件        │
│ 最大 200 个结果     │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 返回文件列表        │
└─────────────────────┘
```

**返回值：**

| 情况 | 返回值 |
|------|--------|
| 参数缺失 | `'Error: Missing arguments.'` |
| 无匹配 | `'No files found.'` |
| 成功 | 相对路径列表（每行一个） |

**输出格式：**

```
src/components/Button.tsx
src/components/Modal.tsx
src/utils/button-helpers.ts
tests/Button.test.tsx
```

**结果限制**：最多返回 200 个文件

---

## 搜索优化

### 内容搜索优化

1. **二进制文件过滤**：自动跳过包含 `\0` 字符的文件
   ```typescript
   if (content.includes('\0')) return null;
   ```

2. **VS Code 集成**：使用 `findFiles` 自动遵循 `.gitignore` 和 `files.exclude` 设置

3. **并发处理**：使用 `Promise.all` 并发读取多个文件
   ```typescript
   const searchPromises = files.map(async (fileUri) => { /* ... */ });
   const results = await Promise.all(searchPromises);
   ```

### 文件名搜索优化

使用 VS Code 的 Glob 模式匹配，高效过滤文件名：

```typescript
const pattern = `**/*${name_includes}*`;
const relativePattern = new vscode.RelativePattern(rootUri, pattern);
const files = await vscode.workspace.findFiles(relativePattern, null, 200);
```

---

## 依赖关系

| 依赖 | 用途 |
|------|------|
| `interface.ts` | `ITool`、`ToolContext` 接口 |
| `utils.ts` | `resolveUri` 函数 |
| `vscode` | VS Code API（findFiles、workspace.fs） |
| `util` | `TextDecoder` 用于解码文件内容 |

---

## 使用场景

### 场景 1：查找函数使用位置

```typescript
const usages = await searchFileContainsKeywordTool.execute({
    uri: '/workspace/project/src',
    keyword: 'useCustomHook'
}, context);
// 结果: components/User.tsx:15:  const data = useCustomHook();
```

### 场景 2：查找 TODO 注释

```typescript
const todos = await searchFileContainsKeywordTool.execute({
    uri: '/workspace/project',
    keyword: 'TODO'
}, context);
```

### 场景 3：查找组件文件

```typescript
const buttonFiles = await searchFileNameIncludesTool.execute({
    uri: '/workspace/project/src',
    name_includes: 'Button'
}, context);
// 结果: components/Button.tsx, Button.test.tsx, Button.styles.css
```

### 场景 4：查找配置文件

```typescript
const configs = await searchFileNameIncludesTool.execute({
    uri: '/workspace/project',
    name_includes: 'config'
}, context);
```

### 场景 5：定位特定变量

```typescript
// 1. 搜索变量名
const matches = await searchFileContainsKeywordTool.execute({
    uri: '/workspace/project',
    keyword: 'MAX_RETRY_COUNT'
}, context);

// 2. 确定定义位置
const definition = matches.split('\n')[0];

// 3. 读取完整定义
const [filePath, lineNum] = parseMatch(definition);
const code = await partiallyReadByRangeTool.execute({
    uri: filePath,
    start_line: parseInt(lineNum),
    end_line: parseInt(lineNum) + 5
}, context);
```

---

## 注意事项

1. **大小写敏感**：搜索是大小写敏感的，`keyword` 和 `Keyword` 被视为不同
2. **部分匹配**：支持部分匹配，搜索 `handle` 会匹配 `handleClick` 和 `onHandle`
3. **性能考虑**：大型项目搜索可能需要时间，内容搜索会自动遵循 `.gitignore`
4. **结果限制**：文件名搜索限制 200 个结果，防止输出过长
5. **行长度**：内容搜索结果中，超过 300 字符的行会被截断
6. **编码假设**：内容搜索假设文件是文本文件，自动跳过二进制文件
