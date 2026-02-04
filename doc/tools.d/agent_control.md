# agent_control.ts

## 功能概述

`agent_control.ts` 实现了 Mutsumi Agent 系统的核心控制功能，包括子 Agent 分叉（Fork）和任务完成报告机制。这是实现并行任务处理和父子 Agent 协作的关键模块。

---

## 主要工具

### `selfForkTool` - 子 Agent 分叉工具

将当前 Agent 拆分为多个并行运行的子 Agent，实现任务的并行处理。

**工具定义：**

| 属性 | 值 |
|------|-----|
| 名称 | `self_fork` |
| 描述 | 创建多个并行子 Agent，当前 Agent 将挂起直到所有子 Agent 完成 |

**参数：**

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| `context_summary` | `string` | 是 | 子 Agent 的上下文摘要（当前版本未使用，可传空字符串） |
| `sub_agents` | `array` | 是 | 子 Agent 配置数组 |

**`sub_agents` 数组项结构：**

| 属性 | 类型 | 必需 | 描述 |
|------|------|------|------|
| `prompt` | `string` | 是 | 子 Agent 的指令 |
| `allowed_uris` | `string[]` | 是 | 子 Agent 允许访问的路径 |

**执行流程：**

```
1. 验证 Notebook 上下文和 Agent UUID
2. 验证 sub_agents 数组非空
3. 显示创建子 Agent 的通知
4. 调用 AgentOrchestrator 执行分叉
5. 挂起当前 Agent，等待所有子 Agent 完成
6. 返回子 Agent 的执行报告
```

**返回值：**

- 成功：子 Agent 执行报告汇总
- 失败：错误消息（如不在 Notebook 环境、UUID 不存在、sub_agents 为空等）

**使用示例：**

```typescript
await selfForkTool.execute({
    context_summary: '并行处理多个文件',
    sub_agents: [
        {
            prompt: '分析 src/utils.ts 文件',
            allowed_ris: ['/workspace/project/src']
        },
        {
            prompt: '分析 src/config.ts 文件',
            allowed_uris: ['/workspace/project/src']
        }
    ]
}, context);
```

---

### `taskFinishTool` - 任务完成工具

子 Agent 使用此工具报告任务完成，提交执行结果。

**工具定义：**

| 属性 | 值 |
|------|-----|
| 名称 | `task_finish` |
| 描述 | 标记任务完成并提交报告 |

**参数：**

| 参数 | 类型 | 必需 | 描述 |
|------|------|------|------|
| `context_summary` | `string` | 是 | 最终执行报告 |

**执行流程：**

```
1. 验证 Notebook 上下文和 Agent UUID
2. 获取执行报告内容
3. 调用 AgentOrchestrator 报告任务完成
4. 返回确认消息
```

**返回值：**

- `'Task Finished. Report submitted.'` - 报告提交成功

**使用场景：**

子 Agent 完成任务后必须调用此工具，父 Agent 才能继续执行。

```typescript
await taskFinishTool.execute({
    context_summary: '已完成文件分析，发现 3 个潜在问题...'
}, context);
```

---

## 核心依赖

| 依赖 | 用途 |
|------|------|
| `AgentOrchestrator` | 管理 Agent 生命周期和分叉协调 |
| `interface.ts` | 工具接口定义 |

---

## Agent 分叉生命周期

```
┌─────────────┐
│  父 Agent   │
└──────┬──────┘
       │ self_fork
       ▼
┌─────────────────────────┐
│ 创建多个子 Agent 文件    │
│ 显示在侧边栏             │
└──────┬──────────────────┘
       │
       ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  子 Agent 1 │  │  子 Agent 2 │  │  子 Agent N │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                │                │
       │ 并行执行        │ 并行执行        │ 并行执行
       │                │                │
       ▼                ▼                ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ task_finish │  │ task_finish │  │ task_finish │
└─────────────┘  └─────────────┘  └─────────────┘
       │                │                │
       └────────────────┼────────────────┘
                        ▼
              ┌─────────────────┐
              │ 所有子 Agent 完成 │
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │   父 Agent 恢复   │
              │  接收执行报告汇总  │
              └─────────────────┘
```

---

## 注意事项

1. **必须在 Notebook 环境**：这两个工具只能在 Mutsumi Notebook 中使用
2. **UUID 依赖**：需要 Agent 有有效的 UUID 才能执行
3. **阻塞特性**：`self_fork` 会阻塞父 Agent 直到所有子 Agent 完成
4. **必须调用 task_finish**：子 Agent 必须通过 `task_finish` 结束，否则父 Agent 将一直等待
