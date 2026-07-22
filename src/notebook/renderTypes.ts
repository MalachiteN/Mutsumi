/**
 * @fileoverview Render block types for agent output rendering.
 * Universal intermediate representation (IR) consumed by NotebookAdapter's
 * custom renderer, HeadlessAdapter's SSE clients, and LiteAdapter.
 * @module notebook/renderTypes
 */

/**
 * Custom MIME type for agent chat render data.
 * Used as the output MIME when passing serialized {@link RenderData} JSON
 * to VSCode notebook cell outputs, consumed by the Mutsumi custom renderer.
 */
export const MUTSUMI_AGENT_CHAT_MIME = 'application/vnd.mutsumi.agent-chat';

/**
 * A single renderable unit of agent output.
 * @description Discriminated union over the three kinds of output the agent
 * produces: markdown content, collapsible reasoning, and tool calls.
 * Blocks in {@link RenderData.committed} are locked and never re-rendered.
 */
export type RenderBlock =
    | { type: 'content'; markdown: string }
    | { type: 'reasoning'; markdown: string; collapsed: boolean }
    | {
        type: 'toolCall';
        /** Tool name (e.g. 'read') */
        name: string;
        /** Tool arguments (complete or best-effort partial while streaming) */
        args: Record<string, any>;
        /** Human-readable summary of the tool call */
        summary: string;
        /** Execution result, present once the tool has finished */
        result?: string;
        /** Whether this tool call is still streaming (pending) */
        isStreaming: boolean;
        /** Optional hints for rendering arguments as code blocks */
        renderingConfig?: {
            /** Argument names to render as fenced code blocks */
            argsToCodeBlock?: string[];
            /** Argument names holding the file path for each code block (language detection) */
            codeBlockFilePaths?: (string | undefined)[];
        };
    };

/**
 * Structured agent output for incremental rendering.
 * @description Split into a locked (committed) prefix and a live (active)
 * streaming tail. Renderers should DOM-cache committed blocks and only
 * re-render the active area on each update.
 */
export interface RenderData {
    /** Locked blocks, rendered once and DOM-cached, never re-rendered */
    committed: RenderBlock[];
    /** Current streaming area, re-rendered on each token update; null when idle */
    active: {
        reasoning: string;
        content: string;
        pendingTools: RenderBlock[];
    } | null;
}
