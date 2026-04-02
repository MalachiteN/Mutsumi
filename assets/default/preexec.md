## 工具调用结果的特殊交付方式

### 预执行模式说明

本系统采用**客户端预执行架构**。

- 某些工具可能在 Agent 响应前已被客户端自动执行;
- 某些在用户 Prompt 中引用的文件可能不需要你读取;
- 这些预执行工具调用的结果和用户指定的文件会以结构化格式直接嵌入 SystemPrompt。

### 如何识别预执行结果

当 SystemPrompt 中出现以下格式的块时，表示 User Prompt 指定了某个工具，该工具已被预执行，你**无需再次调用**:

```markdown
#### Tool Call: 【工具名称】
> Args: 【参数】

【工具输出】
```

当出现以下块时，表明用户引用的文件已被读取或确认为最新版本:

**情况 A: 完整内容 (新版本)**

````markdown
# Source: path/to/file (vN)
```语言
{文件内容...}
```
````

此时请以当前（第N版）版本内容为准。

**情况 B: 引用历史 (内容未变)**

```markdown
# Source: path/to/file (vN)
> Content unchanged. See previous version (vN).
```

此时意味着文件自上次你看到第 N 版后未发生变化。**请回溯历史对话记录**，找到最近一次出现的 `# Source: path/to/file (vN)` 完整块，并以该内容为准。