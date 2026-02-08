/**
 * @fileoverview UI Renderer for agent notebook cell output.
 * @module uiRenderer
 */

import * as vscode from 'vscode';

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
            this.committedUiHtml += `<details><summary>💭 Thinking Process</summary>\n\n${reasoning}\n\n</details>\n\n`;
        }
        this.committedUiHtml += content;
    }

    /**
     * Renders the current UI state to the cell output.
     * @description Combines committed HTML with current content and reasoning,
     * then updates the notebook cell output. Current reasoning is displayed
     * in an open (expanded) details element.
     * @param {vscode.NotebookCellExecution} execution - Cell execution context
     * @param {string} currentContent - Current content to display
     * @param {string} currentReasoning - Current reasoning to display
     * @returns {Promise<void>}
     */
    async renderUI(
        execution: vscode.NotebookCellExecution,
        currentContent: string,
        currentReasoning: string
    ): Promise<void> {
        let display = this.committedUiHtml;
        if (currentReasoning) {
            display += `<details open><summary>💭 Thinking Process</summary>\n\n${currentReasoning}\n\n</details>\n\n`;
        }
        display += currentContent;

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
     * Formats tool output as HTML details element.
     * @description Creates a collapsible HTML details element containing the tool name,
     * arguments (as JSON), and result (truncated if over 500 characters).
     * @param {string} toolName - Name of the tool
     * @param {any} toolArgs - Tool arguments
     * @param {string} toolResult - Tool execution result
     * @returns {string} Formatted HTML string
     * @example
     * const html = renderer.formatToolOutput('read_file', { uri: '/path/to/file' }, 'file content...');
     * // Returns: <details><summary>🔧 Tool Call: read_file</summary>...</details>
     */
    formatToolOutput(toolName: string, toolArgs: any, toolResult: string): string {
        const truncated = toolResult.length > 500
            ? toolResult.substring(0, 500) + '... (truncated)'
            : toolResult;
        return `

<details>
<summary>🔧 Tool Call: ${toolName}</summary>

**Arguments:**
\`\`\`json
${JSON.stringify(toolArgs, null, 2)}
\`\`\`

**Result:**
\`\`\`
${truncated}
\`\`\`
</details>

`;
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
