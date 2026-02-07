# codebase 模块

本模块提供基于 Tree-sitter 的代码结构分析功能，用于生成源代码的结构大纲。

---

## 功能概述

codebase 模块通过 Tree-sitter 解析器分析源代码文件，提取其中的结构化定义（类、函数、方法等），并以树形结构返回。主要用途包括：

- 生成项目源代码的结构大纲
- 为代码导航和浏览提供支持
- 提供代码结构的文本表示用于调试

---

## 文件关系

```
┌──────────────────┐      使用配置       ┌──────────────────┐
│   definitions.ts │  ─────────────────> │    service.ts    │
│   (语言配置定义)  │                      │   (解析服务实现)  │
└──────────────────┘                      └──────────────────┘
       ▲                                         │
       │                                         │
       │         导入 EXT_TO_LANG               │
       └─────────────────────────────────────────┘
                      导入 LANGUAGE_CONFIGS
```

### 依赖关系

- **service.ts** 依赖 **definitions.ts**：
  - 导入 `EXT_TO_LANG`：根据文件扩展名确定语言类型
  - 导入 `LANGUAGE_CONFIGS`：获取语言的 Tree-sitter 配置
  - 导入 `LanguageConfig`：类型定义

---

## 主要导出项

### definitions.ts

| 导出项 | 类型 | 说明 |
|--------|------|------|
| LanguageConfig | Interface | 语言配置接口 |
| LANGUAGE_CONFIGS | Record<string, LanguageConfig> | 所有支持语言的配置映射 |
| EXT_TO_LANG | Record<string, string> | 文件扩展名到语言 ID 的映射 |

### service.ts

| 导出项 | 类型 | 说明 |
|--------|------|------|
| OutlineNode | Interface | 大纲节点结构 |
| CodebaseService | Class | 代码解析服务（单例模式）|

---

## 支持的语言

共支持 30+ 种编程语言，主要包括：

- **JavaScript/TypeScript**: typescript, tsx, javascript, vue
- **系统编程**: c, cpp, c_sharp, rust, go, zig
- **JVM 语言**: java, kotlin, scala
- **脚本语言**: python, bash, lua, ruby, php
- **移动开发**: swift, dart, objc
- **配置格式**: json, yaml, toml, css
- **函数式语言**: elixir, elm, ocaml

---

## 使用示例

```typescript
import { CodebaseService } from './service';

// 获取服务实例并初始化
const service = CodebaseService.getInstance();
await service.initialize(context);

// 获取文件大纲
const outline = await service.getFileOutline(uri);

// 格式化输出
const formatted = service.formatOutline(outline);
console.log(formatted);
```

---

## 缓存策略

CodebaseService 内部实现三级缓存：

1. **语言对象缓存**: 避免重复加载 WASM 文件
2. **解析器缓存**: 避免重复创建解析器实例
3. **大纲结果缓存**: 避免重复解析相同文件
