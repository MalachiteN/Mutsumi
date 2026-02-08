# preprocessor.ts

## 功能概述

预处理器模块实现了类似 C 语言预处理器的条件编译功能，用于在上下文组装阶段动态控制内容的包含与排除。

主要功能：
- **宏定义管理** - 使用 `@{define}` 命令定义键值对宏
- **条件编译** - 根据宏定义状态条件性地包含或排除内容
- **条件测试** - 支持字符串相等、包含、正则匹配等多种测试操作
- **嵌套支持** - 条件块可以任意深度嵌套

处理流程：
1. `ContextAssembler.assembleDocument()` 首先检查文本中是否包含 `@{`
2. 如果存在，创建 `Preprocessor` 实例并调用 `process()` 方法
3. 预处理器扫描并执行所有 `@{}` 命令，生成处理后的文本
4. 处理后的文本继续进入文件引用和工具调用解析阶段

## 正则表达式常量

预处理器使用严格的正则表达式匹配命令格式：

| 常量 | 匹配模式 |
|------|----------|
| `DEFINE_REGEX` | `define macro_name , "value"` (宏名允许大小写，逗号前可有空格) |
| `IFDEF_REGEX` | `ifdef MACRO_NAME` |
| `IFNDEF_REGEX` | `ifndef MACRO_NAME` |
| `ENDIF_REGEX` | `endif` |
| `ELSE_REGEX` | `else` |
| `IF_REGEX` | `if MACRO_NAME TEST value` |

## 导出的函数和类

### extractMacroDefinitions

从文本中提取所有 `@{define MACRO_NAME, "value"}` 定义。

```typescript
export function extractMacroDefinitions(text: string): Map<string, string>
```

**参数：**
- `text` - 要搜索的输入文本

**返回值：**
- 宏名称到宏值的 Map

**说明：**
- 扫描文本中所有的 `@{define ...}` 命令块
- 提取宏名称和值，返回为 Map 对象
- 重复的宏定义会被后面的覆盖

**示例：**
```typescript
import { extractMacroDefinitions } from './preprocessor';

const text = `
@{define DEBUG, "true"}
@{define VERSION, "1.0.0"}
@{define PLATFORM, "web"}
`;

const macros = extractMacroDefinitions(text);
// macros.get('DEBUG') === 'true'
// macros.get('VERSION') === '1.0.0'
// macros.get('PLATFORM') === 'web'
```

---

### MacroContext

管理宏定义的容器类。

```typescript
export class MacroContext {
    private macros: Map<string, string>;
    
    constructor();
    define(name: string, value: string): void;
    isDefined(name: string): boolean;
    getValue(name: string): string | undefined;
    setMacros(macros: Record<string, string>): void;
    getMacrosObject(): Record<string, string>;
    clear(): void;
}
```

**方法说明：**

| 方法 | 说明 |
|------|------|
| `constructor()` | 创建空的宏映射表 |
| `define(name, value)` | 定义或覆盖宏 |
| `isDefined(name)` | 检查宏是否已定义 |
| `getValue(name)` | 获取宏的值（未定义返回 undefined） |
| `setMacros(macros)` | 从普通对象批量设置宏（用于反序列化） |
| `getMacrosObject()` | 将所有宏作为普通对象返回（用于序列化） |
| `clear()` | 清除所有宏定义 |

#### setMacros 方法

从普通对象批量设置宏（用于反序列化）。

```typescript
setMacros(macros: Record<string, string>): void
```

**参数：**
- `macros` - 宏名称到值的记录对象

**示例：**
```typescript
const context = new MacroContext();
context.setMacros({
    DEBUG: 'true',
    VERSION: '2.0.0'
});
// 等同于多次调用 define
```

#### getMacrosObject 方法

将所有宏作为普通对象返回（用于序列化）。

```typescript
getMacrosObject(): Record<string, string>
```

**返回值：**
- 宏名称到值的记录对象

**示例：**
```typescript
const context = new MacroContext();
context.define('DEBUG', 'true');
context.define('VERSION', '1.0.0');

const obj = context.getMacrosObject();
// obj = { DEBUG: 'true', VERSION: '1.0.0' }
// 可用于 JSON.stringify 保存到文件
```

#### clear 方法

清除所有宏定义。

```typescript
clear(): void
```

**说明：**
- 清空内部宏映射表
- 可用于重置上下文状态

---

### ConditionFrame (内部接口)

条件栈帧，用于跟踪嵌套条件块的状态。

```typescript
interface ConditionFrame {
    type: 'ifdef' | 'ifndef' | 'if';
    conditionMet: boolean;      // 原始条件是否满足
    currentlyActive: boolean;   // 当前是否处于激活状态
    hasElse: boolean;           // 是否已遇到 else
}
```

---

### PreprocessorResult

预处理器执行结果。

```typescript
export interface PreprocessorResult {
    result: string;     // 处理后的文本
    warnings: string[]; // 警告信息数组
}
```

---

### Preprocessor

预处理器主类。

```typescript
export class Preprocessor {
    private context: MacroContext;
    
    constructor(externalContext?: MacroContext);
    process(text: string): PreprocessorResult;
    getContext(): MacroContext;
}
```

#### constructor

创建 Preprocessor 实例。

```typescript
constructor(externalContext?: MacroContext)
```

**参数：**
- `externalContext` - 可选的外部 MacroContext，如果不提供则创建新的

**说明：**
- 如果不提供外部上下文，预处理器会创建一个新的 MacroContext
- 如果提供外部上下文，预处理器将使用该上下文存储宏定义
- 使用外部上下文可以实现多个预处理器实例之间的宏共享

**示例：**
```typescript
// 创建独立的预处理器
const preprocessor1 = new Preprocessor();

// 使用共享上下文
const sharedContext = new MacroContext();
sharedContext.define('VERSION', '1.0.0');

const preprocessor2 = new Preprocessor(sharedContext);
const preprocessor3 = new Preprocessor(sharedContext);
// preprocessor2 和 preprocessor3 共享相同的宏定义
```

#### process 方法

处理包含预处理器命令的文本。

```typescript
process(text: string): PreprocessorResult
```

**参数：**
- `text` - 包含 `@{}` 命令的源文本

**返回值：**
- `result` - 处理后的文本（已移除条件不满足的内容）
- `warnings` - 处理过程中收集的警告信息

**处理逻辑：**
1. 扫描文本中的所有 `@{...}` 命令块
2. 根据当前条件栈状态决定是否保留命令块之间的文本
3. 执行命令（define、ifdef、if 等）
4. 返回处理结果和警告

#### getContext 方法

获取内部 MacroContext（用于共享上下文）。

```typescript
getContext(): MacroContext
```

**返回值：**
- 此预处理器使用的 MacroContext

**说明：**
- 可用于在多个预处理器之间共享宏定义
- 也可用于序列化/反序列化宏状态

**示例：**
```typescript
const preprocessor = new Preprocessor();
preprocessor.process(`@{define DEBUG, "true"}`);

// 获取上下文并序列化
const context = preprocessor.getContext();
const macros = context.getMacrosObject();
const saved = JSON.stringify(macros);
// saved = '{"DEBUG":"true"}'

// 反序列化并应用到另一个预处理器
const newPreprocessor = new Preprocessor();
const parsedMacros = JSON.parse(saved);
newPreprocessor.getContext().setMacros(parsedMacros);
```

## 支持的预处理器命令

### define

定义一个宏。

**语法：**
```
@{define MACRO_NAME, "value"}
```

**说明：**
- 宏名可以包含大小写字母、数字和下划线，必须以字母或下划线开头（`[A-Za-z_][A-Za-z0-9_]*`）
- 逗号前可以有0到多个空格
- 值必须用双引号包裹
- 重复定义会覆盖之前的值

**示例：**
```
@{define DEBUG, "true"}
@{define myVersion, "1.0.0"}
@{define PLATFORM , "web"}
@{define _internal, "value"}
```

---

### ifdef / ifndef

条件编译块的开始。

**语法：**
```
@{ifdef MACRO_NAME}
内容...
@{endif}

@{ifndef MACRO_NAME}
内容...
@{endif}
```

**说明：**
- `ifdef`：宏已定义时包含内容
- `ifndef`：宏未定义时包含内容

**示例：**
```
@{ifdef DEBUG}
调试信息：当前处于调试模式
@{endif}

@{ifndef PRODUCTION}
开发环境配置
@{endif}
```

---

### if

带测试条件的编译块。

**语法：**
```
@{if MACRO_NAME TEST OPERAND}
内容...
@{endif}
```

**TEST 操作符：**

| 操作符 | 说明 | 示例 |
|--------|------|------|
| `IS` | 完全相等 | `@{if VERSION IS "1.0.0"}` |
| `ISNT` | 不相等 | `@{if TARGET ISNT "web"}` |
| `CONTAINS` | 包含子串 | `@{if LOG_LEVEL CONTAINS "debug"}` |
| `DOESNT_CONTAIN` | 不包含 | `@{if PLATFORM DOESNT_CONTAIN "win"}` |
| `MATCHES` | 正则匹配 | `@{if VERSION MATCHES "^2\\."}` |
| `DOESNT_MATCH` | 正则不匹配 | `@{if TYPE DOESNT_MATCH "test|spec"}` |

**OPERAND 格式：**
- 带引号的字符串 `"value"`
- 或另一个宏名（会被解析为其值）

**示例：**
```
@{if VERSION IS "1.0.0"}
版本 1.0.0 的特定说明
@{endif}

@{if DEBUG ISNT "false"}
调试模式未关闭
@{endif}

@{if LOG_LEVEL CONTAINS "verbose"}
详细日志模式
@{endif}

@{if VERSION MATCHES "^(1\\.|2\\.0)"}
版本 1.x 或 2.0
@{endif}
```

---

### else

翻转条件分支。

**语法：**
```
@{ifdef MACRO}
条件为真时的内容
@{else}
条件为假时的内容
@{endif}
```

**说明：**
- 必须在条件块内部使用
- 每个条件块最多一个 else
- 翻转当前条件块的包含状态

**示例：**
```
@{ifdef DEBUG}
调试构建
- 启用日志
- 保留符号
@{else}
发布构建
- 优化性能
- 移除调试代码
@{endif}
```

---

### endif

结束条件编译块。

**语法：**
```
@{endif}
```

**说明：**
- 每个 `ifdef`/`ifndef`/`if` 必须有对应的 `endif`
- 支持嵌套，按后进先出顺序匹配

## 条件编译嵌套

预处理器完全支持嵌套的条件块。

**嵌套规则：**
- 内层块的条件判断仅在外层块激活时才有效
- 条件状态是累积的：所有外层块都必须激活，内容才会被包含
- `else` 只影响当前层，不影响外层

**示例：**
```
@{define PLATFORM, "web"}
@{define ENV, "development"}

@{ifdef PLATFORM}
平台相关配置

@{if PLATFORM IS "web"}
Web 平台特定设置

@{ifdef ENV}
环境配置：
@{if ENV IS "development"}
- 热重载启用
- 源码映射启用
@{else}
- CDN 资源
- 性能优化
@{endif}
@{endif}

@{endif}
@{endif}
```

## 完整示例

综合示例展示所有功能：

```markdown
@{define TARGET, "web"}
@{define VERSION, "2.0.0"}
@{define BUILD_TYPE, "release"}

# 项目配置

@{if TARGET IS "web"}
## Web 平台配置

@{if BUILD_TYPE IS "debug"}
调试选项：
- SourceMap: enabled
- Minify: false
@{else}
发布选项：
- Minify: true
- Tree shaking: enabled
@{endif}

@{if VERSION MATCHES "^2\\."}
> 这是 2.x 版本，包含破坏性变更
@{endif}

@{else}
## 其他平台配置
- 支持离线模式
- 本地存储优先
@{endif}

## 通用配置
@{define FEATURES, "auth,dashboard,settings"}

@{if FEATURES CONTAINS "auth"}
- 认证模块：已启用
@{endif}

@{if FEATURES CONTAINS "billing"}
- 计费模块：已启用
@{else}
- 计费模块：未启用
@{endif}
```

## 错误处理

预处理器采用"警告而非错误"的策略，确保处理过程不会中断。

**可能产生的警告：**

| 警告 | 原因 |
|------|------|
| `Unmatched else encountered.` | `else` 不在任何条件块内 |
| `Duplicate else encountered...` | 同一条件块内有多个 `else` |
| `Unmatched endif encountered.` | `endif` 没有匹配的开启命令 |
| `Unclosed conditional block.` | 处理结束后仍有未闭合的条件块 |
| `Macro X is not defined.` | 引用了未定义的宏 |
| `Regex error: ...` | 正则表达式语法错误 |
| `Invalid command syntax: @{...}` | 无法识别的命令格式 |

**警告处理示例：**
```typescript
const preprocessor = new Preprocessor();
const { result, warnings } = preprocessor.process(text);

if (warnings.length > 0) {
    console.warn('预处理器警告:', warnings);
}
```

## 使用场景

1. **多平台规则** - 根据操作系统或环境定义不同的规则
2. **版本控制** - 针对不同版本显示不同的说明
3. **调试信息** - 在开发模式包含额外的调试上下文
4. **功能开关** - 条件性地包含实验性功能说明

## 与 ContextAssembler 的集成

```typescript
// 在 contextAssembler.ts 中的调用点
static async assembleDocument(
    text: string,
    workspaceRoot: string,
    allowedUris: string[],
    mode: ParseMode = ParseMode.INLINE,
    appendBuffer?: string[]
): Promise<string> {
    // ===== 预处理器阶段 =====
    if (text.includes('@{')) {
        const preprocessor = new Preprocessor();
        const { result: preprocessedText, warnings } = preprocessor.process(text);
        text = preprocessedText;
        // warnings 可记录到日志
    }

    // 继续处理 @[...] 引用...
    if (!text.includes('@[')) return text;
    // ...
}
```

预处理器在文件引用和工具调用之前执行，确保条件编译在内容解析前完成。

## 高级用法示例

### 共享宏上下文

在多个预处理操作之间共享宏定义：

```typescript
import { Preprocessor, MacroContext } from './preprocessor';

// 创建共享上下文
const sharedContext = new MacroContext();
sharedContext.define('PROJECT_NAME', 'MyApp');
sharedContext.define('VERSION', '2.0.0');

// 多个预处理器共享相同的上下文
const preprocessor1 = new Preprocessor(sharedContext);
const preprocessor2 = new Preprocessor(sharedContext);

// preprocessor1 处理并添加新宏
preprocessor1.process(`@{define FEATURE_X, "enabled"}`);

// preprocessor2 可以看到 preprocessor1 定义的宏
const result = preprocessor2.process(`@{ifdef FEATURE_X}Feature X is enabled@{endif}`);
// result.result = "Feature X is enabled"
```

### 宏状态的序列化与恢复

保存和恢复宏定义状态：

```typescript
import { Preprocessor, MacroContext, extractMacroDefinitions } from './preprocessor';
import * as fs from 'fs';

// 处理文本并提取宏
const text = fs.readFileSync('config.md', 'utf8');
const preprocessor = new Preprocessor();
preprocessor.process(text);

// 保存宏状态到文件
const macros = preprocessor.getContext().getMacrosObject();
fs.writeFileSync('macros.json', JSON.stringify(macros, null, 2));

// 稍后恢复宏状态
const savedMacros = JSON.parse(fs.readFileSync('macros.json', 'utf8'));
const newContext = new MacroContext();
newContext.setMacros(savedMacros);
const newPreprocessor = new Preprocessor(newContext);
```

### 批量提取宏定义

从多个文件中提取所有宏定义：

```typescript
import { extractMacroDefinitions } from './preprocessor';
import * as fs from 'fs';
import * as glob from 'glob';

const allMacros = new Map<string, string>();

// 从多个文件中提取宏
const files = glob.sync('docs/**/*.md');
for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const macros = extractMacroDefinitions(content);
    
    // 合并到总集合
    for (const [name, value] of macros) {
        allMacros.set(name, value);
    }
}

console.log(`Extracted ${allMacros.size} macro definitions`);
// 使用提取的宏创建预处理器上下文
```
