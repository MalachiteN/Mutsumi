/**
 * @fileoverview UI Renderer for agent notebook cell output.
 * @module uiRenderer
 */

import * as vscode from 'vscode';
import { wrapInThemedContainer, getLanguageIdentifier } from '../utils';
import { tryParsePartialJson } from './utils';
import { ToolManager } from '../tools.d/toolManager';

/**
 * Handles UI rendering and output management for agent execution.
 * @description Manages the accumulation and display of HTML/Markdown content
 * in notebook cells, including tool outputs, reasoning, and error messages.
 * @class UIRenderer
 * @example
 * const renderer = new UIRenderer();
 * renderer.commitRoundUI(content, reasoning);
 * await renderer.renderUI(execution, currentContent, currentReasoning);
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
     * Renders the current UI state to the cell output.
     * @description Combines committed HTML with current content, reasoning, and optional pending tools,
     * then updates the notebook cell output. Current reasoning is displayed
     * in an open (expanded) details element.
     * @param {vscode.NotebookCellExecution} execution - Cell execution context
     * @param {string} currentContent - Current content to display
     * @param {string} currentReasoning - Current reasoning to display
     * @param {string} [pendingToolsHtml] - Optional HTML for pending (streaming) tool calls
     * @returns {Promise<void>}
     */
    async renderUI(
        execution: vscode.NotebookCellExecution,
        currentContent: string,
        currentReasoning: string,
        pendingToolsHtml?: string
    ): Promise<void> {
        let display = this.committedUiHtml;
        if (currentReasoning) {
            const thinkingContent = `<details open><summary>💭 Thinking Process</summary>\n\n${currentReasoning}\n\n</details>\n\n`;
            display += wrapInThemedContainer(thinkingContent) + '\n\n';
        }
        display += currentContent;

        if (pendingToolsHtml) {
            display += pendingToolsHtml;
        }

        await execution.replaceOutput([
            new vscode.NotebookCellOutput([
                vscode.NotebookCellOutputItem.text(display, 'text/markdown')
            ])
        ]);
    }

    /**
     * Updates the cell output with committed UI content.
     * @description Replaces the cell output with the current committed HTML content.
     * @param {vscode.NotebookCellExecution} execution - Cell execution context
     * @returns {Promise<void>}
     */
    async updateOutput(execution: vscode.NotebookCellExecution): Promise<void> {
        await execution.replaceOutput([
            new vscode.NotebookCellOutput([
                vscode.NotebookCellOutputItem.text(this.committedUiHtml, 'text/markdown')
            ])
        ]);
    }

    /**
     * Appends an error message to the UI.
     * @description Adds an error message to the committed HTML and updates the output.
     * @param {vscode.NotebookCellExecution} execution - Cell execution context
     * @param {string} message - Error message to display
     * @returns {Promise<void>}
     */
    async appendErrorUI(
        execution: vscode.NotebookCellExecution,
        message: string
    ): Promise<void> {
        this.committedUiHtml += `\n\n${message}\n\n`;
        await this.updateOutput(execution);
    }

    /**
     * Formats pending (streaming) tool calls as an HTML string.
     * @description Iterates through partial tool calls, parses their arguments,
     * retrieves pretty print summaries and rendering configs, and generates
     * HTML for each pending tool call.
     * @param {any[]} partialToolCalls - Array of partial tool call objects
     * @param {ToolManager} tools - Tool manager instance for looking up tool metadata
     * @param {boolean} isSubAgent - Whether the caller is a sub-agent
     * @returns {string} Formatted HTML string containing all pending tool calls
     */
    public formatPendingToolCalls(
        partialToolCalls: any[] | undefined,
        tools: ToolManager,
        isSubAgent: boolean
    ): string {
        if (!partialToolCalls || partialToolCalls.length === 0) {
            return '';
        }

        let pendingToolsHtml = '';
        for (const ptc of partialToolCalls) {
            const toolName = ptc.function?.name;
            if (!toolName) { continue; }

            const args = tryParsePartialJson(ptc.function?.arguments);
            const summary = tools.getPrettyPrint(toolName, args, isSubAgent);
            const config = tools.getToolRenderingConfig(toolName, isSubAgent);

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
                    
                    codeBlocksContent.push(`\n**${argName}:**\n\`\`\`${lang}\n${val}\n\`\`\``);
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
\`\`\`
${toolResult}
\`\`\`
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
     * updating the cell output. Use updateOutput() to display the changes.
     * @param {string} content - HTML content to append
     */
    appendHtml(content: string): void {
        this.committedUiHtml += content;
    }
}
