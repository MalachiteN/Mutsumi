# contextManagement 模块

## 整体功能概述

contextManagement 模块负责管理和组装 Agent 的上下文信息，包括：

1. **动态上下文组装** - 解析文件引用和工具调用语法，支持递归嵌套
2. **对话历史构建** - 从 Notebook 单元格加载历史消息，处理多模态内容
3. **图片粘贴处理** - 将粘贴的图片保存到临时目录并生成 Markdown 链接
4. **系统提示词管理** - 初始化规则文件，组装包含规则和运行时上下文的系统提示
5. **预处理器命令** - 支持条件编译和宏定义，动态控制内容包含
6. **Front Matter 收集** - 递归解析 Markdown 文件时收集 YAML front matter 中的 Params 和 Description 字段

## 文件关系

```
┌─────────────────────────────────────────────────────────────────┐
│                     preprocessor.ts                             │
│              预处理器，处理条件编译和宏定义                       │
└───────────────────────────┬─────────────────────────────────────┘
                            │ 在 assembleDocument 中被调用
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                        prompts.ts                               │
│  ┌──────────────┐         ┌──────────────────┐                 │
│  │initializeRules│         │ getSystemPrompt  │                 │
│  └──────┬────────┘         └────────┬─────────┘                 │
│         │                            │                          │
│         ▼                            ▼                          │
│   创建 .mutsumi/rules/         调用 ContextAssembler            │
│   从 assets/ 复制               解析 @[path] 引用               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   contextAssembler.ts                           │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              ContextAssembler 类                          │  │
│  │  ┌──────────────────┐  ┌──────────────────────────────┐ │  │
│  │  │    preprocess    │  │        prepareSkill          │ │  │
│  │  │   (预处理)        │  │  (核心解析，收集 front matter)│ │  │
│  │  └──────────────────┘  └──────────────────────────────┘ │  │
│  │  ┌──────────────────┐  ┌──────────────────────────────┐ │  │
│  │  │ assembleDocument │  │ resolveUserPromptReferences  │ │  │
│  │  │ (组合：preprocess│  │                              │ │  │
│  │  │  + prepareSkill) │  │                              │ │  │
│  │  └──────────────────┘  └──────────────────────────────┘ │  │
│  │  ┌──────────────────┐  ┌──────────────────────────────┐ │  │
│  │  │   parseReference │  │     readResource             │ │  │
│  │  └──────────────────┘  └──────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌───────────────────────────┐    ┌──────────────────────────────┐
│       history.ts          │    │   imagePasteProvider.ts      │
│  ┌─────────────────────┐  │    │  ┌──────────────────────┐   │
│  │buildInteractionHistory│ │   │  │ ImagePasteProvider   │   │
│  └─────────────────────┘  │    │  └──────────────────────┘   │
│  调用 getSystemPrompt()   │    │                              │
│  调用 ContextAssembler    │    │  处理图片粘贴，生成           │
│  解析用户消息中的图片      │    │  Markdown 图片链接           │
└───────────────────────────┘    └──────────────────────────────┘
```

## 调用链

### 对话启动时的上下文构建流程

```
buildInteractionHistory()
    ├── getSystemPrompt()
    │   ├── initializeRules() [首次启动]
    │   └── ContextAssembler.assembleDocument() [解析规则中的引用]
    ├── ContextAssembler.resolveUserPromptReferences() [解析用户提示中的引用]
    └── parseUserMessageWithImages() [解析图片]
```

### 图片粘贴流程

```
用户粘贴图片
    └── ImagePasteProvider.provideDocumentPasteEdits()
        └── 保存到 /tmp/mutsumi_images/
        └── 插入 Markdown 链接 ![image](file://...)
```

## 主要导出项列表

### preprocessor.ts

| 导出项 | 类型 | 说明 |
|--------|------|------|
| `MacroContext` | 类 | 管理宏定义的上下文 |
| `Preprocessor` | 类 | 预处理器主类，处理条件编译命令 |
| `Preprocessor.process` | 方法 | 处理包含预处理器命令的文本 |
| `PreprocessorResult` | 接口 | 预处理器执行结果 |

### contextAssembler.ts

| 导出项 | 类型 | 说明 |
|--------|------|------|
| `ParseMode` | 枚举 | 解析模式：INLINE（内联替换）/ APPEND（追加到缓冲区） |
| `ContextAssembler` | 类 | 核心类，提供上下文组装功能 |
| `ContextAssembler.preprocess` | 静态方法 | 预处理器，处理 `@{...}` 语法（同步） |
| `ContextAssembler.prepareSkill` | 静态方法 | 核心解析，处理 `@[...]` 语法，收集 front matter，返回 `{content, description, params}` |
| `ContextAssembler.assembleDocument` | 静态方法 | 组合函数：preprocess + prepareSkill，返回组装后的 content |
| `ContextAssembler.resolveUserPromptReferences` | 静态方法 | 解析用户提示中的引用，生成上下文块 |
| `ContextAssembler.executeToolCall` | 静态方法 | 执行工具调用 |
| `ContextAssembler.parseReference` | 静态方法 | 解析引用字符串（支持行号范围） |
| `ContextAssembler.readResource` | 静态方法 | 读取文件或目录内容 |
| `ContextAssembler.extractBracketContent` | 静态方法 | 提取方括号内容，支持嵌套 |

### history.ts

| 导出项 | 类型 | 说明 |
|--------|------|------|
| `buildInteractionHistory` | 函数 | 构建完整的对话历史，返回消息列表和元数据 |

### imagePasteProvider.ts

| 导出项 | 类型 | 说明 |
|--------|------|------|
| `ImagePasteProvider` | 类 | 图片粘贴提供者，实现 VSCode DocumentPasteEditProvider 接口 |
| `ImagePasteProvider.provideDocumentPasteEdits` | 方法 | 处理图片粘贴，返回文档编辑操作 |

### prompts.ts

| 导出项 | 类型 | 说明 |
|--------|------|------|
| `initializeRules` | 函数 | 初始化规则目录，复制默认规则文件 |
| `getSystemPrompt` | 函数 | 获取组装后的系统提示词 |

## 关键语法

### 文件引用语法

```
@[path/to/file]              # 引用整个文件
@[path:10]                   # 引用第10行
@[path:10:20]                # 引用第10-20行
@[/absolute/path/to/file]    # 绝对路径
```

### 工具调用语法

```
@[tool_name{"arg": "value"}]
```

示例:
```
@[read_file{"uri": "src/main.ts"}]
@[ls{"uri": "."}]
```

### 预处理器命令语法

```
@{define MACRO, "VALUE"}     # 定义宏
@{ifdef MACRO}               # 如果定义了宏则包含内容
@{ifndef MACRO}              # 如果没定义宏则包含内容
@{if MACRO IS "value"}       # 条件判断（IS, ISNT, CONTAINS, DOESNT_CONTAIN, MATCHES, DOESNT_MATCH）
@{else}                      # 否则分支
@{endif}                     # 结束条件块
```

示例:
```
@{define DEBUG, "true"}
@{define VERSION, "1.0.0"}

@{ifdef DEBUG}
调试信息：当前处于调试模式
@{endif}

@{if VERSION MATCHES "^1\\."}
这是 1.x 版本
@{endif}
```

### Markdown Front Matter 语法

在 Markdown 文件中可以使用 YAML front matter 来定义元数据：

```yaml
---
Description: "这是文档的描述信息"
Params:
  - "param1"
  - "param2"
  - "param3"
---

文档正文内容...
```

**字段说明：**
- `Description`: 字符串类型，将被 `prepareSkill` 提取并返回
- `Params`: 字符串数组，将被递归收集并去重合并

**收集规则：**
- 只有 `.md` 文件会被解析 front matter
- `Description` 取自递归发起处的顶级 Markdown 文件（第一个被解析的 .md 文件）
- `Params` 从所有沿途遇到的 Markdown 文件中收集，并在返回前进行去重
- 如果字段不存在或类型不匹配，则不做任何贡献（Description 返回空字符串，Params 不添加）

### 多模态图片语法

```markdown
![描述](file:///path/to/image.png)
```

图片会被解析为:
```typescript
{ type: 'image_url', image_url: { url: 'data:image/png;base64,...', detail: 'auto' } }
```
