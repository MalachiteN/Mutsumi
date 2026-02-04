# fs_write_ops.ts

## 功能概述

`fs_write_ops.ts` 实现了文件系统的写入操作工具，包括创建目录和创建/覆盖文件。这些操作需要用户显式批准，确保 Agent 不会未经同意修改文件系统。

---

## 主要工具

### `mkdirTool` - 创建目录工具

| 属性 | 值 |
|------|-----|
| 名称 | `mkdir` |
| 描述 | 递归创建目录（类似 `mkdir -p`）。需要用户批准。 |

**参数：**

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| `uri` | `string` | 是 | 要创建的目录路径 |

**执行流程：**

```
1. 验证 uri 参数存在
2. 解析输入为 VS Code URI
3. 检查访问权限（allowedUris）
4. 请求用户批准（侧边栏通知）
5. 用户批准后执行创建
6. 返回结果消息
```

**返回值：**

| 情况 | 返回值 |
|------|--------|
| 参数缺失 | `'Error: Missing "uri" argument.'` |
| 访问拒绝 | `'Access Denied: Agent is not allowed to write to ...'` |
| 用户拒绝 | `'User rejected the operation.'` |
| 成功 | `'Directory created: {uri}'` |
| 失败 | `'Error creating directory: {error}'` |

**使用示例：**

```typescript
await mkdirTool.execute({
    uri: '/workspace/project/src/components'
}, context);
```

---

### `createNewFileTool` - 创建文件工具

| 属性 | 值 |
|------|-----|
| 名称 | `create_file` |
| 描述 | 创建新文件并写入内容。会覆盖已存在的文件。如果父目录不存在则失败。需要用户批准。 |

**参数：**

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| `uri` | `string` | 是 | 文件路径 |
| `content` | `string` | 是 | 文件内容 |

**执行流程：**

```
1. 验证 uri 和 content 参数存在
2. 解析输入为 VS Code URI
3. 检查访问权限（allowedUris）
4. 请求用户批准（侧边栏通知）
5. 用户批准后执行写入
6. 返回结果消息
```

**返回值：**

| 情况 | 返回值 |
|------|--------|
| 参数缺失 | `'Error: Missing arguments.'` |
| 访问拒绝 | `'Access Denied: Agent is not allowed to write to ...'` |
| 用户拒绝 | `'User rejected the operation.'` |
| 成功 | `'File created successfully: {uri}'` |
| 失败 | `'Error creating file (Parent dir might not exist): {error}'` |

**重要特性：**

- **不自动创建父目录**：如果父目录不存在，操作会失败
- **覆盖现有文件**：如果文件已存在，内容会被完全覆盖

**使用示例：**

```typescript
await createNewFileTool.execute({
    uri: '/workspace/project/README.md',
    content: '# Project Name\n\nDescription here...'
}, context);
```

---

## 安全机制

### 1. 访问控制

两个工具都使用 `checkAccess` 函数验证目标路径是否在 Agent 的 `allowedUris` 列表中：

```typescript
if (!checkAccess(uri, context.allowedUris)) {
    return `Access Denied: Agent is not allowed to write to ${uri.toString()}`;
}
```

### 2. 用户批准

使用 `requestApproval` 函数请求用户显式批准：

```typescript
if (!(await requestApproval('Create Directory (mkdir -p)', uriInput, context))) {
    return 'User rejected the operation.';
}
```

批准请求会：
- 在 Notebook 输出中显示警告信息
- 在 VS Code 窗口显示通知消息
- 在 Mutsumi 侧边栏显示批准请求

---

## 与编辑工具的区别

| 特性 | `mkdir` / `create_file` | `edit_file_*` 工具 |
|------|------------------------|-------------------|
| 用户交互 | 侧边栏批准 | Diff 编辑器确认 |
| 文件存在处理 | 覆盖（create_file） | 通过 Diff 确认 |
| 显示方式 | 文本消息 | 可视化 Diff |
| 适用场景 | 创建新资源 | 修改现有文件 |
| 撤销支持 | 无 | 可通过 Reject 撤销 |

---

## 依赖关系

| 依赖 | 用途 |
|------|------|
| `interface.ts` | `ITool`、`ToolContext` 接口 |
| `utils.ts` | `resolveUri`、`checkAccess`、`requestApproval` 函数 |
| `vscode` | VS Code 文件系统 API |
| `util` | `TextEncoder` 用于编码文件内容 |

---

## 使用场景

### 场景 1：创建项目结构

```typescript
// 创建目录结构
await mkdirTool.execute({ uri: '/project/src/components' }, context);
await mkdirTool.execute({ uri: '/project/src/utils' }, context);
await mkdirTool.execute({ uri: '/project/tests' }, context);

// 创建初始文件
await createNewFileTool.execute({
    uri: '/project/package.json',
    content: JSON.stringify({ name: 'my-project', version: '1.0.0' }, null, 2)
}, context);
```

### 场景 2：生成配置文件

```typescript
await createNewFileTool.execute({
    uri: '/project/.gitignore',
    content: `node_modules/
dist/
.env
*.log`
}, context);
```

---

## 注意事项

1. **父目录处理**：`create_file` 不会自动创建父目录，如需创建请先调用 `mkdir`
2. **覆盖警告**：`create_file` 会覆盖已存在的文件，请确保这是预期行为
3. **路径解析**：支持相对路径（相对于工作区根目录）和绝对路径
4. **批准等待**：用户可能需要时间查看和批准请求，操作不会立即完成
