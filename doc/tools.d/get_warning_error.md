# get_warning_error.ts

## 功能概述

`get_warning_error.ts` 实现了诊断信息检索工具，允许 Agent 获取 VS Code 工作区中的警告和错误信息（Diagnostics）。支持检索整个工作区、特定目录或特定文件的问题。

---

## 主要工具

### `getWarningErrorTool`

| 属性 | 值 |
|------|-----|
| 名称 | `get_warning_error` |
| 描述 | 检索整个工作区、特定目录或特定文件的警告和错误（诊断信息） |

**参数：**

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| `uri` | `string` | 否 | 目标文件或目录的 URI/路径。如果为空或省略，返回整个工作区的诊断信息 |

**返回值：**

| 情况 | 返回值 |
|------|--------|
| 无诊断信息 | `'No warnings or errors found.'` |
| 有诊断信息 | 格式化的问题列表，包含文件路径、问题类型、位置、消息等 |
| 错误 | `'Error retrieving diagnostics: {error}'` |

---

## 诊断信息格式

### 输出格式示例

```
Found {totalCount} problems in {fileCount} files:

FILE: src/components/Button.tsx
[Error] Line 15:8 - Type 'string' is not assignable to type 'number' (typescript)
[Warning] Line 42:3 - 'handleClick' is declared but its value is never read (eslint)

FILE: src/utils/helpers.ts
[Error] Line 23:15 - Cannot find name 'undefinedVar' (typescript)
```

### 字段说明

| 字段 | 说明 |
|------|------|
| `FILE: path` | 相对工作区的文件路径 |
| `[Error]` | 错误级别诊断（红色） |
| `[Warning]` | 警告级别诊断（黄色） |
| `Line X:Y` | 问题所在的行号和列号（1-based） |
| `Message` | 诊断消息 |
| `(Source)` | 诊断来源（如 typescript、eslint） |

---

## 执行流程

```
┌─────────────────────┐
│ 接收可选参数 uri    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 如果提供了 uri：    │
│ - 解析为 VS Code URI│
│ - 检查是文件还是目录│
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 获取所有诊断信息    │
│ vscode.languages.   │
│   getDiagnostics()  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 过滤诊断信息：      │
│ - 按 uri 范围过滤   │
│ - 只保留 Error 和   │
│   Warning 级别      │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 排序和格式化输出    │
│ - 按文件路径排序    │
│ - 按行号排序        │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 返回格式化结果      │
└─────────────────────┘
```

---

## 过滤逻辑

### 范围过滤

#### 整个工作区（无 uri 参数）

返回所有文件的诊断信息。

#### 特定文件

精确匹配文件 URI：

```typescript
if (fileUri.toString() !== filterUri.toString()) {
    continue;
}
```

#### 特定目录

检查文件是否在目录内：

```typescript
const relative = path.relative(filterUri.fsPath, fileUri.fsPath);
if (relative.startsWith('..') || path.isAbsolute(relative)) {
    continue; // 文件不在目录内
}
```

### 严重程度过滤

只保留错误和警告级别的诊断：

```typescript
const relevantDiagnostics = diagnostics.filter(d => 
    d.severity === vscode.DiagnosticSeverity.Error || 
    d.severity === vscode.DiagnosticSeverity.Warning
);
```

---

## 依赖关系

| 依赖 | 用途 |
|------|------|
| `interface.ts` | `ITool`、`ToolContext` 接口 |
| `utils.ts` | `resolveUri` 函数 |
| `vscode` | VS Code API（Diagnostic、DiagnosticSeverity 等） |
| `path` | 路径处理和过滤 |

---

## 使用场景

### 场景 1：检查整个项目

```typescript
// 不传递 uri 参数，检查整个工作区
const result = await getWarningErrorTool.execute({}, context);
console.log(result);
```

### 场景 2：检查特定目录

```typescript
// 检查 src 目录下的所有问题
const result = await getWarningErrorTool.execute({
    uri: '/workspace/project/src'
}, context);
```

### 场景 3：检查特定文件

```typescript
// 检查单个文件
const result = await getWarningErrorTool.execute({
    uri: '/workspace/project/src/main.ts'
}, context);
```

### 场景 4：代码修复工作流

```typescript
// 1. 获取当前文件的错误
const errors = await getWarningErrorTool.execute({ uri: filePath }, context);

// 2. 分析错误类型
if (errors.includes('is declared but never read')) {
    // 3. 移除未使用的变量
    await editFileSearchReplaceTool.execute({
        uri: filePath,
        search_replace: `<<<<<<< SEARCH
const unusedVar = 'value';
=======
>>>>>>> REPLACE`
    }, context);
}
```

---

## 注意事项

1. **诊断来源**：诊断信息来自 VS Code 的语言服务器和扩展（如 TypeScript、ESLint、Pylint 等）
2. **实时性**：诊断信息是实时的，反映了当前编辑器的分析结果
3. **性能考虑**：大型工作区可能有大量诊断信息，工具会自动排序以便阅读
4. **行号格式**：返回的行号是 1-based（人类友好），而 VS Code API 使用 0-based
5. **未保存文件**：诊断信息包括已打开但未保存的文件（脏文件）
