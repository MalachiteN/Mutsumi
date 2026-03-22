import * as vscode from 'vscode';

/**
 * Shared tools logger for real-time tool output streaming.
 * Provides a single "Mutsumi Tools" output channel for streaming tool execution logs.
 */
class ToolsLogger {
    private outputChannel?: vscode.OutputChannel;

    /**
     * Initialize the tools logger. Must be called once during extension activation.
     * @param context - Extension context for registering disposables
     */
    public initialize(context: vscode.ExtensionContext): void {
        if (!this.outputChannel) {
            this.outputChannel = vscode.window.createOutputChannel('Mutsumi Tools');
            context.subscriptions.push(this.outputChannel);
        }
    }

    /**
     * Log a message to the tools channel.
     * @param message - The message to log
     */
    public log(message: string): void {
        if (this.outputChannel) {
            this.outputChannel.append(message);
        }
    }

    /**
     * Log a line to the tools channel (adds newline).
     * @param message - The message to log
     */
    public logLine(message: string): void {
        if (this.outputChannel) {
            this.outputChannel.appendLine(message);
        }
    }

    /**
     * Show the tools channel in the output panel.
     */
    public show(): void {
        this.outputChannel?.show();
    }

    /**
     * Clear the tools channel.
     */
    public clear(): void {
        this.outputChannel?.clear();
    }
}

// Export singleton instance
export const toolsLogger = new ToolsLogger();
