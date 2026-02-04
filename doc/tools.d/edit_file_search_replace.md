# edit_file_search_replace.ts

## 功能概述

`edit_file_search_replace.ts` 实现了精确的块级文件编辑工具。它使用 SEARCH/REPLACE 块格式，允许 AI 只修改文件的特定部分，而不是替换整个文件，从而减少意外修改的风险。

---

## 主要工具

### `editFileSearchReplaceTool`

| 属性 | 值 |
|------|-----|
| 名称 | `edit_file_search_replace` |
| 描述 | 使用 SEARCH/REPLACE 块替换文件的部分内容。格式如下：<br>```<br><<<<<<< SEARCH<br>...<br>=======<br>...<br>>>>>>> REPLACE<br>``` |

**参数：**

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| `uri` | `string` | 是 | 目标文件的 URI 或路径 |
| `search_replace` | `string` | 是 | SEARCH/REPLACE 格式的编辑块 |

**返回值：**

| 情况 | 返回值 |
|------|--------|
| 参数缺失 | `'Error: Missing arguments (uri, search_replace).'` |
| 访问拒绝 | `'Access Denied: Agent is not allowed to edit ...'` |
| 格式错误 | `'Error: Invalid search_replace format. Use:\n<<<<<<< SEARCH\n...\n=======\n...\n>>>>>>> REPLACE'` |
| 未找到匹配 | `'Error: Could not find SEARCH block in file.\n\nSearch term:\n{searchContent}'` |
| 成功 | `'User accepted the edit.'` 或通过 `handleEdit` 的返回值 |

---

## SEARCH/REPLACE 格式

### 格式规范

```
<<<<<<< SEARCH
[要查找的原始内容]
=======
[替换的新内容]
>>>>>>> REPLACE
```

### 格式要求

1. **标记必须完整**：必须包含 `<<<<<<< SEARCH`、`=======`、`>>>>>>> REPLACE` 三个标记
2. **标记顺序**：SEARCH → 分隔线 → REPLACE
3. **内容匹配**：SEARCH 内容必须与文件中的内容完全匹配（包括空格和换行）
4. **支持多行**：可以匹配和替换多行代码块

---

## 执行流程

```
┌─────────────────────┐
│ 接收参数 (uri,      │
│  search_replace)    │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 验证参数            │
│ - uri 和 search_replace
│   不能为空          │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 解析 URI            │
│ 检查访问权限         │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 读取原文件内容       │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 解析 SEARCH/REPLACE │
│ 块，提取三部分      │
│ - SEARCH 内容       │
│ - REPLACE 内容      │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ 尝试匹配替换         │
│ 1. 直接匹配         │
│ 2. 标准化换行后匹配  │
└──────────┬──────────┘
           │
      ┌────┴────┐
      │         │
      ▼         ▼
┌─────────┐ ┌─────────┐
│匹配成功 │ │匹配失败 │
└────┬────┘ └────┬────┘
     │           │
     ▼           ▼
┌─────────┐ ┌─────────┐
│调用     │ │返回错误  │
│handleEdit│ │提示未找到│
│显示 Diff │ │SEARCH块  │
└─────────┘ └─────────┘
```

---

## 换行符处理

工具会自动处理不同操作系统下的换行符差异：

```typescript
// 标准化换行符处理
const normalize = (s: string) => s.replace(/\r\n/g, '\n');
const normOrig = normalize(originalContent);
const normSearch = normalize(searchContent);

if (normOrig.includes(normSearch)) {
    newContent = normOrig.replace(normSearch, replaceContent);
}
```

这确保了在 Windows（CRLF）和 Unix（LF）系统之间都能正确匹配。

---

## 依赖关系

| 依赖 | 用途 |
|------|------|
| `interface.ts` | `ITool`、`ToolContext` 接口 |
| `utils.ts` | `resolveUri`、`checkAccess` 函数 |
| `edit_file.ts` | `handleEdit` 函数（核心编辑处理） |
| `vscode` | VS Code 文件系统 API |
| `util` | `TextDecoder` 用于解码文件内容 |

---

## 使用示例

### 示例 1：替换单行代码

```typescript
await editFileSearchReplaceTool.execute({
    uri: '/workspace/src/app.ts',
    search_replace: `<<<<<<< SEARCH
const port = 3000;
=======
const port = process.env.PORT || 3000;
>>>>>>> REPLACE`
}, context);
```

### 示例 2：替换函数体

```typescript
await editFileSearchReplaceTool.execute({
    uri: '/workspace/src/utils.ts',
    search_replace: `<<<<<<< SEARCH
function calculateSum(a: number, b: number): number {
    return a + b;
}
=======
function calculateSum(a: number, b: number): number {
    console.log('Calculating sum...');
    return a + b;
}
>>>>>>> REPLACE`
}, context);
```

### 示例 3：添加新导入

```typescript
await editFileSearchReplaceTool.execute({
    uri: '/workspace/src/main.ts',
    search_replace: `<<<<<<< SEARCH
import { readFile } from './utils';
=======
import { readFile, writeFile } from './utils';
>>>>>>> REPLACE`
}, context);
```

---

## 注意事项

1. **精确匹配**：SEARCH 内容必须与文件中的内容完全匹配，包括空格、缩进和换行
2. **单块限制**：每次调用只处理一个 SEARCH/REPLACE 块
3. **多次编辑**：如需修改多个不连续的部分，需要多次调用此工具
4. **Diff 确认**：即使使用此工具，修改仍会显示在 Diff 编辑器中让用户确认
5. **错误处理**：如果 SEARCH 内容未找到，会返回详细的错误信息帮助调试
