# edit_codelens_types.ts

## 功能概述

`edit_codelens_types.ts` 是代码编辑 CodeLens 功能的类型定义模块。它定义了文件编辑审核流程中使用的核心数据结构，包括操作按钮定义、差异上下文和审核配置。

---

## 接口定义

### `DiffCodeLensAction` 接口

定义在文件编辑审核界面显示的 CodeLens 操作按钮。

```typescript
export interface DiffCodeLensAction {
  id: string;
  label: string;
  tooltip?: string;
  command?: string;
  handler: (filePath: string, diffContext?: DiffContext) => Promise<void>;
}
```

| 属性 | 类型 | 描述 |
|------|------|------|
| `id` | `string` | 操作的唯一标识符 |
| `label` | `string` | 显示在 CodeLens 上的按钮文本，支持图标（如 `$(check) Accept`） |
| `tooltip` | `string?` | 鼠标悬停时显示的提示文本 |
| `command` | `string?` | 可选的 VS Code 命令 ID |
| `handler` | `function` | 按钮点击时的处理函数 |

**处理函数参数：**

| 参数 | 类型 | 描述 |
|------|------|------|
| `filePath` | `string` | 目标文件的完整路径 |
| `diffContext` | `DiffContext?` | 差异上下文（Diff 模式下有值，标准编辑模式可能为 undefined） |

**预设操作按钮：**

| ID | Label | Tooltip | 用途 |
|----|-------|---------|------|
| `accept` | `$(check) Accept` | 用修改内容覆盖原文件 | 完全接受 AI 的编辑建议 |
| `reject` | `$(x) Reject` | 放弃修改 | 拒绝 AI 的编辑建议 |
| `partiallyAccept` | `$(edit) Partially Accept` | 应用修改，然后手动编辑再继续 | 部分接受 + 手动调整 |
| `continueGenerate` | `$(sparkle) Continue Mutsumi Generate` | 提交手动调整后让 AI 继续 | 完成手动编辑后继续任务 |

---

### `DiffContext` 接口

封装 Diff 比较所需的完整上下文信息。

```typescript
export interface DiffContext {
  originalPath: string;
  modifiedPath: string;
  tempPath: string;
  content: {
    original: string;
    modified: string;
  };
}
```

| 属性 | 类型 | 描述 |
|------|------|------|
| `originalPath` | `string` | 原始文件的完整路径 |
| `modifiedPath` | `string` | 修改后文件的完整路径 |
| `tempPath` | `string` | 临时文件路径（存放修改内容） |
| `content.original` | `string` | 原始文件内容 |
| `content.modified` | `string` | 修改后的文件内容 |

---

### `DiffReviewConfig` 接口

Diff 审核系统的配置接口。

```typescript
export interface DiffReviewConfig {
  tempDirectory: string;
  actions: DiffCodeLensAction[];
  autoOpen?: boolean;
}
```

| 属性 | 类型 | 必需 | 描述 |
|------|------|------|------|
| `tempDirectory` | `string` | 是 | 存放临时文件的目录路径 |
| `actions` | `DiffCodeLensAction[]` | 是 | 默认的操作按钮列表 |
| `autoOpen` | `boolean?` | 否 | 是否自动打开 Diff 编辑器 |

---

## 使用示例

### 创建操作按钮配置

```typescript
const actions: DiffCodeLensAction[] = [
    {
        id: 'accept',
        label: '$(check) Accept',
        tooltip: 'Overwrite original file with changes',
        handler: async (filePath, diffContext) => {
            // 处理接受逻辑
        }
    },
    {
        id: 'reject',
        label: '$(x) Reject',
        tooltip: 'Discard changes',
        handler: async (filePath) => {
            // 处理拒绝逻辑
        }
    }
];
```

### 创建 DiffReviewConfig

```typescript
const config: DiffReviewConfig = {
    tempDirectory: path.join(context.globalStorageUri.fsPath, 'temp_edits'),
    actions: defaultActions,
    autoOpen: true
};
```

---

## 与其他模块的关系

```
edit_codelens_types.ts
    ↑
    ├── 被 edit_codelens_provider.ts 导入
    │   └── 用于定义 DiffReviewAgent 和 CustomCodeLensProvider 的类型
    │
    └── 被 edit_file.ts 导入
        └── 用于定义编辑会话的操作按钮
```

---

## 设计要点

1. **分离关注点**：将类型定义与实现分离，提高可维护性
2. **可选属性**：`tooltip`、`command`、`autoOpen` 等属性为可选，提供灵活性
3. **上下文感知**：`handler` 函数接收 `diffContext` 参数，但允许在标准编辑模式下为空
4. **VS Code 集成**：支持 VS Code 图标语法（`$(icon-name)`）增强 UI 表现力
