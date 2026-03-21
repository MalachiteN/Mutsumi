/**
 * @fileoverview Tool executor for handling LLM tool calls.
 * @module agent/toolExecutor
 */

import * as vscode from 'vscode';
import { ToolSet } from '../tools.d/toolManager';
import { ToolContext } from '../tools.d/interface';
import { AgentMessage } from '../types';
import { UIRenderer } from './uiRenderer';
import { IAgentSession } from '../adapters/interfaces';
import {
    clearToolCache as clearCache,
    getToolCacheSize as getCacheSize,
    getCachedResult,
    setCachedResult,
    logCacheContents
} from '../tools.d/cache';

// Re-export for statusBar
export { clearToolCache, getToolCacheSize } from '../tools.d/cache';

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
 * const executor = new ToolExecutor(tools, allowedUris, session, isSubAgent, uiRenderer);
 * const result = await executor.executeTools(toolCalls, abortSignal, callbacks);
 */
export class ToolExecutor {
    /**
     * Creates a new ToolExecutor instance.
     * @constructor
     * @param {ToolSet} toolSet - Tool set for executing tools
     * @param {string[]} allowedUris - List of allowed URIs for the agent
     * @param {IAgentSession} session - The agent session
     * @param {boolean} isSubAgent - Whether this is a sub-agent
     * @param {UIRenderer} uiRenderer - UI renderer for formatting tool calls
     */
    constructor(
        private toolSet: ToolSet,
        private allowedUris: string[],
        private session: IAgentSession,
        private isSubAgent: boolean,
        private uiRenderer: UIRenderer
    ) {}

    /**
     * Executes a list of tool calls and returns the results.
     * @description Iterates through each tool call, builds the tool context,
     * executes the tool, collects results, and notifies callbacks for UI updates.
     * @param {any[]} toolCalls - Tool calls to execute
     * @param {AbortSignal} abortSignal - Signal for cancellation
     * @param {ToolExecutorCallbacks} callbacks - Callbacks for UI updates and termination
     * @returns {Promise<{messages: AgentMessage[], shouldTerminate: boolean}>} Tool execution results
     * @throws {TerminationError} If a termination tool signals task completion
     * @example
     * const result = await executor.executeTools(toolCalls, abortSignal, {
     *     appendOutput: async (content) => { /* update UI * / },
     *     signalTermination: () => { /* handle termination * / }
     * });
     */
    async executeTools(
        toolCalls: any[],
        abortSignal: AbortSignal,
        callbacks: ToolExecutorCallbacks
    ): Promise<ToolExecutionResult> {
        const toolMessages: AgentMessage[] = [];
        let shouldTerminate = false;
        let isTaskComplete = false;

        for (const tc of toolCalls) {
            if (this.session.token.isCancellationRequested) {
                break;
            }

            const toolName = tc.function.name;
            const toolArgsStr = tc.function.arguments;
            const toolArgs = JSON.parse(toolArgsStr);

            const context: ToolContext = {
                allowedUris: this.allowedUris,
                notebook: undefined,
                execution: undefined,
                session: this.session,
                abortSignal: abortSignal,
                appendOutput: callbacks.appendOutput,
                signalTermination: (taskComplete = false) => {
                    shouldTerminate = true;
                    isTaskComplete = taskComplete;
                    callbacks.signalTermination();
                }
            };

            const shouldCache = this.toolSet.getShouldCache(toolName);

            let toolResult = '';
            try {
                if (shouldCache) {
                    const cached = getCachedResult(toolName, toolArgs);
                    if (cached !== undefined) {
                        toolResult = cached;
                    } else {
                        toolResult = await this.toolSet.execute(toolName, toolArgs, context);
                        setCachedResult(toolName, toolArgs, toolResult);
                    }
                } else {
                    toolResult = await this.toolSet.execute(toolName, toolArgs, context);
                }
            } catch (err: any) {
                toolResult = `Error executing tool: ${err.message}`;
            }

            // Get the pretty print summary for this tool call
            const prettyPrintSummary = this.toolSet.getPrettyPrint(toolName, toolArgs);
            const config = this.toolSet.getRenderingConfig(toolName);
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
