/**
 * @fileoverview UI Renderer for agent notebook cell output.
 * Produces structured {@link RenderData} (RenderBlock IR) instead of HTML strings,
 * implementing a three-level locking scheme so committed blocks never re-render.
 * @module agent/uiRenderer
 */

import { RenderBlock, RenderData } from '../notebook/renderTypes';
import { tryParsePartialJson } from './utils';
import type { ToolSet } from '../tools.d/toolManager';

/**
 * Accumulates agent output as structured render blocks.
 * @description Maintains a committed block list (locked, rendered once) plus an
 * active streaming area (re-rendered per token). Three locking levels:
 * - L1 (round): commitRoundUI() moves all remaining active content into committed.
 * - L2 (intra-round): reasoning locks when content starts; content locks when tools start.
 * - L3 (tool): appendBlock() commits each finished tool call.
 * @class UIRenderer
 * @example
 * const renderer = new UIRenderer();
 * const data = renderer.updateActive(content, reasoning, pendingTools);
 * renderer.commitRoundUI(finalContent, finalReasoning);
 */
export class UIRenderer {
    /** Locked blocks, rendered once and never re-rendered */
    private committedBlocks: RenderBlock[] = [];
    /** Streaming reasoning for the current round (emptied once locked) */
    private activeReasoning: string = '';
    /** Streaming content for the current round (emptied once locked) */
    private activeContent: string = '';
    /** Streaming (pending) tool calls for the current round */
    private activeTools: RenderBlock[] = [];
    /** Whether the current round's reasoning has been locked into committed */
    private reasoningLocked: boolean = false;
    /** Whether the current round's content has been locked into committed */
    private contentLocked: boolean = false;

    /**
     * Updates the active streaming area, auto-detecting L2 lock transitions.
     * @description Called on each streaming progress callback with the round's
     * accumulated values. When content first arrives, any accumulated reasoning
     * is locked into committed; when pending tools first arrive, any accumulated
     * content is locked into committed.
     * @param {string} content - Accumulated content for the current round
     * @param {string} reasoning - Accumulated reasoning for the current round
     * @param {RenderBlock[]} pendingTools - Pending (streaming) tool call blocks
     * @returns {RenderData} Full render data for replaceOutput
     */
    updateActive(content: string, reasoning: string, pendingTools: RenderBlock[]): RenderData {
        // L2: content started → reasoning is complete, lock it
        if (!this.reasoningLocked && content.length > 0 && this.activeReasoning.length > 0) {
            this.committedBlocks.push({
                type: 'reasoning',
                markdown: this.activeReasoning,
                collapsed: true
            });
            this.activeReasoning = '';
            this.reasoningLocked = true;
        }
        // L2: tools started → content is complete, lock it
        if (!this.contentLocked && pendingTools.length > 0 && this.activeContent.length > 0) {
            this.committedBlocks.push({ type: 'content', markdown: this.activeContent });
            this.activeContent = '';
            this.contentLocked = true;
        }
        // Keep only the still-unlocked sections in the active area
        this.activeReasoning = this.reasoningLocked ? '' : reasoning;
        this.activeContent = this.contentLocked ? '' : content;
        this.activeTools = pendingTools;
        return this.getRenderData();
    }

    /**
     * L1 lock: commits all remaining active content at round end.
     * @description Called after the stream completes (before tool execution).
     * Commits anything still active; the content/reasoning arguments serve as a
     * fallback for sections that never passed through updateActive. Per-round
     * state is then reset for the next round.
     * @param {string} content - Final accumulated content of the round
     * @param {string} reasoning - Final accumulated reasoning of the round
     */
    commitRoundUI(content: string, reasoning: string): void {
        const pendingReasoning = this.reasoningLocked ? '' : (this.activeReasoning || reasoning);
        const pendingContent = this.contentLocked ? '' : (this.activeContent || content);
        if (pendingReasoning) {
            this.committedBlocks.push({
                type: 'reasoning',
                markdown: pendingReasoning,
                collapsed: true
            });
        }
        if (pendingContent) {
            this.committedBlocks.push({ type: 'content', markdown: pendingContent });
        }
        this.reasoningLocked = false;
        this.contentLocked = false;
        this.activeReasoning = '';
        this.activeContent = '';
        this.activeTools = [];
    }

    /**
     * L3 lock: appends a completed block (e.g. a finished tool call) to committed.
     * @param {RenderBlock} block - The block to commit
     */
    appendBlock(block: RenderBlock): void {
        this.committedBlocks.push(block);
    }

    /**
     * Formats a tool call as a structured RenderBlock.
     * @description Argument separation (regular args vs code-block args) is deferred
     * to the renderer via renderingConfig; no HTML is generated here.
     * @param {string} name - Tool name
     * @param {any} toolArgs - Tool arguments (complete or partial)
     * @param {string} prettyPrintSummary - Human-readable summary
     * @param {boolean} isStreaming - Whether this is a pending/streaming tool call
     * @param {string} [toolResult] - Execution result (for finished calls)
     * @param {Object} [renderingConfig] - Code-block rendering hints for the renderer
     * @returns {RenderBlock} The tool call render block
     */
    formatToolCall(
        name: string,
        toolArgs: any,
        prettyPrintSummary: string,
        isStreaming: boolean,
        toolResult?: string,
        renderingConfig?: { argsToCodeBlock?: string[]; codeBlockFilePaths?: (string | undefined)[] }
    ): RenderBlock {
        const safeArgs = (typeof toolArgs === 'object' && toolArgs !== null) ? toolArgs : {};
        return {
            type: 'toolCall',
            name,
            args: safeArgs,
            summary: prettyPrintSummary,
            result: toolResult,
            isStreaming,
            renderingConfig
        };
    }

    /**
     * Formats pending (streaming) tool calls as RenderBlocks.
     * @description Iterates through partial tool calls, best-effort parses their
     * arguments, and looks up pretty print summaries and rendering configs.
     * @param {any[]} partialToolCalls - Partial tool call objects from the stream
     * @param {ToolSet} toolSet - Tool set instance for looking up tool metadata
     * @param {boolean} _isSubAgent - Whether the caller is a sub-agent session
     * @returns {RenderBlock[]} Pending tool call blocks
     */
    formatPendingToolCalls(
        partialToolCalls: any[] | undefined,
        toolSet: ToolSet,
        _isSubAgent?: boolean
    ): RenderBlock[] {
        if (!partialToolCalls || partialToolCalls.length === 0) {
            return [];
        }
        const blocks: RenderBlock[] = [];
        for (const ptc of partialToolCalls) {
            const toolName = ptc.function?.name;
            if (!toolName) { continue; }
            const args = tryParsePartialJson(ptc.function?.arguments);
            const summary = toolSet.getPrettyPrint(toolName, args);
            const config = toolSet.getRenderingConfig(toolName);
            blocks.push(this.formatToolCall(toolName, args, summary, true, undefined, config));
        }
        return blocks;
    }

    /**
     * Gets the full render data (committed + active).
     * @returns {RenderData} Current render data; active is null when nothing is streaming
     */
    getRenderData(): RenderData {
        const hasActive = this.activeReasoning.length > 0 ||
                          this.activeContent.length > 0 ||
                          this.activeTools.length > 0;
        return {
            committed: [...this.committedBlocks],
            active: hasActive ? {
                reasoning: this.activeReasoning,
                content: this.activeContent,
                pendingTools: [...this.activeTools]
            } : null
        };
    }

    /**
     * Gets render data containing only committed blocks.
     * @description Used after tool execution or stream errors, when no streaming
     * area should be displayed.
     * @returns {RenderData} Committed-only render data (active: null)
     */
    getCommittedRenderData(): RenderData {
        return {
            committed: [...this.committedBlocks],
            active: null
        };
    }
}
