# read_file.ts

## 功能概述

`read_file.ts` 实现了完整的文件内容读取工具。它是文件系统操作的基础工具，允许 Agent 读取任何文本文件的完整内容。

---

## 主要工具

### `readFileTool`

| 属性 | 值 |
|------|-----|
| 名称 | `read_file` |
| 描述 | 读取给定 URI 处文件的完整内容 |

**参数：**

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| `uri` | `string` | 是 | 要读取的文件 URI 或路径 |

**执行流程：**

```
┌─────────────────────┐
│ 接收参数 uri        │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 验证 uri 参数       │
│ 不能为空            │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 解析输入为 VS Code  │
│ URI                 │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 读取文件字节        │
│ vscode.workspace.fs.│
│   readFile()        │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 解码为 UTF-8 文本   │
│ TextDecoder         │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 返回文件内容        │
└─────────────────────┘
```

**返回值：**

| 情况 | 返回值 |
|------|--------|
| 参数缺失 | `'Error: Missing "uri" argument.'` |
| 成功 | 文件的完整文本内容 |
| 错误 | `'Error reading file: {error}'` |

---

## 文件编码

工具使用 `TextDecoder` 将文件字节解码为 UTF-8 文本：

```typescript
const bytes = await vscode.workspace.fs.readFile(uri);
return new TextDecoder().decode(bytes);
```

支持 UTF-8 编码的文本文件。对于其他编码的文件，可能需要特殊处理。

---

## 依赖关系

| 依赖 | 用途 |
|------|------|
| `interface.ts` | `ITool`、`ToolContext` 接口 |
| `utils.ts` | `resolveUri` 函数 |
| `vscode` | VS Code 文件系统 API |
| `util` | `TextDecoder` 用于解码文件内容 |

---

## 使用场景

### 场景 1：读取配置文件

```typescript
const content = await readFileTool.execute({
    uri: '/workspace/project/package.json'
}, context);
const packageConfig = JSON.parse(content);
```

### 场景 2：读取源代码

```typescript
const sourceCode = await readFileTool.execute({
    uri: '/workspace/project/src/main.ts'
}, context);
// 分析源代码...
```

### 场景 3：读取文档

```typescript
const readme = await readFileTool.execute({
    uri: '/workspace/project/README.md'
}, context);
// 提取项目信息...
```

### 场景 4：结合文件大小检查

```typescript
// 1. 先检查文件大小
const sizeInfo = await getFileSizeTool.execute({
    uri: '/workspace/project/large-file.log'
}, context);

// 2. 根据大小决定是否读取
if (sizeInfo.includes('KB') && parseFloat(sizeInfo) < 100) {
    const content = await readFileTool.execute({
        uri: '/workspace/project/large-file.log'
    }, context);
} else {
    // 文件太大，使用部分读取
    const partial = await partiallyReadByRangeTool.execute({
        uri: '/workspace/project/large-file.log',
        start_line: 1,
        end_line: 100
    }, context);
}
```

---

## 与部分读取工具的对比

| 特性 | `read_file` | `partially_read_by_range` | `partially_read_around_keyword` |
|------|-------------|---------------------------|--------------------------------|
| 读取范围 | 整个文件 | 指定行范围 | 关键词周围 |
| 使用场景 | 小文件 | 大文件的特定部分 | 查找特定内容 |
| 返回格式 | 原始内容 | 带行号 | 带行号 |
| 性能 | 大文件慢 | 快 | 取决于文件大小 |
| 内存占用 | 高（大文件） | 低 | 中等 |

---

## 最佳实践

### 1. 大文件处理

对于可能很大的文件，**始终**先使用 `get_file_size` 检查：

```typescript
const size = await getFileSizeTool.execute({ uri: filePath }, context);
const sizeKB = parseFloat(size.match(/[\d.]+/)?.[0] || '0');

if (sizeKB > 500) {
    // 使用部分读取
} else {
    // 完整读取
    const content = await readFileTool.execute({ uri: filePath }, context);
}
```

### 2. 错误处理

始终处理可能的文件读取错误：

```typescript
try {
    const content = await readFileTool.execute({ uri: filePath }, context);
    if (content.startsWith('Error reading file')) {
        // 处理错误
    }
} catch (e) {
    // 处理异常
}
```

### 3. 路径解析

支持多种路径格式：

```typescript
// 绝对路径
await readFileTool.execute({ uri: '/home/user/file.txt' }, context);

// 相对路径（相对于工作区根）
await readFileTool.execute({ uri: 'src/main.ts' }, context);

// URI 格式
await readFileTool.execute({ uri: 'file:///home/user/file.txt' }, context);
```

---

## 注意事项

1. **完整读取**：此工具读取文件的完整内容，大文件可能导致内存问题
2. **编码限制**：默认使用 UTF-8 编码，其他编码可能显示乱码
3. **二进制文件**：不建议用于二进制文件，返回的内容可能无意义
4. **访问权限**：不检查 `allowedUris`，但底层文件系统可能有权限限制
5. **行尾处理**：保留原始行尾（CRLF 或 LF）
