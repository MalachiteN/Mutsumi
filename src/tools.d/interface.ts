import * as vscode from 'vscode';
import OpenAI from 'openai';

export interface ToolContext {
    allowedUris: string[];
    notebook?: vscode.NotebookDocument;
    execution?: vscode.NotebookCellExecution;
    appendOutput?: (content: string) => Promise<void>;
    abortSignal?: AbortSignal;
    /**
     * Signal that the session should be terminated after this tool call.
     * The tool result will be added to the conversation before termination.
     * @param isTaskComplete - Whether this termination represents a successfully completed task (default: false)
     */
    signalTermination?: (isTaskComplete?: boolean) => void;
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
    /**
     * Optional: List of argument names that should be rendered as code blocks.
     */
    argsToCodeBlock?: string[];
    /**
     * Optional: List of argument names (paths) that correspond to the code blocks.
     * Must have the same length as argsToCodeBlock.
     * Used to determine the language for syntax highlighting.
     */
    codeBlockFilePaths?: (string | undefined)[];
}
