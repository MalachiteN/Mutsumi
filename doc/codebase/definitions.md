# definitions.ts

## 概述

`definitions.ts` 是 Mutsumi VSCode 插件 **codebase 模块** 的配置定义文件，负责定义 Tree-sitter 解析器的语言配置映射。该文件将 Tree-sitter 的 AST（抽象语法树）节点类型映射到统一的代码大纲类别，支持 30+ 种编程语言。

---

## 接口定义

### `LanguageConfig`

定义单个编程语言的 Tree-sitter 解析配置。

```typescript
export interface LanguageConfig {
    wasmName: string;                    // WASM 文件名，如 'tree-sitter-typescript.wasm'
    definitions: Record<string, string>; // 节点类型到通用类型的映射
    nameField?: string;                  // 提取名称的字段名（通常为 'name'）
    containers: Set<string>;             // 需要递归扫描子成员的节点类型
}
```

**字段说明：**

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `wasmName` | `string` | ✅ | Tree-sitter WASM 文件名称 |
| `definitions` | `Record<string, string>` | ✅ | 键：Tree-sitter 节点类型（如 `'class_declaration'`）；值：映射到的大纲类别（如 `'Class'`） |
| `nameField` | `string` | ❌ | 用于提取标识符名称的字段名，若未指定则尝试获取第一个子标识符 |
| `containers` | `Set<string>` | ✅ | 定义可包含子成员的节点类型集合，用于递归解析类/接口/命名空间等内部成员 |

---

## 常量定义

### `LANGUAGE_CONFIGS`

**类型：** `Record<string, LanguageConfig>`

支持的语言配置映射表，键为语言 ID，值为对应的 `LanguageConfig`。

**支持的语言列表：**

| 语言族 | 支持语言 |
|--------|----------|
| **JavaScript 家族** | TypeScript、TSX、JavaScript、Vue |
| **C/C++ 家族** | C、C++、C# |
| **Java/Kotlin** | Java、Kotlin |
| **Python** | Python |
| **Go/Rust** | Go、Rust |
| **Shell/Scripting** | Bash、Lua、Ruby、PHP |
| **移动端** | Swift、Dart、Objective-C |
| **配置/数据** | JSON、YAML、TOML、CSS |
| **函数式/其他** | Elixir、Elm、OCaml、Scala、Zig、Solidity、Elisp、QL、ReScript、SystemRDL、TLA+、HTML |

**配置示例 - TypeScript：**

```typescript
'typescript': {
    wasmName: 'tree-sitter-typescript.wasm',
    definitions: {
        'class_declaration': 'Class',
        'interface_declaration': 'Interface',
        'function_declaration': 'Function',
        'method_definition': 'Method',
        'public_field_definition': 'Field',
        'type_alias_declaration': 'Type',
        'enum_declaration': 'Enum',
        'module': 'Module',
        'lexical_declaration': 'Variable',
        'variable_declaration': 'Variable'
    },
    containers: new Set([
        'class_declaration', 'interface_declaration', 'module', 
        'program', 'class_body', 'interface_body', 'export_statement'
    ])
}
```

### `EXT_TO_LANG`

**类型：** `Record<string, string>`

文件扩展名到语言 ID 的映射表，用于根据文件后缀名确定使用哪种语言的解析配置。

**常见映射：**

| 扩展名 | 语言 ID |
|--------|---------|
| `.ts` | `typescript` |
| `.tsx` | `tsx` |
| `.js`, `.jsx`, `.mjs`, `.cjs` | `javascript` |
| `.py` | `python` |
| `.java` | `java` |
| `.go` | `go` |
| `.rs` | `rust` |
| `.c`, `.h` | `c` |
| `.cpp`, `.hpp`, `.cc` | `cpp` |
| `.cs` | `c_sharp` |
| `.vue` | `vue` |
| `.json` | `json` |
| `.yaml`, `.yml` | `yaml` |

---

## 与其他模块的关系

```
┌─────────────────┐
│  service.ts     │  ← 导入并使用 LANGUAGE_CONFIGS 和 EXT_TO_LANG
│  CodebaseService│
└────────┬────────┘
         │ 导入
         ▼
┌─────────────────┐
│ definitions.ts  │  ← 本文件：提供语言配置定义
│ LANGUAGE_CONFIGS│
│ EXT_TO_LANG     │
└─────────────────┘
```

**依赖关系：**
- `service.ts` 导入本文件的 `LANGUAGE_CONFIGS` 和 `EXT_TO_LANG`
- `CodebaseService` 使用 `EXT_TO_LANG` 根据文件扩展名获取语言 ID
- `CodebaseService` 使用 `LANGUAGE_CONFIGS` 获取解析配置，加载对应的 WASM 文件

---

## 扩展指南

如需添加对新语言的支持：

1. **添加 `LanguageConfig`**：在 `LANGUAGE_CONFIGS` 中添加新语言的配置
2. **定义节点映射**：在 `definitions` 中映射该语言的 AST 节点类型到大纲类别
3. **设置容器类型**：在 `containers` 中定义可包含子成员的节点类型
4. **添加扩展名映射**：在 `EXT_TO_LANG` 中添加文件扩展名到语言 ID 的映射
5. **放置 WASM 文件**：将对应的 `tree-sitter-<lang>.wasm` 文件放入 `assets/tree-sitter/` 目录
