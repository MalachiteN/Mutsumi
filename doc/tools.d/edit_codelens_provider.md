# edit_codelens_provider.ts

## 功能概述

`edit_codelens_provider.ts` 实现了文件编辑的交互式审核界面。它通过 VS Code 的 CodeLens 功能和 Diff 编辑器，为用户提供了可视化的编辑确认流程，支持完全接受、部分接受（手动编辑后继续）和拒绝三种操作模式。

---

## 核心类

### `DiffReviewAgent` 类

管理文件编辑的 Diff 审核流程，是主要的对外接口。

#### 构造函数

```typescript
constructor(config: DiffReviewConfig)
```

| 参数 | 类型 | 描述 |
|------|------|------|
| `config` | `DiffReviewConfig` | 包含临时目录路径和默认操作按钮配置 |

#### 方法

##### `register(context: vscode.ExtensionContext): void`

注册 CodeLens Provider 到 VS Code 扩展上下文。

```typescript
public register(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            { pattern: '**/*' }, 
            this.codeLensProvider
        )
    );
}
```

##### `compareWithTemp(originalFilePath, newContent, actions): Promise<void>`

**Diff 模式**：将新内容与原始文件比较，在 Diff 编辑器中显示差异。

| 参数 | 类型 | 描述 |
|------|------|------|
| `originalFilePath` | `string` | 原始文件的完整路径 |
| `newContent` | `string` | AI 生成的新内容 |
| `actions` | `DiffCodeLensAction[]` | 显示在 Diff 编辑器顶部的操作按钮 |

**执行流程：**

```
1. 提取文件扩展名和基础名
2. 生成临时文件路径（tempDirectory/basename.new.ext）
3. 确保临时目录存在
4. 将新内容写入临时文件
5. 注册 CodeLens 操作按钮
6. 打开 VS Code Diff 编辑器
7. 确保 CodeLens 功能已启用
```

##### `switchToStandardEditMode(filePath, actions): Promise<void>`

**标准编辑模式**：切换到普通文本编辑器，用于手动编辑场景。

| 参数 | 类型 | 描述 |
|------|------|------|
| `filePath` | `string` | 要编辑的文件路径 |
| `actions` | `DiffCodeLensAction[]` | 显示在标准编辑器顶部的操作按钮 |

**使用场景：**
- 用户选择"部分接受"后，应用 AI 修改并打开标准编辑器
- 用户手动调整后，点击"继续生成"按钮

---

### `CustomCodeLensProvider` 类

实现 VS Code 的 `CodeLensProvider` 接口，为编辑审核界面提供操作按钮。

#### 属性

| 属性 | 类型 | 描述 |
|------|------|------|
| `actionMap` | `Map<string, DiffCodeLensAction[]>` | 文件路径到操作按钮列表的映射 |
| `onChangeEmitter` | `vscode.EventEmitter<void>` | CodeLens 变化事件发射器 |
| `onDidChange` | `vscode.Event<void>` | CodeLens 变化事件（VS Code API 要求） |

#### 方法

##### `registerActions(filePath, actions): void`

为指定文件注册 CodeLens 操作按钮。

```typescript
registerActions(filePath: string, actions: DiffCodeLensAction[]): void
```

##### `clearActions(filePath): void`

清除指定文件的所有 CodeLens 操作按钮。

```typescript
clearActions(filePath: string): void
```

##### `provideCodeLenses(document, token): ProviderResult<CodeLens[]>`

VS Code API 要求的实现，提供 CodeLens 列表。

- 在文件顶部（第 0 行）显示所有操作按钮
- 每个操作按钮对应一个 `DiffCodeLensAction`

---

## 两种编辑模式对比

| 特性 | Diff 模式 | 标准编辑模式 |
|------|-----------|--------------|
| 命令 | `compareWithTemp` | `switchToStandardEditMode` |
| 界面 | Diff 编辑器（并排对比） | 标准文本编辑器 |
| 用途 | 审核 AI 生成的修改 | 手动编辑 + 继续生成 |
| 操作按钮 | Accept / Partially Accept / Reject | Continue Mutsumi Generate |
| 临时文件 | 需要（存储 AI 提案） | 不需要 |

---

## 工作流程

### 完全接受流程

```
AI 生成修改
    ↓
compareWithTemp()
    ↓
显示 Diff 编辑器
    ↓
用户点击 "$(check) Accept"
    ↓
将临时文件内容写入原文件
    ↓
清理会话，返回成功消息
```

### 部分接受流程

```
AI 生成修改
    ↓
compareWithTemp()
    ↓
显示 Diff 编辑器
    ↓
用户点击 "$(edit) Partially Accept"
    ↓
应用 AI 修改到原文件
    ↓
switchToStandardEditMode()
    ↓
显示标准编辑器 + "继续生成"按钮
    ↓
用户手动编辑后点击 "继续生成"
    ↓
生成 Diff（用户修改 vs AI 提案）
    ↓
返回反馈消息给 AI
```

---

## 依赖关系

| 依赖 | 用途 |
|------|------|
| `vscode` | VS Code API（CodeLens、Diff 编辑器、命令） |
| `path` | 路径处理 |
| `edit_codelens_types.ts` | 类型定义（DiffCodeLensAction、DiffReviewConfig 等） |

---

## 注意事项

1. **全局 CodeLens 注册**：CodeLens Provider 注册为全局模式（`**/*`），但只在有注册 actions 的文件上显示
2. **临时文件管理**：临时文件存储在扩展全局存储目录的 `temp_edits` 子目录中
3. **CodeLens 启用**：自动确保 `diffEditor.codeLens` 设置为 `true`
4. **资源清理**：操作完成后必须调用 `clearActions` 和删除临时文件
