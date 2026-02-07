/**
 * @fileoverview Agent runner for executing LLM interactions and tool calls.
 * @module agentRunner
 */

import * as vscode from 'vscode';
import OpenAI from 'openai';
import { ToolManager } from './toolManager';
import { AgentOrchestrator } from './agentOrchestrator';
import { ToolContext, TerminationError } from './tools.d/interface';
import { AgentMessage } from './types';
import { generateTitle } from './utils';

/**
 * Options for configuring the agent runner.
 * @interface AgentRunOptions
 */
export interface AgentRunOptions {
    /** Model identifier to use for LLM calls */
    model: string;
    /** OpenAI API key */
    apiKey: string;
    /** Base URL for OpenAI-compatible API */
    baseUrl: string | undefined;
    /** Maximum number of tool interaction loops */
    maxLoops?: number;
}

/**
 * Executes the main agent loop for LLM interactions.
 * @description Manages the conversation flow with the LLM, handling streaming responses,
 * tool calls, and UI updates. Implements the core agent execution logic.
 * @class AgentRunner
 * @example
 * const runner = new AgentRunner(options, tools, notebook, allowedUris, isSubAgent);
 * const newMessages = await runner.run(execution, abortController, initialMessages);
 */
export class AgentRunner {
    /** Accumulated HTML content for committed UI rounds */
    private committedUiHtml = '';
    /** OpenAI client instance */
    private openai: OpenAI;
    /** Maximum number of tool interaction loops */
    private maxLoops: number;

    /**
     * Creates a new AgentRunner instance.
     * @constructor
     * @param {AgentRunOptions} options - Configuration options
     * @param {ToolManager} tools - Tool manager for executing tools
     * @param {vscode.NotebookDocument} notebook - The notebook document
     * @param {string[]} allowedUris - List of allowed URIs for the agent
     * @param {boolean} isSubAgent - Whether this is a sub-agent
     */
    constructor(
        private options: AgentRunOptions,
        private tools: ToolManager,
        private notebook: vscode.NotebookDocument,
        private allowedUris: string[],
        private isSubAgent: boolean
    ) {
        this.openai = new OpenAI({
            apiKey: options.apiKey,
            baseURL: options.baseUrl,
            defaultHeaders: { 'Client-Name': 'Mutsumi-VSCode' }
        });
        this.maxLoops = options.maxLoops || 30;
    }

    /**
     * Executes the main agent loop.
     * @description Runs the conversation loop with the LLM, handling streaming,
     * tool calls, and termination conditions.
     * @param {vscode.NotebookCellExecution} execution - Cell execution context
     * @param {AbortController} abortController - Controller for cancellation
     * @param {AgentMessage[]} initialMessages - Initial message history
     * @returns {Promise<AgentMessage[]>} New messages generated during this run
     * @throws {TerminationError} If task_finish tool is called
     * @example
     * const newMessages = await runner.run(execution, abortController, messages);
     */
    async run(
        execution: vscode.NotebookCellExecution,
        abortController: AbortController,
        initialMessages: AgentMessage[]
    ): Promise<AgentMessage[]> {
        const messages = [...initialMessages];
        const newMessages: AgentMessage[] = [];
        let loopCount = 0;
        let isTaskFinished = false;

        while (loopCount < this.maxLoops) {
            if (execution.token.isCancellationRequested) {
                break;
            }
            loopCount++;

            const { roundContent, roundReasoning, toolCalls } = await this.streamResponse(
                execution,
                messages,
                abortController.signal
            );

            if (!toolCalls.length && !roundContent && !roundReasoning) {
                 await this.appendErrorUI(execution, "_Mutsumi Debug: No content, reasoning, or tool calls received from API._");
                 const msg: AgentMessage = { role: 'assistant', content: roundContent };
                 if (roundReasoning) {
                     msg.reasoning_content = roundReasoning;
                 }
                 messages.push(msg);
                 newMessages.push(msg);
                 break;
            }

            if (toolCalls.length === 0) {
                const assistantMsg: AgentMessage = { role: 'assistant', content: roundContent };
                if (roundReasoning) {
                    assistantMsg.reasoning_content = roundReasoning;
                }
                messages.push(assistantMsg);
                newMessages.push(assistantMsg);
                break;
            }

            const assistantMsgWithTool: AgentMessage = {
                role: 'assistant',
                content: roundContent || null,
                tool_calls: toolCalls
            };
            if (roundReasoning) {
                assistantMsgWithTool.reasoning_content = roundReasoning;
            }
            messages.push(assistantMsgWithTool);
            newMessages.push(assistantMsgWithTool);

            this.commitRoundUI(roundContent, roundReasoning);

            let toolMessages: AgentMessage[] = [];
            try {
                const result = await this.executeTools(execution, toolCalls, abortController.signal);
                toolMessages = result.messages;
                if (result.shouldTerminate) {
                    isTaskFinished = true;
                }
            } catch (err: any) {
                if (err instanceof TerminationError) {
                    await this.appendErrorUI(execution, `_⛔ ${err.message}_`);
                    break;
                }
                throw err;
            }
            messages.push(...toolMessages);
            newMessages.push(...toolMessages);

            if (isTaskFinished) {
                await this.markNotebookAsFinished();
                break;
            }
        }
        
        if (this.isFirstCell(execution)) {
            void this.generateTitleIfNeeded(messages);
        }

        return newMessages;
    }

    /**
     * Checks if the current cell is the first cell in the notebook.
     * @private
     * @param {vscode.NotebookCellExecution} execution - Cell execution context
     * @returns {boolean} True if this is the first cell
     */
    private isFirstCell(execution: vscode.NotebookCellExecution): boolean {
        const cells = this.notebook.getCells();
        return cells.indexOf(execution.cell) === 0;
    }

    /**
     * Generates a title for the notebook if configured.
     * @private
     * @param {AgentMessage[]} allMessages - Complete message history
     * @returns {Promise<void>}
     */
    private async generateTitleIfNeeded(allMessages: AgentMessage[]): Promise<void> {
        const config = vscode.workspace.getConfiguration('mutsumi');
        const titleModel = config.get<string>('titleGeneratorModel');
        const apiKey = config.get<string>('apiKey');
        const baseUrl = config.get<string>('baseUrl');
        
        if (!titleModel || !apiKey) {
            return;
        }

        try {
            const title = await generateTitle(
                allMessages,
                apiKey,
                baseUrl,
                titleModel
            );

            const edit = new vscode.WorkspaceEdit();
            const newMetadata = {
                ...this.notebook.metadata,
                name: title
            };
            const nbEdit = vscode.NotebookEdit.updateNotebookMetadata(newMetadata);
            (edit as any).set(this.notebook.uri, [nbEdit]);
            await vscode.workspace.applyEdit(edit);
        } catch (error) {
            console.error('Failed to generate notebook title:', error);
        }
    }

    /**
     * Marks the notebook as finished in its metadata.
     * @private
     * @returns {Promise<void>}
     */
    private async markNotebookAsFinished(): Promise<void> {
        const edit = new vscode.WorkspaceEdit();
        const newMetadata = { 
            ...this.notebook.metadata,
            is_task_finished: true 
        };
        const nbEdit = vscode.NotebookEdit.updateNotebookMetadata(newMetadata);
        (edit as any).set(this.notebook.uri, [nbEdit]);
        await vscode.workspace.applyEdit(edit);
    }

    /**
     * Streams the LLM response and collects content, reasoning, and tool calls.
     * @private
     * @param {vscode.NotebookCellExecution} execution - Cell execution context
     * @param {AgentMessage[]} messages - Current message history
     * @param {AbortSignal} signal - Abort signal for cancellation
     * @returns {Promise<{roundContent: string, roundReasoning: string, toolCalls: any[]}>}
     */
    private async streamResponse(
        execution: vscode.NotebookCellExecution,
        messages: AgentMessage[],
        signal: AbortSignal
    ): Promise<{roundContent: string; roundReasoning: string; toolCalls: any[]}> {
        const stream = await this.openai.chat.completions.create({
            model: this.options.model,
            messages: messages as any,
            tools: this.tools.getToolsDefinitions(this.isSubAgent),
            tool_choice: 'auto',
            stream: true,
        }, { signal });

        let currentRoundContent = '';
        let currentReasoningContent = '';
        const toolCallBuffers: { [index: number]: any } = {};

        for await (const chunk of stream) {
            if (execution.token.isCancellationRequested) {
                break;
            }
            const delta = chunk.choices[0]?.delta;

            const reasoningVal = (delta as any)?.reasoning_content || (delta as any)?.reasoning;
            let uiUpdateNeeded = false;

            if (reasoningVal) {
                currentReasoningContent += reasoningVal;
                uiUpdateNeeded = true;
            }

            if (delta?.content) {
                currentRoundContent += delta.content;
                uiUpdateNeeded = true;
            }

            if (uiUpdateNeeded) {
                await this.renderUI(execution, currentRoundContent, currentReasoningContent);
            }

            if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? 0;
                    if (!toolCallBuffers[idx]) {
                        toolCallBuffers[idx] = { ...tc, arguments: '' };
                    }
                    if (tc.function?.name) {
                        toolCallBuffers[idx].function.name = tc.function.name;
                    }
                    if (tc.function?.arguments) {
                        toolCallBuffers[idx].function.arguments += tc.function.arguments;
                    }
                }
            }
        }

        const rawToolCalls = Object.values(toolCallBuffers);
        const finalToolCalls = this.parseToolCalls(rawToolCalls, currentRoundContent, currentReasoningContent);

        return {
            roundContent: currentRoundContent,
            roundReasoning: currentReasoningContent,
            toolCalls: finalToolCalls
        };
    }

    /**
     * Parses raw tool calls from the stream into structured format.
     * @private
     * @param {any[]} rawToolCalls - Raw tool call data from stream
     * @param {string} currentContent - Current content buffer
     * @param {string} currentReasoning - Current reasoning buffer
     * @returns {any[]} Parsed tool calls
     */
    private parseToolCalls(rawToolCalls: any[], currentContent: string, currentReasoning: string): any[] {
        const finalToolCalls: any[] = [];
        
        for (const tc of rawToolCalls) {
            const toolName = tc.function.name;
            const toolArgsStr = tc.function.arguments;
            let argsArray: any[] = [];

            try {
                const parsed = JSON.parse(toolArgsStr);
                argsArray = [parsed];
            } catch (e) {
                try {
                    const fixedStr = '[' + toolArgsStr.replace(/}\s*{/g, '},{') + ']';
                    const parsedArr = JSON.parse(fixedStr);
                    if (Array.isArray(parsedArr) && parsedArr.length > 0) {
                        const uniqueArgs = new Set(parsedArr.map(x => JSON.stringify(x)));
                        argsArray = Array.from(uniqueArgs).map(x => JSON.parse(x));
                    } else {
                        throw e;
                    }
                } catch (e2) {
                    console.error(`JSON Parse Error for tool ${toolName}:`, toolArgsStr);
                    continue; 
                }
            }

            argsArray.forEach((args, i) => {
                const callId = (i === 0 && tc.id) ? tc.id : 'call_' + Math.random().toString(36).substring(2, 11);
                finalToolCalls.push({
                    id: callId,
                    type: 'function',
                    function: {
                        name: toolName,
                        arguments: JSON.stringify(args)
                    }
                });
            });
        }
        return finalToolCalls;
    }

    /**
     * Executes tool calls and returns the results.
     * @private
     * @param {vscode.NotebookCellExecution} execution - Cell execution context
     * @param {any[]} toolCalls - Tool calls to execute
     * @param {AbortSignal} abortSignal - Signal for cancellation
     * @returns {Promise<{messages: AgentMessage[], shouldTerminate: boolean}>}
     */
    private async executeTools(
        execution: vscode.NotebookCellExecution,
        toolCalls: any[],
        abortSignal: AbortSignal
    ): Promise<{ messages: AgentMessage[]; shouldTerminate: boolean }> {
        const toolMessages: AgentMessage[] = [];
        let shouldTerminate = false;

        for (const tc of toolCalls) {
            if (execution.token.isCancellationRequested) {
                break;
            }

            const toolName = tc.function.name;
            const toolArgsStr = tc.function.arguments;
            const toolArgs = JSON.parse(toolArgsStr);

            const context: ToolContext = {
                allowedUris: this.allowedUris,
                notebook: this.notebook,
                execution: execution,
                abortSignal: abortSignal,
                appendOutput: async (content: string) => {
                    this.committedUiHtml += content;
                    await this.updateOutput(execution);
                },
                signalTermination: () => {
                    shouldTerminate = true;
                }
            };

            let toolResult = '';
            try {
                toolResult = await this.tools.executeTool(toolName, toolArgs, context, this.isSubAgent);
            } catch (err: any) {
                if (err instanceof TerminationError) {
                    throw err;
                }
                toolResult = `Error executing tool: ${err.message}`;
            }

            this.committedUiHtml += this.formatToolOutput(toolName, toolArgs, toolResult);
            await this.updateOutput(execution);

            toolMessages.push({
                role: 'tool',
                tool_call_id: tc.id,
                name: toolName,
                content: toolResult
            });
        }
        return { messages: toolMessages, shouldTerminate };
    }

    /**
     * Formats tool output as HTML details element.
     * @private
     * @param {string} toolName - Name of the tool
     * @param {any} toolArgs - Tool arguments
     * @param {string} toolResult - Tool execution result
     * @returns {string} Formatted HTML string
     */
    private formatToolOutput(toolName: string, toolArgs: any, toolResult: string): string {
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
     * Commits the current round's UI content.
     * @private
     * @param {string} content - Content to commit
     * @param {string} reasoning - Reasoning to commit
     */
    private commitRoundUI(content: string, reasoning: string): void {
        if (reasoning) {
            this.committedUiHtml += `<details><summary>💭 Thinking Process</summary>\n\n${reasoning}\n\n</details>\n\n`;
        }
        this.committedUiHtml += content;
    }

    /**
     * Renders the current UI state to the cell output.
     * @private
     * @param {vscode.NotebookCellExecution} execution - Cell execution context
     * @param {string} currentContent - Current content to display
     * @param {string} currentReasoning - Current reasoning to display
     * @returns {Promise<void>}
     */
    private async renderUI(execution: vscode.NotebookCellExecution, currentContent: string, currentReasoning: string): Promise<void> {
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
     * @private
     * @param {vscode.NotebookCellExecution} execution - Cell execution context
     * @returns {Promise<void>}
     */
    private async updateOutput(execution: vscode.NotebookCellExecution): Promise<void> {
        await execution.replaceOutput([
            new vscode.NotebookCellOutput([
                vscode.NotebookCellOutputItem.text(this.committedUiHtml, 'text/markdown')
            ])
        ]);
    }

    /**
     * Appends an error message to the UI.
     * @private
     * @param {vscode.NotebookCellExecution} execution - Cell execution context
     * @param {string} message - Error message to display
     * @returns {Promise<void>}
     */
    private async appendErrorUI(execution: vscode.NotebookCellExecution, message: string): Promise<void> {
         this.committedUiHtml += `\n\n${message}\n\n`;
         await this.updateOutput(execution);
    }
}
