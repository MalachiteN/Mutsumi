# read_partial.ts

## 功能概述

`read_partial.ts` 实现了文件的部分读取工具，包括按行范围读取和按关键词搜索读取。这些工具用于高效处理大文件，避免读取整个文件内容，节省 Token 使用。

---

## 主要工具

### `partiallyReadByRangeTool` - 按行范围读取

| 属性 | 值 |
|------|-----|
| 名称 | `partially_read_by_range` |
| 描述 | 读取文件指定行范围的内容 |

**参数：**

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| `uri` | `string` | 是 | 文件 URI |
| `start_line` | `integer` | 是 | 起始行号（1-based） |
| `end_line` | `integer` | 是 | 结束行号（1-based） |

**执行流程：**

```
┌─────────────────────┐
│ 接收参数            │
│ (uri, start_line,   │
│  end_line)          │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 验证参数            │
│ 所有参数必须存在    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 解析 URI            │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 使用 openTextDocument│
│ 加载文档对象        │
│（处理编码和换行）    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 修正范围边界        │
│ - start: max(0, m-1)│
│ - end: min(lines-1, │
│   n-1)              │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 读取指定行          │
│ 添加行号前缀        │
│ "{lineNum}: {text}" │
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
| 范围无效 | `'(Range invalid or out of bounds)'` |
| 成功 | 带行号的指定范围内容 |

**输出格式：**

```
10: import { useState } from 'react';
11: 
12: export const Counter = () => {
13:   const [count, setCount] = useState(0);
14:   return (
```

---

### `partiallyReadAroundKeywordTool` - 按关键词搜索读取

| 属性 | 值 |
|------|-----|
| 名称 | `partially_read_around_keyword` |
| 描述 | 在文件中搜索关键词，返回匹配行及其上下文 |

**参数：**

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| `uri` | `string` | 是 | 文件 URI |
| `keyword` | `string` | 是 | 要搜索的字符串 |
| `lines_before` | `integer` | 是 | 匹配行前包含的行数 |
| `lines_after` | `integer` | 是 | 匹配行后包含的行数 |

**执行流程：**

```
┌─────────────────────┐
│ 接收参数            │
│ (uri, keyword,      │
│  lines_before,      │
│  lines_after)       │
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
│ 加载文档            │
│ openTextDocument()  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 遍历文档行          │
│ 查找包含关键词的行  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 收集上下文行        │
│ [match-a, match+a]  │
│ 使用 Set 去重       │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 排序并格式化        │
│ 不连续范围用...分隔 │
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
| 无匹配 | `'No matches found for "{keyword}".'` |
| 成功 | 带行号的匹配行及上下文 |

**输出格式：**

```
15: function oldFunction() {
16:   // some code
...
25: function handleClick() {
26:   console.log('clicked');
27:   updateState();
28: }
29: 
30: function anotherFunction() {
...
45: export { handleClick };
```

---

## 范围处理逻辑

### 行号转换

工具使用 1-based 行号（用户友好），内部转换为 0-based：

```typescript
const start = Math.max(0, m - 1);  // m 是用户输入的 start_line
const end = Math.min(lineCount - 1, n - 1);  // n 是用户输入的 end_line
```

### 边界保护

自动修正超出范围的行号：

```typescript
// 如果 start > end，返回范围无效
if (start > end) return '(Range invalid or out of bounds)';

// 确保不会超出文档边界
const start = Math.max(0, m - 1);
const end = Math.min(lineCount - 1, n - 1);
```

---

## 上下文合并

对于关键词搜索，多个匹配位置的上下文可能重叠，工具使用 `Set` 去重：

```typescript
const indicesToKeep = new Set<number>();

for (let i = 0; i < lineCount; i++) {
    if (lineText.includes(keyword)) {
        const start = Math.max(0, i - a);  // lines_before
        const end = Math.min(lineCount - 1, i + b);  // lines_after
        for (let j = start; j <= end; j++) {
            indicesToKeep.add(j);
        }
    }
}
```

---

## 依赖关系

| 依赖 | 用途 |
|------|------|
| `interface.ts` | `ITool`、`ToolContext` 接口 |
| `utils.ts` | `resolveUri` 函数 |
| `vscode` | VS Code API（openTextDocument、TextDocument） |

---

## 使用场景

### 场景 1：读取大文件的头部

```typescript
const header = await partiallyReadByRangeTool.execute({
    uri: '/workspace/project/large.log',
    start_line: 1,
    end_line: 50
}, context);
```

### 场景 2：查看特定函数

```typescript
// 先搜索函数定义
const functionDef = await partiallyReadAroundKeywordTool.execute({
    uri: '/workspace/project/src/app.ts',
    keyword: 'function processData',
    lines_before: 2,
    lines_after: 20
}, context);
```

### 场景 3：分析错误堆栈

```typescript
// 根据行号查看代码
const codeAtError = await partiallyReadByRangeTool.execute({
    uri: '/workspace/project/src/utils.ts',
    start_line: 145,
    end_line: 155
}, context);
```

### 场景 4：查找配置项

```typescript
// 搜索特定配置并查看上下文
const configContext = await partiallyReadAroundKeywordTool.execute({
    uri: '/workspace/project/config.json',
    keyword: '"database"',
    lines_before: 1,
    lines_after: 10
}, context);
```

---

## 最佳实践

### 1. 大文件策略

```typescript
// 先检查大小
const size = await getFileSizeTool.execute({ uri: filePath }, context);

if (parseFloat(size) > 500) {
    // 大文件：使用部分读取
    const lines = await partiallyReadByRangeTool.execute({
        uri: filePath,
        start_line: 1,
        end_line: 100
    }, context);
} else {
    // 小文件：完整读取
    const content = await readFileTool.execute({ uri: filePath }, context);
}
```

### 2. 精确定位代码

```typescript
// 先用搜索定位
const matches = await searchFileContainsKeywordTool.execute({
    uri: '/workspace/project/src',
    keyword: 'handleSubmit'
}, context);

// 再用部分读取查看详细代码
const code = await partiallyReadByRangeTool.execute({
    uri: extractFilePath(matches),
    start_line: extractLineNumber(matches),
    end_line: extractLineNumber(matches) + 30
}, context);
```

---

## 注意事项

1. **编码处理**：使用 `openTextDocument` 自动处理文件编码
2. **内存效率**：只加载请求的行，不读取整个文件
3. **行号格式**：返回的行号是 1-based，便于与错误消息对应
4. **上下文分隔**：关键词搜索中，不连续的匹配范围用 `...` 分隔
5. **性能**：对于非常大的文件，关键词搜索可能需要时间
