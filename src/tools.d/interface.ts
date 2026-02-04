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
}

export interface ITool {
    name: string;
    definition: OpenAI.Chat.ChatCompletionTool;
    execute(args: any, context: ToolContext): Promise<string>;
}