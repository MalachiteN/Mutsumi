import * as vscode from 'vscode';
import OpenAI from 'openai';

export class TerminationError extends Error {
    constructor(message: string = 'Execution terminated by user') {
        super(message);
        this.name = 'TerminationError';
    }
}

export interface ToolContext {
    allowedUris: string[];
    notebook?: vscode.NotebookDocument;
    execution?: vscode.NotebookCellExecution;
    appendOutput?: (content: string) => Promise<void>;
    abortSignal?: AbortSignal;
    /**
     * Signal that the session should be terminated after this tool call.
     * The tool result will be added to the conversation before termination.
     */
    signalTermination?: () => void;
}

export interface ITool {
    name: string;
    definition: OpenAI.Chat.ChatCompletionTool;
    execute(args: any, context: ToolContext): Promise<string>;
    /**
     * Generate a human-readable description of the tool call.
     * @param args - The arguments passed to the tool
     * @returns A natural language string describing what the tool is doing
     */
    prettyPrint(args: any): string;
}
