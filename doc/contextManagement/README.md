# contextManagement 模块

## 整体功能概述

contextManagement 模块负责管理和组装 Agent 的上下文信息，包括：

1. **动态上下文组装** - 解析文件引用和工具调用语法，支持递归嵌套
2. **对话历史构建** - 从 Notebook 单元格加载历史消息，处理多模态内容
3. **图片粘贴处理** - 将粘贴的图片保存到临时目录并生成 Markdown 链接
4. **系统提示词管理** - 初始化规则文件，组装包含规则和运行时上下文的系统提示

## 文件关系

```
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
│  │  │ assembleDocument │  │ resolveUserPromptReferences  │ │  │
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

### contextAssembler.ts

| 导出项 | 类型 | 说明 |
|--------|------|------|
| `ParseMode` | 枚举 | 解析模式：INLINE（内联替换）/ APPEND（追加到缓冲区） |
| `ContextAssembler` | 类 | 核心类，提供上下文组装功能 |
| `ContextAssembler.assembleDocument` | 静态方法 | 递归解析文件引用和工具调用 |
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

### 多模态图片语法

```markdown
![描述](file:///path/to/image.png)
```

图片会被解析为:
```typescript
{ type: 'image_url', image_url: { url: 'data:image/png;base64,...', detail: 'auto' } }
```
