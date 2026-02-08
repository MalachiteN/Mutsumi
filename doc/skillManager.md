# Skill Manager

`SkillManager` 负责管理动态加载的 Markdown 技能（Skills）。它允许用户通过编写带有特定元数据和模板语法的 `.skill.md` 文件来扩展 Agent 的工具集。

## 核心功能

1.  **技能发现**：扫描工作区 `.mutsumi/skills` 目录下的 `.skill.md` 文件。
2.  **技能编译与缓存**：
    *   使用 `ContextAssembler` 解析 Markdown 文件，处理引用（Reference）和上下文组装。
    *   提取 YAML Front Matter 中的元数据（Description, Params）。
    *   将预处理后的内容（flattened）缓存到 `.mutsumi/skills/cache`，以提高后续加载速度。
3.  **工具注册**：
    *   将每个 Skill 注册为一个标准的 `ITool`。
    *   工具名称为文件名去掉后缀（例如 `my_skill.skill.md` -> `my_skill`）。
    *   工具参数由 Front Matter 中的 `Params` 定义，全部视为字符串类型。
4.  **技能执行**：
    *   当 Agent 调用 Skill 工具时，`SkillManager` 读取缓存文件。
    *   将传入的参数通过 `@{define key, value}` 语法注入到文件头部。
    *   使用 `Preprocessor` 执行条件编译（如 `@{if param}...@{endif}`）。
    *   返回处理后的文本作为工具执行结果。

## Skill 文件格式

一个标准的 `.skill.md` 文件结构如下：

```markdown
---
Description: "技能描述，说明该技能的用途"
Params: ['target_file', 'instruction']
---

这是一个动态生成的技能模板。

目标文件：@{target_file}

@{if instruction}
额外指令：@{instruction}
@{endif}

这里可以包含其他文件引用：
@[src/utils.ts]
```

## 类设计

### SkillManager (Singleton)

*   **getInstance()**: 获取单例实例。
*   **loadSkills()**: 扫描并加载所有 Skill。
*   **getTools()**: 获取所有已注册的 Skill 工具列表。

### 内部流程

1.  **loadSkills**:
    *   检查 `.mutsumi/skills` 是否存在。
    *   遍历 `.skill.md` 文件。
    *   对每个文件调用 `processSkillFile`。

2.  **processSkillFile**:
    *   检查 `.mutsumi/skills/cache` 下是否存在对应缓存。
    *   **缓存命中**：直接读取缓存的 Description 和 Params。
    *   **缓存未命中**：
        *   读取源文件。
        *   调用 `ContextAssembler.prepareSkill` 进行展开和解析。
        *   生成包含 Front Matter 和展开后内容的缓存文件。
        *   写入缓存目录。
    *   调用 `registerSkillTool` 注册工具。

3.  **registerSkillTool**:
    *   创建 `ITool` 对象。
    *   `execute` 方法实现：
        *   读取缓存内容。
        *   拼接 `@{define}` 语句。
        *   调用 `Preprocessor.process`。
        *   返回最终文本。

## 集成

`SkillManager` 被 `ToolManager` 调用：
*   `ToolManager.loadSkills()` 代理调用 `SkillManager.loadSkills()`。
*   `ToolManager.getToolsDefinitions()` 合并 Skill 工具。
*   `ToolManager.executeTool()` 分发 Skill 工具调用。
