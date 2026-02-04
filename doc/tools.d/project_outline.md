# project_outline.ts

## 功能概述

`project_outline.ts` 实现了项目代码结构大纲生成工具。它使用 Tree-sitter 解析器分析源代码文件，提取类、函数、方法等结构信息，帮助 Agent 快速了解代码库的组织结构。

---

## 主要工具

### `projectOutlineTool`

| 属性 | 值 |
|------|-----|
| 名称 | `project_outline` |
| 描述 | 生成项目源代码的结构大纲。使用 Tree-sitter 解析来识别类、函数和方法。 |

**参数：**

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| `uri` | `string` | 是 | 要扫描的根目录 URI（可选，但当前实现必需） |

**执行流程：**

```
┌─────────────────────┐
│ 接收参数 uri        │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 解析为根目录 URI    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 请求用户批准        │
│ 说明扫描范围        │
└──────────┬──────────┘
           │
      ┌────┴────┐
      │         │
      ▼         ▼
┌─────────┐ ┌─────────┐
│  批准   │ │  拒绝   │
└────┬────┘ └────┬────┘
     │           │
     ▼           ▼
┌─────────┐ ┌─────────┐
│继续执行  │ │返回拒绝  │
└────┬────┘ │消息      │
     │      └─────────┘
     ▼
┌─────────────────────┐
│ 查找文件            │
│ - 匹配模式: **/*    │
│ - 排除: **/*.d.ts   │
│ - 最大: 100 个文件  │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 使用 CodebaseService│
│ 解析每个文件        │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 格式化并返回结果    │
└─────────────────────┘
```

**返回值：**

| 情况 | 返回值 |
|------|--------|
| 用户拒绝 | `'User rejected the project outline scan.'` |
| 无匹配文件 | `'No matching files found.'` |
| 无结构提取 | `'No structure extracted from files. Ensure Tree-sitter WASM files are correctly installed.'` |
| 成功 | 格式化的项目大纲 |

**输出格式：**

```
(Limit reached: showing first 100 files)

File: src/utils/helpers.ts
├── function parseInput(input: string): ParsedData
├── function validateData(data: ParsedData): boolean
└── class DataValidator
    ├── method constructor(options: ValidatorOptions)
    ├── method validate(data: unknown): ValidationResult
    └── method getErrors(): string[]

File: src/components/Button.tsx
├── interface ButtonProps
├── const Button: React.FC<ButtonProps>
└── export default Button
```

---

## 扫描限制

| 限制项 | 值 | 说明 |
|--------|-----|------|
| 最大文件数 | 100 | 防止扫描过大项目时性能问题 |
| 排除模式 | `**/*.d.ts` | 排除 TypeScript 声明文件 |
| 包含模式 | `**/*` | 包含所有文件类型 |

```typescript
const MAX_FILES_TO_SCAN = 100;
const excludePattern = '**/*.d.ts';
const includePattern = new vscode.RelativePattern(rootUri, '**/*');
```

---

## 支持的代码结构

通过 Tree-sitter 解析器，可以识别以下结构：

| 结构类型 | 说明 |
|----------|------|
| `class` | 类定义 |
| `function` | 函数定义 |
| `method` | 类方法 |
| `interface` | TypeScript 接口 |
| `const` | 常量定义（函数组件等） |
| `export` | 导出声明 |

---

## 依赖关系

| 依赖 | 用途 |
|------|------|
| `interface.ts` | `ITool`、`ToolContext` 接口 |
| `utils.ts` | `resolveUri`、`requestApproval` 函数 |
| `vscode` | VS Code API |
| `../codebase/service` | `CodebaseService` Tree-sitter 解析服务 |

---

## 使用场景

### 场景 1：了解新项目结构

```typescript
const outline = await projectOutlineTool.execute({
    uri: '/workspace/new-project'
}, context);
console.log(outline);
```

### 场景 2：分析特定目录

```typescript
const outline = await projectOutlineTool.execute({
    uri: '/workspace/project/src/components'
}, context);
```

### 场景 3：查找特定函数

```typescript
const outline = await projectOutlineTool.execute({
    uri: '/workspace/project'
}, context);

// 然后在结果中搜索
if (outline.includes('function validate')) {
    // 找到验证函数，进一步分析
}
```

### 场景 4：代码审查准备

```typescript
// 1. 获取项目大纲
const outline = await projectOutlineTool.execute({
    uri: '/workspace/project/src'
}, context);

// 2. 识别需要审查的关键文件
const filesToReview = extractFilesWithClasses(outline);

// 3. 逐一审查
for (const file of filesToReview) {
    await reviewFile(file, context);
}
```

---

## 注意事项

1. **Tree-sitter 依赖**：需要正确安装 Tree-sitter WASM 文件才能正常工作
2. **用户批准**：扫描前需要用户批准，因为可能涉及大量文件读取
3. **文件限制**：最多处理 100 个文件，大型项目可能需要多次扫描不同目录
4. **解析失败**：某些文件可能无法解析（如二进制文件、语法错误文件），会被静默跳过
5. **结果排序**：结果按文件路径字母顺序排序，便于查找
