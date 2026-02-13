/**
 * @fileoverview Agent runner for executing LLM interactions and tool calls.
 * @module agent/agentRunner
 */

import * as vscode from 'vscode';
import { ToolManager } from '../toolManager';
import { TerminationError } from '../tools.d/interface';
import { AgentMessage } from '../types';
import { UIRenderer } from './uiRenderer';
import { LLMStreamHandler } from './llmStream';
import { ToolExecutor } from './toolExecutor';
import { TitleGenerator } from './titleGenerator';
import { LLMClient } from './llmClient';

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
    /** Maximum number of tool interaction loops */
    private maxLoops: number;
    /** UI renderer for notebook output */
    private uiRenderer: UIRenderer;
    /** LLM streaming handler */
    private llmStreamHandler: LLMStreamHandler;
    /** Tool executor for handling tool calls */
    private toolExecutor: ToolExecutor;
    /** Title generator for notebook titles */
    private titleGenerator: TitleGenerator;
    /** LLM client for API communication */
    private llmClient: LLMClient;

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
        this.maxLoops = options.maxLoops || 30;
        this.llmClient = new LLMClient({
            apiKey: options.apiKey,
            baseUrl: options.baseUrl,
            model: options.model,
            defaultHeaders: { 'Client-Name': 'Mutsumi-VSCode' }
        });
        this.uiRenderer = new UIRenderer();
        this.llmStreamHandler = new LLMStreamHandler(this.llmClient);
        this.toolExecutor = new ToolExecutor(this.tools, this.allowedUris, this.notebook, this.isSubAgent, this.uiRenderer);
        this.titleGenerator = new TitleGenerator();
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

            let roundContent = '';
            let roundReasoning = '';
            let toolCalls: any[] = [];

            try {
                const result = await this.llmStreamHandler.streamResponse(
                    messages,
                    this.tools.getToolsDefinitions(this.isSubAgent),
                    abortController.signal,
                    (content, reasoning, partialToolCalls) => {
                        if (execution.token.isCancellationRequested) {
                            return;
                        }

                        let pendingToolsHtml = '';
                        if (partialToolCalls && partialToolCalls.length > 0) {
                            for (const ptc of partialToolCalls) {
                                const toolName = ptc.function?.name;
                                if (toolName) {
                                    const rawArgs = ptc.function?.arguments || '';
                                    const args = this.tryParsePartialJson(rawArgs);
                                    const summary = this.tools.getPrettyPrint(toolName, args, this.isSubAgent);
                                    pendingToolsHtml += this.uiRenderer.formatPendingTool(args, summary);
                                }
                            }
                        }

                        void this.uiRenderer.renderUI(execution, content, reasoning, pendingToolsHtml);
                    }
                );
                roundContent = result.roundContent;
                roundReasoning = result.roundReasoning;
                toolCalls = result.toolCalls;
            } catch (error: any) {
                // Handle network/API errors gracefully
                const isCancellation = 
                    error.name === 'APIUserAbortError' ||
                    error.name === 'AbortError' ||
                    abortController.signal.aborted;

                if (isCancellation) {
                    // User-initiated cancellation, just end gracefully
                    break;
                }

                // Network/API error - show notification and preserve history
                const errorMessage = error.message || String(error);
                console.error('LLM Stream Error:', error);
                
                // Show error as VSCode notification (non-modal)
                vscode.window.showErrorMessage(
                    `Mutsumi LLM Error: ${errorMessage}`,
                    'Copy Details'
                ).then(selection => {
                    if (selection === 'Copy Details') {
                        vscode.env.clipboard.writeText(error.stack || errorMessage);
                    }
                });

                // Preserve committed UI history and add error indicator
                await this.uiRenderer.appendErrorUI(
                    execution,
                    `\n\n> ⚠️ **Error**: ${errorMessage.replace(/\n/g, ' ')}\n\n*Execution stopped due to network error. Previous output is preserved above.*`
                );

                break;
            }

            if (!toolCalls.length && !roundContent && !roundReasoning) {
                await this.uiRenderer.appendErrorUI(
                    execution,
                    "_Mutsumi Debug: No content, reasoning, or tool calls received from API._"
                );
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

            this.uiRenderer.commitRoundUI(roundContent, roundReasoning);

            let toolMessages: AgentMessage[] = [];
            try {
                const result = await this.toolExecutor.executeTools(
                    execution,
                    toolCalls,
                    abortController.signal,
                    {
                        appendOutput: async (content: string) => {
                            this.uiRenderer.appendHtml(content);
                            await this.uiRenderer.updateOutput(execution);
                        },
                        signalTermination: () => {
                            isTaskFinished = true;
                        }
                    }
                );
                toolMessages = result.messages;
                if (result.shouldTerminate) {
                    isTaskFinished = true;
                }
            } catch (err: any) {
                if (err instanceof TerminationError) {
                    await this.uiRenderer.appendErrorUI(execution, `_⛔ ${err.message}_`);
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
     * Tries to parse a potentially incomplete JSON string.
     * Uses a stack-based approach to properly close unterminated JSON structures.
     * @private
     * @param {string} input - The raw JSON string
     * @returns {any} The parsed object or an empty object if parsing fails
     */
    private tryParsePartialJson(input: string): any {
        if (!input) return {};
        
        // First try to parse as-is
        try {
            return JSON.parse(input);
        } catch (e) {
            // If fails, try to close incomplete structures
            const closed = this.closeIncompleteJson(input);
            try {
                return JSON.parse(closed);
            } catch (e2) {
                // If all fails, return empty object so we can at least show the tool name
                return {};
            }
        }
    }

    /**
     * Uses a stack-based approach to properly close incomplete JSON structures.
     * Tracks braces, brackets, and string quotes to determine what needs to be closed.
     * @private
     * @param {string} input - Incomplete JSON string
     * @returns {string} JSON string with closing brackets/braces added
     */
    private closeIncompleteJson(input: string): string {
        const stack: { char: string; inString: boolean }[] = [];
        let inString = false;
        let escapeNext = false;

        for (let i = 0; i < input.length; i++) {
            const char = input[i];

            if (escapeNext) {
                escapeNext = false;
                continue;
            }

            if (char === '\\') {
                escapeNext = true;
                continue;
            }

            if (char === '"') {
                if (!inString) {
                    // Entering a string, push a marker
                    stack.push({ char: '"', inString: false });
                    inString = true;
                } else {
                    // Exiting a string, pop if the top is a string start
                    const top = stack[stack.length - 1];
                    if (top && top.char === '"') {
                        stack.pop();
                        inString = false;
                    }
                }
                continue;
            }

            // Only process structural characters if not inside a string
            if (!inString) {
                if (char === '{' || char === '[') {
                    stack.push({ char, inString: false });
                } else if (char === '}') {
                    const top = stack[stack.length - 1];
                    if (top && top.char === '{') {
                        stack.pop();
                    }
                } else if (char === ']') {
                    const top = stack[stack.length - 1];
                    if (top && top.char === '[') {
                        stack.pop();
                    }
                }
            }
        }

        // If we're still inside a string, we need to close it
        // But we can't safely do that without knowing the content
        // So we'll just add a closing quote and hope for the best
        let result = input;

        // Close structures in reverse order (LIFO)
        while (stack.length > 0) {
            const item = stack.pop()!;
            if (item.char === '"') {
                result += '"';
            } else if (item.char === '{') {
                result += '}';
            } else if (item.char === '[') {
                result += ']';
            }
        }

        return result;
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
        const titleGeneratorModel = config.get<string>('titleGeneratorModel');
        const apiKey = config.get<string>('apiKey');
        const baseUrl = config.get<string>('baseUrl');

        await this.titleGenerator.generateTitleForNotebook(this.notebook, allMessages, {
            titleGeneratorModel,
            apiKey,
            baseUrl
        });
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
}
