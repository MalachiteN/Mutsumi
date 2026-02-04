# edit_file_full_replace.ts

## 功能概述

`edit_file_full_replace.ts` 实现了文件的全内容替换工具。这是文件编辑的基础工具，通过显示 Diff 视图让用户确认后，将新内容完全覆盖原文件。

---

## 主要工具

### `editFileFullReplaceTool`

| 属性 | 值 |
|------|-----|
| 名称 | `edit_file_full_replace` |
| 描述 | 替换文件的完整内容。向用户显示 Diff 视图以进行确认。 |

**参数：**

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| `uri` | `string` | 是 | 目标文件的 URI 或路径 |
| `new_content` | `string` | 是 | 替换文件的新内容 |

**返回值：**

| 情况 | 返回值 |
|------|--------|
| 参数缺失 | `'Error: Missing arguments (uri, new_content).'` |
| 用户接受 | `'User accepted the edit.'` |
| 用户拒绝 | 抛出 `TerminationError` |
| 执行错误 | 错误消息字符串 |

---

## 执行流程

```
┌─────────────────────┐
│ 接收参数 (uri,      │
│  new_content)       │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 验证参数完整性       │
│ uri 和 new_content  │
│ 不能为空            │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 调用 handleEdit()   │
│ 进入交互式编辑流程   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 显示 Diff 编辑器    │
│ 等待用户确认        │
└──────────┬──────────┘
           │
      ┌────┴────┐
      │         │
      ▼         ▼
┌─────────┐ ┌─────────┐
│  接受   │ │  拒绝   │
│ Accept  │ │ Reject  │
└────┬────┘ └────┬────┘
     │           │
     ▼           ▼
┌─────────┐ ┌─────────┐
│应用修改  │ │取消操作  │
│返回成功  │ │抛出错误  │
└─────────┘ └─────────┘
```

---

## 依赖关系

| 依赖 | 用途 |
|------|------|
| `interface.ts` | `ITool`、`ToolContext` 接口 |
| `edit_file.ts` | `handleEdit` 函数（核心编辑处理） |

---

## 使用场景

### 场景 1：生成新文件

```typescript
await editFileFullReplaceTool.execute({
    uri: '/workspace/project/src/new-file.ts',
    new_content: `export function hello() {
    console.log('Hello, World!');
}`
}, context);
```

### 场景 2：重写整个文件

```typescript
await editFileFullReplaceTool.execute({
    uri: '/workspace/project/src/config.ts',
    new_content: JSON.stringify(newConfig, null, 2)
}, context);
```

### 场景 3：文件格式化

```typescript
const formatted = prettier.format(content, { parser: 'typescript' });
await editFileFullReplaceTool.execute({
    uri: filePath,
    new_content: formatted
}, context);
```

---

## 与相关工具对比

| 特性 | `edit_file_full_replace` | `edit_file_search_replace` |
|------|--------------------------|---------------------------|
| 适用范围 | 整个文件 | 文件的部分内容 |
| 替换方式 | 完全覆盖 | 精确匹配替换 |
| 使用场景 | 生成新文件、重写文件 | 修改特定函数、替换变量名 |
| 参数复杂度 | 简单（只需新内容） | 较复杂（需 SEARCH/REPLACE 块） |
| 风险 | 高（可能丢失未预期内容） | 低（只修改匹配部分） |

---

## 注意事项

1. **全文件覆盖**：此工具会完全替换文件内容，不会保留原文件的任何部分
2. **Diff 确认**：始终通过 Diff 编辑器让用户确认修改，防止意外覆盖
3. **访问权限**：底层通过 `handleEdit` 检查 `context.allowedUris` 访问权限
4. **临时文件**：修改内容先写入临时文件，确认后才覆盖原文件
5. **取消支持**：用户可以在 Diff 编辑器中拒绝修改，此时会抛出 `TerminationError`
