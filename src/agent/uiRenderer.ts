/**
 * @fileoverview UI Renderer for agent notebook cell output.
 * @module uiRenderer
 */

import { wrapInThemedContainer, getLanguageIdentifier } from '../utils';
import { tryParsePartialJson } from './utils';
import { ToolSet } from '../tools.d/toolManager';

/**
 * Handles UI rendering and output management for agent execution.
 * @description Manages the accumulation and display of HTML/Markdown content
 * in notebook cells, including tool outputs, reasoning, and error messages.
 * @class UIRenderer
 * @example
 * const renderer = new UIRenderer();
 * renderer.commitRoundUI(content, reasoning);
 * const html = renderer.generateDisplayHtml(currentContent, currentReasoning);
 */
export class UIRenderer {
    /** Accumulated HTML content for committed UI rounds */
    private committedUiHtml = '';

    /**
     * Creates a new UIRenderer instance.
     * @constructor
     * Initializes the committedUiHtml with an empty string.
     */
    constructor() {
        this.committedUiHtml = '';
    }

    /**
     * Commits the current round's UI content.
     * @description Adds the current content and reasoning to the committed HTML buffer.
     * Reasoning is wrapped in a collapsible details element.
     * @param {string} content - Content to commit
     * @param {string} reasoning - Reasoning to commit (will be wrapped in details element)
     */
    commitRoundUI(content: string, reasoning: string): void {
        if (reasoning) {
            const thinkingContent = `<details><summary>💭 Thinking Process</summary>\n\n${reasoning}\n\n</details>\n\n`;
            this.committedUiHtml += wrapInThemedContainer(thinkingContent) + '\n\n';
        }
        this.committedUiHtml += content;
    }

    /**
     * Generates the display HTML by combining committed content with current state.
     * @description Combines committed HTML with current content, reasoning, and optional pending tools,
     * and returns the resulting HTML string. Current reasoning is displayed
     * in an open (expanded) details element.
     * @param {string} currentContent - Current content to display
     * @param {string} currentReasoning - Current reasoning to display
     * @param {string} [pendingToolsHtml] - Optional HTML for pending (streaming) tool calls
     * @returns {string} The generated HTML string
     */
    generateDisplayHtml(
        currentContent: string,
        currentReasoning: string,
        pendingToolsHtml?: string
    ): string {
        let display = this.committedUiHtml;
        if (currentReasoning) {
            const thinkingContent = `<details open><summary>💭 Thinking Process</summary>\n\n${currentReasoning}\n\n</details>\n\n`;
            display += wrapInThemedContainer(thinkingContent) + '\n\n';
        }
        display += currentContent;

        if (pendingToolsHtml) {
            display += pendingToolsHtml;
        }

        return display;
    }

    /**
     * Formats pending (streaming) tool calls as an HTML string.
     * @description Iterates through partial tool calls, parses their arguments,
     * retrieves pretty print summaries and rendering configs, and generates
     * HTML for each pending tool call.
     * @param {any[]} partialToolCalls - Array of partial tool call objects
     * @param {ToolSet} toolSet - Tool set instance for looking up tool metadata
     * @param {boolean} isSubAgent - Whether the caller is a sub-agent (deprecated, kept for compatibility)
     * @returns {string} Formatted HTML string containing all pending tool calls
     */
    public formatPendingToolCalls(
        partialToolCalls: any[] | undefined,
        toolSet: ToolSet,
        _isSubAgent?: boolean
    ): string {
        if (!partialToolCalls || partialToolCalls.length === 0) {
            return '';
        }

        let pendingToolsHtml = '';
        for (const ptc of partialToolCalls) {
            const toolName = ptc.function?.name;
            if (!toolName) { continue; }

            const args = tryParsePartialJson(ptc.function?.arguments);
            const summary = toolSet.getPrettyPrint(toolName, args);
            const config = toolSet.getRenderingConfig(toolName);

            pendingToolsHtml += this.formatToolCall(args, summary, true, undefined, config);
        }

        return pendingToolsHtml;
    }

    /**
     * Formats a tool call (streaming or finished) as an HTML details element.
     * @description Creates a collapsible HTML details element containing the tool name,
     * arguments (as Markdown list or code blocks), and optionally the result (truncated if over 500 characters).
     * @param {any} toolArgs - Tool arguments (complete or partial)
     * @param {string} prettyPrintSummary - Human-readable summary
     * @param {boolean} isStreaming - Whether this is a pending/streaming tool call
     * @param {string} [toolResult] - Optional execution result (for finished calls)
     * @param {Object} [renderingConfig] - Optional configuration for rendering code blocks
     * @returns {string} Formatted HTML string
     */
    formatToolCall(
        toolArgs: any, 
        prettyPrintSummary: string, 
        isStreaming: boolean, 
        toolResult?: string,
        renderingConfig?: { argsToCodeBlock?: string[], codeBlockFilePaths?: (string | undefined)[] }
    ): string {
        const summaryPrefix = isStreaming ? '⏳ ' : '';
        const summarySuffix = isStreaming ? ' ...' : '';
        const openAttr = isStreaming ? ' open' : '';
        
        let argsContent = '';
        let codeBlocksContent: string[] = [];
        
        // Ensure toolArgs is an object
        const safeArgs = (typeof toolArgs === 'object' && toolArgs !== null) ? toolArgs : {};

        // Separate regular args and code block args if config exists
        const regularArgs: Record<string, any> = {};
        const codeBlockArgs: Record<string, any> = {};

        if (renderingConfig?.argsToCodeBlock?.length) {
            const { argsToCodeBlock, codeBlockFilePaths } = renderingConfig;
            
            for (const [key, value] of Object.entries(safeArgs)) {
                if (argsToCodeBlock.includes(key)) {
                    codeBlockArgs[key] = value;
                } else {
                    regularArgs[key] = value;
                }
            }

            // Generate code blocks
            for (let i = 0; i < argsToCodeBlock.length; i++) {
                const argName = argsToCodeBlock[i];
                const val = codeBlockArgs[argName];
                
                if (val !== undefined && val !== null) {
                    let lang = '';
                    // Only try to detect language if not streaming and file path is available
                    if (!isStreaming && codeBlockFilePaths) {
                        const pathArgName = codeBlockFilePaths[i];
                        if (pathArgName) {
                            const pathVal = safeArgs[pathArgName];
                            if (typeof pathVal === 'string') {
                                const ext = pathVal.split('.').pop() || '';
                                lang = getLanguageIdentifier(ext);
                            }
                        }
                    }
                    
                    codeBlocksContent.push(`\n**${argName}:**\n\`\`\`\`${lang}\n${val}\n\`\`\`\``);
                }
            }

        } else {
            // Default: everything is a regular arg
            Object.assign(regularArgs, safeArgs);
        }

        // Render regular args as a markdown list
        if (Object.keys(regularArgs).length > 0) {
            argsContent += '\n';
            for (const [key, value] of Object.entries(regularArgs)) {
                 // Use JSON.stringify for values to handle escaping (newlines, quotes) and complex types
                 // But remove outer quotes if it's a string for cleaner display? 
                 // User asked for: - `key`: `value`
                 // If value has newlines, JSON.stringify converts them to \n which is what we want (escaped)
                 const valStr = JSON.stringify(value);
                 argsContent += `- \`${key}\`: \`${valStr}\`\n`;
            }
        }

        let resultBlock = '';
        if (toolResult !== undefined) {
            resultBlock = `
**Result:**
\`\`\`\`
${toolResult}
\`\`\`\`
`;
        }

        const toolContent = `<details${openAttr}>
<summary>${summaryPrefix}${prettyPrintSummary}${summarySuffix}</summary>

**Arguments${isStreaming ? ' (Streaming)' : ''}:**
${argsContent}
${codeBlocksContent.join('\n')}
${resultBlock}
</details>`;

        return '\n\n' + wrapInThemedContainer(toolContent) + '\n\n';
    }

    /**
     * Gets the committed HTML content.
     * @description Returns the accumulated HTML content that has been committed so far.
     * @returns {string} The committed HTML content
     */
    getCommittedHtml(): string {
        return this.committedUiHtml;
    }

    /**
     * Appends HTML content to the committed buffer.
     * @description Adds raw HTML content to the committed HTML buffer without
     * updating the cell output. Use generateDisplayHtml() to get the current display.
     * @param {string} content - HTML content to append
     */
    appendHtml(content: string): void {
        this.committedUiHtml += content;
    }
}
