import * as vscode from 'vscode';
import OpenAI from 'openai';
import { ToolManager } from './toolManager';
import { AgentOrchestrator } from './agentOrchestrator';
import { ToolContext, TerminationError } from './tools.d/interface';
import { AgentMessage } from './types';

export interface AgentRunOptions {
    model: string;
    apiKey: string;
    baseUrl: string | undefined;
    maxLoops?: number;
}

export class AgentRunner {
    private committedUiHtml = '';
    private openai: OpenAI;
    private maxLoops: number;

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
        this.maxLoops = options.maxLoops || 5;
    }

    /**
     * 执行 Agent 的主循环
     * @returns 新产生的消息历史（用于保存到 metadata）
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
            if (execution.token.isCancellationRequested) break;
            loopCount++;

            // 1. 调用 LLM 并流式处理 UI
            const { roundContent, roundReasoning, toolCalls } = await this.streamResponse(
                execution,
                messages,
                abortController.signal
            );

            // 如果没有任何输出和工具调用，说明结束或出错
            if (!toolCalls.length && !roundContent && !roundReasoning) {
                 await this.appendErrorUI(execution, "_Mutsumi Debug: No content, reasoning, or tool calls received from API._");
                 // 依然记录一条消息以防死循环
                 const msg: AgentMessage = { role: 'assistant', content: roundContent };
                 if (roundReasoning) msg.reasoning_content = roundReasoning;
                 messages.push(msg);
                 newMessages.push(msg);
                 break;
            }

            // 2. 记录 Assistant 消息
            if (toolCalls.length === 0) {
                // 没有工具调用，这是最后一轮回复
                const assistantMsg: AgentMessage = { role: 'assistant', content: roundContent };
                if (roundReasoning) assistantMsg.reasoning_content = roundReasoning;
                messages.push(assistantMsg);
                newMessages.push(assistantMsg);
                break;
            }

            // 3. 处理工具调用
            const assistantMsgWithTool: AgentMessage = {
                role: 'assistant',
                content: roundContent || null,
                tool_calls: toolCalls
            };
            if (roundReasoning) assistantMsgWithTool.reasoning_content = roundReasoning;
            messages.push(assistantMsgWithTool);
            newMessages.push(assistantMsgWithTool);

            // 提交这一轮的 UI（Reasoning + Content）为固定 HTML，为下一轮工具输出做准备
            this.commitRoundUI(roundContent, roundReasoning);

            // 4. Execute Tools
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
                    break; // Stop the loop immediately
                }
                throw err;
            }
            messages.push(...toolMessages);
            newMessages.push(...toolMessages);

            // If task is finished, stop the loop immediately
            if (isTaskFinished) {
                await this.markNotebookAsFinished();
                break;
            }
        }
        
        return newMessages;
    }

    private async markNotebookAsFinished() {
        const edit = new vscode.WorkspaceEdit();
        const newMetadata = { 
            ...this.notebook.metadata,
            is_task_finished: true 
        };
        const nbEdit = vscode.NotebookEdit.updateNotebookMetadata(newMetadata);
        (edit as any).set(this.notebook.uri, [nbEdit]);
        await vscode.workspace.applyEdit(edit);
    }

    private async streamResponse(
        execution: vscode.NotebookCellExecution,
        messages: AgentMessage[],
        signal: AbortSignal
    ) {
        const stream = await this.openai.chat.completions.create({
            model: this.options.model,
            messages: messages as any,
            tools: this.tools.getToolsDefinitions(this.isSubAgent),
            tool_choice: 'auto',
            stream: true,
        }, { signal });

        let currentRoundContent = '';
        let currentReasoningContent = '';
        let toolCallBuffers: { [index: number]: any } = {};

        for await (const chunk of stream) {
            if (execution.token.isCancellationRequested) break;
            const delta = chunk.choices[0]?.delta;

            // Handle Reasoning
            const reasoningVal = (delta as any)?.reasoning_content || (delta as any)?.reasoning;
            let uiUpdateNeeded = false;

            if (reasoningVal) {
                currentReasoningContent += reasoningVal;
                uiUpdateNeeded = true;
            }

            // Handle Content
            if (delta?.content) {
                currentRoundContent += delta.content;
                uiUpdateNeeded = true;
            }

            // Update UI
            if (uiUpdateNeeded) {
                await this.renderUI(execution, currentRoundContent, currentReasoningContent);
            }

            // Handle Tool Calls
            if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? 0;
                    if (!toolCallBuffers[idx]) {
                        toolCallBuffers[idx] = { ...tc, arguments: '' };
                    }
                    if (tc.function?.name) toolCallBuffers[idx].function.name = tc.function.name;
                    if (tc.function?.arguments) toolCallBuffers[idx].function.arguments += tc.function.arguments;
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

    private parseToolCalls(rawToolCalls: any[], currentContent: string, currentReasoning: string): any[] {
        const finalToolCalls: any[] = [];
        
        for (const tc of rawToolCalls) {
            const toolName = tc.function.name;
            const toolArgsStr = tc.function.arguments;
            let argsArray: any[] = [];

            try {
                // Try standard JSON parse
                const parsed = JSON.parse(toolArgsStr);
                argsArray = [parsed];
            } catch (e) {
                try {
                    // Try repairing multiple JSON objects scenario
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
                    // Note: We are not handling the complex error UI feedback here for simplicity in this refactor,
                    // but in a full implementation, you might want to return an error state.
                    // For now, we skip invalid calls or let them fail later.
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

    private async executeTools(
        execution: vscode.NotebookCellExecution,
        toolCalls: any[],
        abortSignal: AbortSignal
    ): Promise<{ messages: AgentMessage[]; shouldTerminate: boolean }> {
        const toolMessages: AgentMessage[] = [];
        let shouldTerminate = false;

        for (const tc of toolCalls) {
            if (execution.token.isCancellationRequested) break;

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

            // Append Tool UI
            this.committedUiHtml += `\n\n<details>\n<summary>🔧 Tool Call: ${toolName}</summary>\n\n**Arguments:**\n\`\`\`json\n${JSON.stringify(toolArgs, null, 2)}\n\`\`\`\n\n**Result:**\n\`\`\`\n${toolResult.length > 500 ? toolResult.substring(0, 500) + '... (truncated)' : toolResult}\n\`\`\`\n</details>\n\n`;
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

    private commitRoundUI(content: string, reasoning: string) {
        if (reasoning) {
            this.committedUiHtml += `<details><summary>💭 Thinking Process</summary>\n\n${reasoning}\n\n</details>\n\n`;
        }
        this.committedUiHtml += content;
    }

    private async renderUI(execution: vscode.NotebookCellExecution, currentContent: string, currentReasoning: string) {
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

    private async updateOutput(execution: vscode.NotebookCellExecution) {
        await execution.replaceOutput([
            new vscode.NotebookCellOutput([
                vscode.NotebookCellOutputItem.text(this.committedUiHtml, 'text/markdown')
            ])
        ]);
    }

    private async appendErrorUI(execution: vscode.NotebookCellExecution, message: string) {
         this.committedUiHtml += `\n\n${message}\n\n`;
         await this.updateOutput(execution);
    }
}