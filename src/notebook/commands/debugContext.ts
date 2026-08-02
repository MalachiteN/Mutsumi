/**
 * @fileoverview Debug context command for Mutsumi notebook.
 * @module notebook/commands/debugContext
 */

import * as vscode from 'vscode';
import { buildInteractionHistory } from '../../contextManagement/history';
import { formatMessagesToString, createDebugSessionFromNotebook } from './utils';
import { t } from '../../i18n';

/**
 * Register the debug context command.
 * @param {vscode.ExtensionContext} context - Extension context for registering disposables
 */
export function registerDebugContextCommand(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.debugContext', async () => {
            const editor = vscode.window.activeNotebookEditor;
            if (!editor) {
                vscode.window.showWarningMessage(t('notebook.noEditor'));
                return;
            }

            if (editor.notebook.notebookType !== 'mutsumi-notebook') {
                vscode.window.showWarningMessage(t('notebook.onlyMutsumi'));
                return;
            }

            const cells = editor.notebook.getCells();
            let lastCodeCellIndex = -1;
            for (let i = cells.length - 1; i >= 0; i--) {
                if (cells[i].kind === vscode.NotebookCellKind.Code) {
                    lastCodeCellIndex = i;
                    break;
                }
            }

            if (lastCodeCellIndex === -1) {
                vscode.window.showWarningMessage(t('notebook.noCodeCell'));
                return;
            }

            try {
                const session = await createDebugSessionFromNotebook(editor.notebook, lastCodeCellIndex);
                const { messages } = await buildInteractionHistory(session);

                // Build content for temporary document
                let content = '=== Complete LLM Context Debug Output ===\n\n';
                content += `Notebook: ${editor.notebook.uri.path}\n`;
                content += `Last Executed Cell: ${lastCodeCellIndex}\n\n`;
                content += formatMessagesToString(messages, { includeHeader: true });
                content += '=== End of Context ===\n';

                // Create and show temporary document
                const doc = await vscode.workspace.openTextDocument({
                    content: content,
                    language: 'markdown'
                });
                await vscode.window.showTextDocument(doc, { preview: true });

                vscode.window.showInformationMessage(t('debugContext.displayed', messages.length));
            } catch (error) {
                console.error('Failed to debug context:', error);
                vscode.window.showErrorMessage(t('debugContext.failed', String(error)));
            }
        })
    );
}

export { formatMessagesToString, createDebugSessionFromNotebook } from './utils';
