/**
 * @fileoverview Regenerate title command for Mutsumi notebook.
 * @module notebook/commands/regenerateTitle
 */

import * as vscode from 'vscode';
import { regenerateTitleForSession, extractMessagesFromNotebook, getTitleGeneratorConfig } from '../../agent/titleGenerator';
import { LiteAdapter, LiteAgentSessionConfig } from '../../adapters/liteAdapter';
import { AgentMetadata } from '../../types';

/**
 * Register the regenerate title command.
 * @param {vscode.ExtensionContext} context - Extension context for registering disposables
 */
export function registerRegenerateTitleCommand(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.regenerateTitle', async () => {
            const editor = vscode.window.activeNotebookEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active notebook editor.');
                return;
            }

            if (editor.notebook.notebookType !== 'mutsumi-notebook') {
                vscode.window.showWarningMessage('This command only works with Mutsumi notebooks.');
                return;
            }

            try {
                const messages = extractMessagesFromNotebook(editor.notebook);
                const config = getTitleGeneratorConfig();

                const adapter = new LiteAdapter();
                const liteConfig: LiteAgentSessionConfig = {
                    model: editor.notebook.metadata?.model,
                    metadata: editor.notebook.metadata 
                        ? JSON.parse(JSON.stringify(editor.notebook.metadata)) as AgentMetadata 
                        : undefined,
                    history: messages
                };
                const session = await adapter.createSession({
                    sessionId: editor.notebook.metadata?.uuid || editor.notebook.uri.toString(),
                    config: liteConfig
                });

                const title = await regenerateTitleForSession(session, messages, config, editor.notebook);
                vscode.window.showInformationMessage(`Title regenerated: ${title}`);
            } catch (error: any) {
                console.error('Failed to regenerate title:', error);
                vscode.window.showErrorMessage(`Failed to regenerate title: ${error.message}`);
            }
        })
    );
}
