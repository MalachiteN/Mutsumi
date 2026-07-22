# 工具改名与合并实施计划

> 本文档是工具改名/合并工程的**唯一权威设计依据**。所有参与实施的子 agent 必须以本文档为准。
> 本文档只描述**目标状态、行为契约、影响范围、验收标准**，不规定具体实现方式——实现细节由实施者自主设计。

## 1. 背景与动机

当前工具命名存在三类问题：

1. **冗长且动词错位**：`read_file`/`create_or_replace`/`edit_file_search_replace` 等名字冗长；`read_partial_around_keyword` 名字描述的是实现机制（read partial）而非调用者意图（search in file），已导致多次模型误调度。
2. **人为制造决策点**：`search_file_contains_keyword`（仅目录）与 `read_partial_around_keyword`（仅文件）的能力本是一体（grep 对文件和目录通吃），拆成两个工具凭空制造了"文件还是目录"的分类决策，且错误处理存在缺陷（裸 catch 将参数错误谎报为"用户终止"，Phase 0 已修复 `search_fs.ts` 中的两处）。
3. **能力割裂**：`ls` 与 `get_file_size` 同属文件系统元信息查询，拆开导致模型需要两次调用才能获得目录项的大小信息。

本项目为单人使用，**不做 alias 兼容层**，旧 API 直接废弃。

## 2. 目标命名总表

| 旧名 | 新名 | 变更类型 |
|---|---|---|
| `read_file` | `read` | 纯改名 |
| `create_or_replace` | `write` | 纯改名 |
| `edit_file_search_replace` | `edit` | 纯改名 |
| `ls` + `get_file_size` | `glob` | **合并**（语义扩展） |
| `search_file_contains_keyword` + `read_partial_around_keyword` | `grep` | **合并**（语义扩展） |
| `search_file_name_includes` | `find_filename` | 纯改名 |
| `get_warning_error` | `diagnostics` | 纯改名 |
| `read_partial_by_range` | `read_partial` | 纯改名 |

**未列入上表的工具一律不改名**（`shell`, `get_env_var`, `system_info`, `mkdir`, `project_outline`, `get_shell_output`, `kill_shell_task`, `dispatch_subagents`, `task_finish`, `get_agent_types`, `query_codebase`）。

> 命名说明：`glob` 一词在此处的语义是"文件系统条目枚举与元信息查询"（文件则报大小，目录则列条目），不是"按模式匹配"（那是 `find_filename` 的职责）。实施者若认为实现后有更贴切的命名，可提出但需在交付说明中显式声明并全量一致替换。

## 3. 合并工具的行为契约

### 3.1 `grep`（合并 `search_file_contains_keyword` + `read_partial_around_keyword`）

**核心语义**：在文件或目录中搜索关键词。`uri` 参数同时接受文件和目录，由工具内部自行区分，调用方无需关心。

**必须满足的行为要求**：

1. **路径类型自适配**：对 `uri` 做 stat（或等价判断），目录走递归搜索，文件走单文件搜索。路径不存在时返回明确的错误消息（不得谎报为"用户终止"）。
2. **目录模式**：保持现有 `search_file_contains_keyword` 的能力与防护——忽略 `COMMON_IGNORE_GLOBS`、结果文件数上限、跳过二进制文件、超长行截断。输出格式为 `path:line:content`。
3. **文件模式**：保持现有 `read_partial_around_keyword` 的能力——支持上下文行（`lines_before`/`lines_after`），合并重叠上下文区域，不相交区域之间用 `...` 分隔。两个上下文参数改为**可选，默认 0**（现状是必填，迫使模型每次传 `0,0`，属于 schema 缺陷）。建议输出同样带 `path:line:content` 前缀以与目录模式统一（实施者可自行权衡）。
4. **错误诚实**：仅在 `abortSignal` 真实中止时返回 `[Interrupted]` 类消息；其他任何异常（路径错误、权限错误、编码错误等）必须返回真实错误信息。`search_fs.ts` 中 Phase 0 建立的模式（catch 中先判 `abortSignal.aborted`）是必须保持的底线。
5. **参数命名**：`uri` 与 `keyword` 保持不变（全项目工具参数风格一致）。
6. **description 文本**：必须明确写出"同时接受文件和目录"以及输出格式，这是防止误调度的关键文案。

### 3.2 `glob`（合并 `ls` + `get_file_size`）

**核心语义**：查询文件系统条目的元信息。`uri` 参数同时接受文件和目录。

**必须满足的行为要求**：

1. **路径类型自适配**：文件返回大小信息；目录返回条目列表。
2. **目录模式**：保持现有 `ls` 的排序与类型标注能力，并**为每个条目附加大小信息**；在 POSIX 系统上再追加权限标志位（如 `drwxr-xr-x`）。Windows 上不显示权限位。
3. **文件模式**：保持现有 `get_file_size` 的输出语义（KB + bytes）。
4. **目录不存在或为空**：返回明确、友好的消息。
5. **description 文本**：明确写出"文件则返回大小，目录则列出条目（含大小，POSIX 含权限位）"，并保留原 `get_file_size` 中"读/写文件前先查大小以决定读取策略"的提示语义。

### 3.3 纯改名工具的要求

`read` / `write` / `edit` / `find_filename` / `diagnostics` / `read_partial`：

- `ITool.name` 与 `definition.function.name` 同时改为新名，二者必须始终一致（LLM 看到的是 `definition.function.name`）。
- `execute` 行为**完全不变**。
- `prettyPrint` 文案保持不变（文案中不含工具名，无需改）。
- 错误消息、中断消息中硬编码的旧工具名（若有）必须同步更新。

## 4. 影响范围清单（必须全部覆盖）

以下位置经全仓库逐一排查确认，**每一处都必须改到**。实施完成后须按第 5 节的验证方法复查。

### 4.1 工具定义与注册（TypeScript 源码）

| 文件 | 需要改的内容 |
|---|---|
| `src/tools.d/tools/read_file.ts` | `name` ×2（`ITool.name` + `definition.function.name`） |
| `src/tools.d/tools/create_or_replace.ts` | `name` ×2；`handleEdit(..., 'create_or_replace')` 内部调用中的工具名字符串（该字符串会进入编辑事务状态与中断消息） |
| `src/tools.d/tools/edit_file_search_replace.ts` | `name` ×2；`handleEdit(..., 'edit_file_search_replace')` 内部调用中的工具名字符串 |
| `src/tools.d/tools/ls.ts` | 整个工具并入 `glob`（文件可重命名或合并到 `system_info.ts`，由实施者决定） |
| `src/tools.d/tools/system_info.ts` | `getFileSizeTool` 并入 `glob`；**`systemInfoTool` 与 `getEnvVarTool` 保留不动** |
| `src/tools.d/tools/search_fs.ts` | 整个文件重构为 `grep`（文件可重命名为 `grep.ts`，由实施者决定）；`searchFileNameIncludesTool` 改名为 `find_filename`（保留在原文件或独立成文件均可） |
| `src/tools.d/tools/read_partial.ts` | `readPartialByRangeTool` 改名为 `read_partial`；`readPartialAroundKeywordTool` 并入 `grep` 后从此文件移除 |
| `src/tools.d/tools/get_warning_error.ts` | `name` ×2 |
| `src/tools.d/toolManager.ts` | `TOOL_NAME_MAPPING` 中所有旧名键替换为新名；被合并移除的工具（`readPartialAroundKeywordTool`、`searchFileContainsKeywordTool`、`lsTool`、`getFileSizeTool`）的 import、`TOOL_NAME_MAPPING` 条目、`commonTools` 数组条目全部移除或替换；`getWarningErrorTool` 等 import 保持不变 |
| `src/tools.d/edit_file.ts` | `handleEdit`/`requestEdit` 的 `toolName` 默认值 `"edit_file"` —— 评估是否随新名更新（该默认值仅在调用方未传名时使用；目前两个调用方都显式传名） |

### 4.2 默认配置

| 文件 | 需要改的内容 |
|---|---|
| `src/config/types.ts` | `DEFAULT_MUTSUMI_CONFIG.toolSets` 中所有旧名替换为新名（`read` 工具集 11 处、`deliver` 工具集 2 处） |

### 4.3 LLM 提示词与规则资产

| 文件 | 需要改的内容 |
|---|---|
| `assets/default/write_file.md` | 第 3 行 `edit_file_search_replace` → `edit`；第 5 行 `create_or_replace` → `write`。**此文件还会被 `assets/default/implementer.md` 通过 `@[...]` 引用，内容会直接进入 implementer agent 的系统提示** |
| `src/contextManagement/skillManager.ts` | 第 297 行与第 323 行的指令文本 `"Immediately read_file the skill's SKILL.md ..."` 中的 `read_file` → `read`（JSDoc 注释与运行时字符串各一处） |

### 4.4 面向用户的文档与配置示例

| 文件 | 需要改的内容 |
|---|---|
| `package.json` | `mutsumi.agentConfig` 的 `markdownDescription` 内嵌示例 JSON 中的 `"read": ["read_file", "ls"]` 与 `"deliver": ["shell", "create_or_replace"]` |
| `README.md` | 第 277–281 行内置工具清单：改为新名。**注意现有清单中 `edit_file`、`create_file`、`get_available_models` 三个名字本来就不存在，属于历史遗留错误，本次顺手修正为真实工具名** |
| `README_zh.md` | 同上（第 277–281 行） |
| `docs/AGENT_TYPES_DESIGN.md` | 第 165–188 行 toolSets 示例中全部旧名 |
| `docs/AGENT_TYPES_DESIGN_CN.md` | 同上 |

### 4.5 代码注释

| 文件 | 需要改的内容 |
|---|---|
| `src/tools.d/tools/rag.ts` | 第 16–18 行注释中的 `read_file` → `read`、`ls` → `glob`、`search_file_contains_keyword` → `grep` |
| `src/notebook/renderTypes.ts` | 第 26 行注释 `/** Tool name (e.g. 'read_file') */` 中的示例名 |

### 4.6 历史文档（明确保留不改）

- `docs/CHANGES_IN_TOOL_SYSTEM_CN.md`：其中的 `edit_file_*` 是历史描述，属于当时状态的记录，不改。
- 旧的 `.mtm` 会话文件：重开时旧工具名的 `prettyPrint` 会退化为 `"Tool Call: <旧名>"`、`renderingConfig` 缺失导致代码块降级为列表。**已知且可接受**（单人项目），不做迁移。

## 5. 验收标准

实施完成后必须逐项验证：

1. **编译通过**：`npm run compile`（含 `tsc --noEmit`、`tsc --noEmit -p tsconfig.renderer.json`、esbuild）全部退出码 0。
2. **旧名清零**：用全仓库搜索确认以下字符串在**除 `docs/CHANGES_IN_TOOL_SYSTEM_CN.md` 与本文档之外**的任何文件中不再出现：
   `read_file`、`create_or_replace`、`edit_file_search_replace`、`read_partial_around_keyword`、`read_partial_by_range`、`search_file_contains_keyword`、`search_file_name_includes`、`get_file_size`、`get_warning_error`
   （`read_file` 需注意排除 `handleEdit`/`edit_file.ts` 中的 `edit_file` 子串误判；搜索时用语义判断而非机械匹配。）
3. **新名全量出现**：`read`、`write`、`edit`、`grep`、`glob`、`find_filename`、`diagnostics`、`read_partial` 在工具定义、注册表、默认配置三处同时存在且拼写一致。
4. **行为抽查**：`grep` 对文件和目录各搜一次；`glob` 对文件和目录各查一次；`edit`/`write`/`read` 各调用一次。
5. **无 alias 残留**：不存在任何旧名→新名的映射代码。

## 6. 分工

| 子任务 | 负责范围 | 允许修改的 URI |
|---|---|---|
| **A：核心工具层** | 第 4.1 节全部 + 第 4.2 节 | `src/tools.d/`、`src/config/types.ts` |
| **B：提示词与文档层** | 第 4.3、4.4、4.5 节 | `assets/default/write_file.md`、`src/contextManagement/skillManager.ts`、`package.json`、`README.md`、`README_zh.md`、`docs/AGENT_TYPES_DESIGN.md`、`docs/AGENT_TYPES_DESIGN_CN.md`、`src/notebook/renderTypes.ts` |

两个子任务**文件集合互不重叠**，可并行执行。两边都以第 2 节的命名总表为唯一命名依据，不得自行发明新名。

## 7. 已完成的前置工作（Phase 0）

`src/tools.d/tools/search_fs.ts` 中两处裸 `catch` 已修复：异常时先检查 `abortSignal.aborted`，仅在真实中止时返回 `[Interrupted]` 消息，否则返回真实错误信息。实施 `grep` 合并时必须保留这一模式。
