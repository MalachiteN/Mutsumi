import * as vscode from 'vscode';
import OpenAI from 'openai';

/**
 * Error class for signaling session termination.
 * Different sources of termination have different implications:
 * - 'task_finish': Normal task completion, should mark notebook as finished
 * - 'edit_reject': User rejected an edit, should terminate but NOT mark as finished
 */
export class TerminationError extends Error {
    /** The source/tool that triggered the termination */
    public source: string;
    /** Whether this termination represents a successfully completed task */
    public isTaskComplete: boolean;

    constructor(
        message: string = 'Execution terminated by user',
        source: string = 'unknown',
        isTaskComplete: boolean = false
    ) {
        super(message);
        this.name = 'TerminationError';
        this.source = source;
        this.isTaskComplete = isTaskComplete;
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
     * @deprecated Use throwing TerminationError instead to specify termination source
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
