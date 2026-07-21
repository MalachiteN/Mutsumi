# Final Target State: Custom Notebook Renderer (Phase 1)

## 目标

用自定义 Notebook 渲染器替换 VSCode 内置 Markdown 渲染器，彻底消除流式全量重渲染开销。

## 核心架构变更

### 1. RenderBlock —— 通用中间表示 (IR)

```typescript
// src/notebook/renderTypes.ts

export type RenderBlock =
  | { type: 'content'; markdown: string }
  | { type: 'reasoning'; markdown: string; collapsed: boolean }
  | {
      type: 'toolCall';
      name: string;
      args: Record<string, any>;
      summary: string;
      result?: string;
      isStreaming: boolean;
      renderingConfig?: {
        argsToCodeBlock?: string[];
        codeBlockFilePaths?: (string | undefined)[];
      };
    };

export interface RenderData {
  /** 已锁定的渲染块，渲染一次后 DOM 缓存，永不重渲染 */
  committed: RenderBlock[];
  /** 当前流式区域，每次 token 更新时重渲染 */
  active: {
    reasoning: string;
    content: string;
    pendingTools: RenderBlock[];
  } | null;
}
```

### 2. UIRenderer 壳化 (src/agent/uiRenderer.ts)

产出 `RenderData` 而非 HTML 字符串。实现三级锁定机制：

**锁转换点：**
- L1 跨轮锁定: `commitRoundUI()` → 所有 active 内容移入 committed
- L2 轮内子段锁定:
  - reasoning → locked 当 content 开始到达
  - content → locked 当 tool_calls 开始到达
- L3 工具级锁定: 每个工具执行完毕后 appendBlock 到 committed，前一个工具自然锁定

**公开接口：**
```typescript
class UIRenderer {
  private committedBlocks: RenderBlock[];
  private activeReasoning: string;
  private activeContent: string;
  private activeTools: RenderBlock[];
  private reasoningLocked: boolean;
  private contentLocked: boolean;

  // 流式回调中调用，自动检测锁转换
  updateActive(content: string, reasoning: string, pendingTools: RenderBlock[]): RenderData;

  // 流结束时调用，锁定本轮所有内容
  commitRoundUI(content: string, reasoning: string): void;

  // 工具执行完毕后追加到 committed
  appendBlock(block: RenderBlock): void;

  // 格式化工具调用为 RenderBlock（无 HTML）
  formatToolCall(args, summary, isStreaming, result?, renderingConfig?): RenderBlock;
  formatPendingToolCalls(partialToolCalls, toolSet, isSubAgent?): RenderBlock[];

  // 获取已提交块数组（用于工具回调后更新输出）
  getCommittedBlocks(): RenderBlock[];

  // 生成完整 RenderData
  getRenderData(): RenderData;
}
```

### 3. IAgentSession 接口变更

```typescript
// src/adapters/interfaces.ts
interface IAgentSession {
  // 增加 mimeType 参数
  appendOutput(content: string, options?: { isMarkdown?: boolean; mimeType?: string }): Promise<void>;
  replaceOutput(content: string, options?: { isMarkdown?: boolean; mimeType?: string }): Promise<void>;
  // ... 其余不变
}
```

### 4. NotebookAdapter MIME 变更

```typescript
// 当 mimeType 为 'application/vnd.mutsumi.agent-chat' 时：
await this.execution.replaceOutput([
  new vscode.NotebookCellOutput([
    vscode.NotebookCellOutputItem.json(JSON.parse(content), 'application/vnd.mutsumi.agent-chat')
  ])
]);
```

### 5. Serializer 变更

`renderInteractionToMarkdown()` → `buildInteractionRenderBlocks()`，返回 `RenderBlock[]`。
反序列化时 output item 使用 `application/vnd.mutsumi.agent-chat` MIME 类型。

### 6. 自定义渲染器 (src/notebook/renderer.ts)

```typescript
// 入口：VSCode renderer module
export function activate() {
  return {
    renderOutputItem(outputItem, element, signal) {
      const data: RenderData = JSON.parse(new TextDecoder().decode(outputItem.data));
      // 增量渲染：committed 只追加新块，active 全量替换
    },
    disposeOutputItem(outputId) {
      // 清理 DOM 缓存
    }
  };
}
```

**增量渲染策略：**
- 维护 `Map<outputId, { committedDom: HTMLElement, lastCommittedLength: number, activeDom?: HTMLElement }>`
- committed: 只渲染 `lastCommittedLength` 之后的新块，追加到 DOM 缓存
- active: 每次移除旧 activeDom，创建新的（小，开销低）
- micromark 解析 markdown → HTML，插入到对应 block DOM

### 7. 构建配置

esbuild.js 增加第二个构建目标：
```javascript
const rendererCtx = await esbuild.context({
  entryPoints: ["src/notebook/renderer.ts"],
  platform: "browser",
  format: "cjs",
  bundle: true,
  outfile: "dist/notebookRenderer.js",
  external: [],  // micromark 全部 bundle
});
```

### 8. package.json 贡献点

```json
{
  "notebookRenderer": [
    {
      "id": "mutsumi-agent-renderer",
      "displayName": "Mutsumi Agent Chat Renderer",
      "entrypoint": "./dist/notebookRenderer.js",
      "mimeTypes": ["application/vnd.mutsumi.agent-chat"]
    }
  ],
  "dependencies": {
    "micromark": "^4.0.0",
    "micromark-extension-gfm": "^2.0.0"
  }
}
```

### 9. 清理项

- `src/utils.ts`: 删除 `wrapInThemedContainer()`，保留 `getLanguageIdentifier()`
- `src/agent/uiRenderer.ts`: 删除所有 HTML 生成逻辑、`wrapInThemedContainer` 调用

## LiteAdapter 分析结论

LiteAdapter **不需要额外处理**。原因：
- `generateTitle()` 和 `compressConversation` 从 `runner.run()` 返回的 `newMessages` 提取结果
- `newMessages` 中的 `content` 直接来自 LLM 流式累积 (`roundContent`)，与 `replaceOutput`/`outputBuffer` 完全无关
- `getCurrentOutput()` 仅被 `httpServer/chat.ts` 调用 (HeadlessAdapter)，LiteAdapter 的 `outputBuffer` 无人外部读取

## SSE 改进 (Phase 2 方向，Phase 1 仅签名适配)

当前 SSE 发送 `output.slice(lastOutputLength)` 作为 delta（任意切割 markdown）。
改造后可发送结构化事件：
```
{ event: 'block', data: RenderBlock JSON }
{ event: 'active', data: RenderData.active JSON }
{ event: 'done', data: { messageCount: N } }
```
Phase 1 仅适配 `replaceOutput` 签名，SSE delta 逻辑暂不动。

## 范围边界

**Phase 1 做：**
- RenderBlock IR 定义
- UIRenderer 壳化 + 三级锁定
- 自定义渲染器 (micromark + 增量 DOM)
- 所有 adapter 签名适配
- 构建配置 + package.json
- wrapInThemedContainer 清理

**Phase 1 不做：**
- SSE delta 格式改造（仅签名适配）
- 从 llmStream 直接接线到 renderer（未来 phase）
- 删除 UIRenderer 文件本身（保留壳）
