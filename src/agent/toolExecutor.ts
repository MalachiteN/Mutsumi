/**
 * @fileoverview Tool executor for handling LLM tool calls.
 * @module agent/toolExecutor
 */

import * as vscode from 'vscode';
import { ToolManager } from '../tools.d/toolManager';
import { ToolContext } from '../tools.d/interface';
import { AgentMessage } from '../types';
import { UIRenderer } from './uiRenderer';

/**
 * Callbacks for UI updates and termination signaling.
 * @interface ToolExecutorCallbacks
 */
export interface ToolExecutorCallbacks {
    /** Append output content to the UI */
    appendOutput: (content: string) => Promise<void>;
    /** Signal that the task should terminate */
    signalTermination: () => void;
}

/**
 * Result of executing tools
 * @interface ToolExecutionResult
 */
export interface ToolExecutionResult {
    /** Messages from tool executions */
    messages: AgentMessage[];
    /** Whether the agent should terminate */
    shouldTerminate: boolean;
    /** Whether this is a successful task completion (e.g., from task_finish tool) */
    isTaskComplete: boolean;
}

/**
 * Executes tool calls from LLM responses.
 * @description Manages the execution of tool calls, handling context building,
 * error handling, and result collection.
 * @class ToolExecutor
 * @example
 * const executor = new ToolExecutor(tools, allowedUris, notebook, isSubAgent);
 * const result = await executor.executeTools(execution, toolCalls, abortSignal, callbacks);
 */
export class ToolExecutor {
    /**
     * Creates a new ToolExecutor instance.
     * @constructor
     * @param {ToolManager} tools - Tool manager for executing tools
     * @param {string[]} allowedUris - List of allowed URIs for the agent
     * @param {vscode.NotebookDocument} notebook - The notebook document
     * @param {boolean} isSubAgent - Whether this is a sub-agent
     */
    constructor(
        private tools: ToolManager,
        private allowedUris: string[],
        private notebook: vscode.NotebookDocument,
        private isSubAgent: boolean,
        private uiRenderer: UIRenderer
    ) {}

    /**
     * Executes a list of tool calls and returns the results.
     * @description Iterates through each tool call, builds the tool context,
     * executes the tool, collects results, and notifies callbacks for UI updates.
     * @param {vscode.NotebookCellExecution} execution - Cell execution context
     * @param {any[]} toolCalls - Tool calls to execute
     * @param {AbortSignal} abortSignal - Signal for cancellation
     * @param {ToolExecutorCallbacks} callbacks - Callbacks for UI updates and termination
     * @returns {Promise<{messages: AgentMessage[], shouldTerminate: boolean}>} Tool execution results
     * @throws {TerminationError} If a termination tool signals task completion
     * @example
     * const result = await executor.executeTools(execution, toolCalls, abortSignal, {
     *     appendOutput: async (content) => { / * update UI * / },
     *     signalTermination: () => { /* handle termination * / }
     * });
     */
    async executeTools(
        execution: vscode.NotebookCellExecution,
        toolCalls: any[],
        abortSignal: AbortSignal,
        callbacks: ToolExecutorCallbacks
    ): Promise<ToolExecutionResult> {
        const toolMessages: AgentMessage[] = [];
        let shouldTerminate = false;
        let isTaskComplete = false;

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
                appendOutput: callbacks.appendOutput,
                signalTermination: (taskComplete = false) => {
                    shouldTerminate = true;
                    isTaskComplete = taskComplete;
                    callbacks.signalTermination();
                }
            };

            let toolResult = '';
            try {
                toolResult = await this.tools.executeTool(toolName, toolArgs, context, this.isSubAgent);
            } catch (err: any) {
                toolResult = `Error executing tool: ${err.message}`;
            }

            // Get the pretty print summary for this tool call
            const prettyPrintSummary = this.tools.getPrettyPrint(toolName, toolArgs, this.isSubAgent);
            const config = this.tools.getToolRenderingConfig(toolName, this.isSubAgent);
            await callbacks.appendOutput(this.uiRenderer.formatToolCall(toolArgs, prettyPrintSummary, false, toolResult, config));

            toolMessages.push({
                role: 'tool',
                tool_call_id: tc.id,
                name: toolName,
                content: toolResult
            });

            // If termination signal received, stop processing more tools
            if (shouldTerminate) {
                break;
            }
        }
        return { messages: toolMessages, shouldTerminate, isTaskComplete };
    }
}