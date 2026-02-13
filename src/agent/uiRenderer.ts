/**
 * @fileoverview UI Renderer for agent notebook cell output.
 * @module uiRenderer
 */

import * as vscode from 'vscode';
import { wrapInThemedContainer } from '../utils';

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
     * Formats a tool call (streaming or finished) as an HTML details element.
     * @description Creates a collapsible HTML details element containing the tool name,
     * arguments (as JSON), and optionally the result (truncated if over 500 characters).
     * @param {any} toolArgs - Tool arguments (complete or partial)
     * @param {string} prettyPrintSummary - Human-readable summary
     * @param {boolean} isStreaming - Whether this is a pending/streaming tool call
     * @param {string} [toolResult] - Optional execution result (for finished calls)
     * @returns {string} Formatted HTML string
     */
    formatToolCall(
        toolArgs: any, 
        prettyPrintSummary: string, 
        isStreaming: boolean, 
        toolResult?: string
    ): string {
        const summaryPrefix = isStreaming ? '⏳ ' : '';
        const summarySuffix = isStreaming ? ' ...' : '';
        const openAttr = isStreaming ? ' open' : '';
        
        // If args are completely empty during streaming, display as empty object
        const argsDisplay = JSON.stringify(toolArgs, null, 2);

        let resultBlock = '';
        if (toolResult !== undefined) {
            const truncated = toolResult.length > 500
                ? toolResult.substring(0, 500) + '... (truncated)'
                : toolResult;
            resultBlock = `
**Result:**
\`\`\`
${truncated}
\`\`\`
`;
        } else if (isStreaming) {
            // For streaming, we might not have a result yet, just show arguments
        }

        const toolContent = `<details${openAttr}>
<summary>${summaryPrefix}${prettyPrintSummary}${summarySuffix}</summary>

**Arguments${isStreaming ? ' (Streaming)' : ''}:**
\`\`\`json
${argsDisplay}
\`\`\`
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
