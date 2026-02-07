# definitions.ts

Tree-sitter 语言配置定义文件。提供各种编程语言的 Tree-sitter 节点类型到大纲类别的映射。

---

## 接口

### LanguageConfig

语言配置接口，定义 Tree-sitter 解析器的配置。

| 属性 | 类型 | 必填 | 说明 |
|------|------|------|------|
| wasmName | string | 是 | Tree-sitter WASM 文件名，例如 `'tree-sitter-typescript.wasm'` |
| definitions | Record<string, string> | 是 | Tree-sitter 节点类型到大纲类别名称的映射 |
| nameField | string | 否 | 用于提取标识符名称的字段名 |
| containers | Set<string> | 是 | 可包含其他定义的节点类型集合 |

---

## 常量

### LANGUAGE_CONFIGS

所有支持编程语言的配置映射。键为语言 ID，值为对应的 LanguageConfig。

支持的语言包括：

**JavaScript/TypeScript 家族**
- typescript, tsx, javascript, vue

**C/C++ 家族**
- c, cpp, c_sharp

**Java/Kotlin 家族**
- java, kotlin

**其他主流语言**
- python, go, rust, swift, dart, objc, php, ruby

**配置/数据格式**
- json, yaml, toml, css

**函数式/其他语言**
- elixir, elm, ocaml, scala, zig, solidity

**最小化支持**
- elisp, ql, rescript, systemrdl, tlaplus, embedded_template, html

### EXT_TO_LANG

文件扩展名到语言 ID 的映射。用于根据文件扩展名确定使用哪个 Tree-sitter 解析器。

示例：
```typescript
EXT_TO_LANG['.ts'] // 'typescript'
EXT_TO_LANG['.py'] // 'python'
EXT_TO_LANG['.rs'] // 'rust'
```

支持的扩展名包括：`.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`, `.java`, `.go`, `.rs`, `.c`, `.h`, `.cpp`, `.hpp`, `.cc`, `.cs`, `.css`, `.sh`, `.bash`, `.rb`, `.erb`, `.php`, `.lua`, `.swift`, `.kt`, `.kts`, `.dart`, `.m`, `.mm`, `.json`, `.yaml`, `.yml`, `.toml`, `.vue`, `.html`, `.htm`, `.ex`, `.exs`, `.elm`, `.ml`, `.mli`, `.scala`, `.sc`, `.zig`, `.sol`, `.el`, `.ql`, `.qll`, `.res`, `.resi`, `.rdl`, `.tla`
