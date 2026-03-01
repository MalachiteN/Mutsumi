import * as vscode from 'vscode';

/**
 * Shared debug logger for all Mutsumi modules.
 * Provides a single "Mutsumi Debug" output channel for logging.
 */
class DebugLogger {
    private outputChannel?: vscode.OutputChannel;

    /**
     * Initialize the debug logger. Must be called once during extension activation.
     * @param context - Extension context for registering disposables
     */
    public initialize(context: vscode.ExtensionContext): void {
        if (!this.outputChannel) {
            this.outputChannel = vscode.window.createOutputChannel('Mutsumi Debug');
            context.subscriptions.push(this.outputChannel);
        }
    }

    /**
     * Log a message to the debug channel.
     * @param message - The message to log
     */
    public log(message: string): void {
        if (this.outputChannel) {
            this.outputChannel.appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
        }
    }

    /**
     * Show the debug channel in the output panel.
     */
    public show(): void {
        this.outputChannel?.show();
    }
}

// Export singleton instance
export const debugLogger = new DebugLogger();
