/**
 * @fileoverview Model selection command for Mutsumi notebook.
 * @module notebook/commands/selectModel
 */

import * as vscode from 'vscode';
import { normalizeReasoningEffort, REASONING_EFFORT_SETTING_VALUES } from '../../agent/types';
import type { ReasoningEffortSetting } from '../../agent/types';
import { getModelsConfig } from '../../utils';

/** QuickPick item representing a configured model. */
interface ModelQuickPickItem extends vscode.QuickPickItem {
    itemType: 'model';
    value: string;
}

/** QuickPick item representing a reasoning effort setting. */
interface ReasoningEffortQuickPickItem extends vscode.QuickPickItem {
    itemType: 'reasoningEffort';
    value: ReasoningEffortSetting;
}

/** Section separator used by the combined model and reasoning effort picker. */
interface SeparatorQuickPickItem extends vscode.QuickPickItem {
    itemType: 'separator';
    kind: vscode.QuickPickItemKind.Separator;
}

type SelectModelQuickPickItem = ModelQuickPickItem | ReasoningEffortQuickPickItem | SeparatorQuickPickItem;

/** Human-readable descriptions for concrete reasoning effort levels. */
const reasoningEffortDescriptions: Readonly<Record<Exclude<ReasoningEffortSetting, 'default'>, string>> = {
    none: 'Disable reasoning',
    minimal: 'Minimal reasoning',
    low: 'Low reasoning',
    medium: 'Medium reasoning',
    high: 'High reasoning',
    xhigh: 'Extra-high reasoning',
    max: 'Maximum reasoning'
};

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
            const effectiveReasoningEffort = normalizeReasoningEffort(
                editor.notebook.metadata?.reasoning_effort
            ) ?? 'default';

            const modelItems: ModelQuickPickItem[] = modelNames.map(name => {
                const label = modelsConfig[name];
                const description = label ? `🏷️ ${label}` : undefined;
                const detail = name === currentModel ? '$(check) Current' : undefined;
                return {
                    itemType: 'model',
                    value: name,
                    label: name,
                    description,
                    detail,
                    picked: name === currentModel
                };
            });

            const effortItems: ReasoningEffortQuickPickItem[] = REASONING_EFFORT_SETTING_VALUES.map(value => ({
                itemType: 'reasoningEffort',
                value,
                label: value,
                description: value === 'default'
                    ? "Don't send; server decides"
                    : reasoningEffortDescriptions[value],
                detail: value === effectiveReasoningEffort ? '$(check) Current' : undefined,
                picked: value === effectiveReasoningEffort
            }));

            const items: SelectModelQuickPickItem[] = [
                { itemType: 'separator', label: 'Models', kind: vscode.QuickPickItemKind.Separator },
                ...modelItems,
                { itemType: 'separator', label: 'Reasoning efforts', kind: vscode.QuickPickItemKind.Separator },
                ...effortItems
            ];

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: `Select model or reasoning effort (switching model resets effort to default; current: ${currentModel || 'default'} / ${effectiveReasoningEffort})`
            });

            if (!selected || selected.itemType === 'separator') {
                return;
            }

            // Use in-memory metadata as base to preserve unsaved changes.
            const newMetadata = { ...editor.notebook.metadata };
            if (selected.itemType === 'model') {
                newMetadata.model = selected.value;
                delete newMetadata.reasoning_effort;
            } else if (selected.value === 'default') {
                delete newMetadata.reasoning_effort;
            } else {
                newMetadata.reasoning_effort = selected.value;
            }

            const edit = new vscode.WorkspaceEdit();
            const nbEdit = vscode.NotebookEdit.updateNotebookMetadata(newMetadata);
            edit.set(editor.notebook.uri, [nbEdit]);
            await vscode.workspace.applyEdit(edit);

            if (selected.itemType === 'model') {
                vscode.window.showInformationMessage(
                    `Model changed to: ${selected.value}; reasoning effort reset to default.`
                );
            } else {
                vscode.window.showInformationMessage(`Reasoning effort changed to: ${selected.value}`);
            }
        })
    );
}
