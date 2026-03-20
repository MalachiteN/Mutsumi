/**
 * @fileoverview Model selection command for Mutsumi notebook.
 * @module notebook/commands/selectModel
 */

import * as vscode from 'vscode';
import { getModelsConfig } from '../../utils';

/**
 * Register the select model command.
 * @param {vscode.ExtensionContext} context - Extension context for registering disposables
 */
export function registerSelectModelCommand(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.selectModel', async () => {
            const editor = vscode.window.activeNotebookEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active notebook editor.');
                return;
            }

            if (editor.notebook.notebookType !== 'mutsumi-notebook') {
                vscode.window.showWarningMessage('This command only works with Mutsumi notebooks.');
                return;
            }
            
            const modelsConfig = getModelsConfig();
            const modelNames = Object.keys(modelsConfig);
            
            if (modelNames.length === 0) {
                vscode.window.showErrorMessage('No models configured in settings.');
                return;
            }
            
            const currentModel = editor.notebook.metadata?.model;

            const items = modelNames.map(name => {
                const label = modelsConfig[name];
                const description = label ? `🏷️ ${label}` : undefined;
                const detail = name === currentModel ? '$(check) Current' : undefined;
                return {
                    label: name,
                    description,
                    detail,
                    picked: name === currentModel
                };
            });
            
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `Select model for this agent (current: ${currentModel || 'default'})`
            });
            
            if (selected) {
                // Use in-memory metadata as base to preserve unsaved changes
                const edit = new vscode.WorkspaceEdit();
                const newMetadata = { ...editor.notebook.metadata, model: selected.label };
                const nbEdit = vscode.NotebookEdit.updateNotebookMetadata(newMetadata);
                edit.set(editor.notebook.uri, [nbEdit]);
                await vscode.workspace.applyEdit(edit);
                
                vscode.window.showInformationMessage(`Model changed to: ${selected.label}`);
            }
        })
    );
}
