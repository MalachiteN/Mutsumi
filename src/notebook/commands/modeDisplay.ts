/**
 * @fileoverview Model selection command for Mutsumi notebook.
 * @module notebook/commands/selectModel
 */

import * as vscode from 'vscode';
import { t } from '../../i18n';

/**
 * Register the select model command.
 * @param {vscode.ExtensionContext} context - Extension context for registering disposables
 */
export function registerModeDisplayCommand(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.displayMode', async () => {
            const editor = vscode.window.activeNotebookEditor;
            if (!editor) {
                vscode.window.showWarningMessage(t('notebook.noEditor'));
                return;
            }

            if (editor.notebook.notebookType !== 'mutsumi-notebook') {
                vscode.window.showWarningMessage(t('notebook.onlyMutsumi'));
                return;
            }

            const notebook = editor.notebook;
            const metadata = notebook.metadata as { contextItems?: { content?: string }[] } | undefined;

            vscode.window.showInformationMessage(t('modeDisplay.currentMode', metadata?.contextItems?.[0]?.content || t('modeDisplay.unknown')),{ modal: true } );
        }));
}
