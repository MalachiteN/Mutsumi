/**
 * @fileoverview Toolbar commands registration for Mutsumi notebook.
 * @module notebook/toolbar
 */

import * as vscode from 'vscode';
import { regenerateTitleForNotebook } from '../agent/titleGenerator';
import { buildInteractionHistory } from '../contextManagement/history';
import { toggleAutoApprove, isAutoApproveEnabled } from '../tools.d/permission';
import { SkillManager } from '../contextManagement/skillManager';

/**
 * Registers all toolbar-related commands for Mutsumi notebooks.
 * @param {vscode.ExtensionContext} context - Extension context for registering disposables
 */
export function registerToolbarCommands(context: vscode.ExtensionContext): void {
    // Model selection command
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
            
            const config = vscode.workspace.getConfiguration('mutsumi');
            const modelsConfig = config.get<Record<string, string>>('models', {});
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

    // Regenerate title command
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
                const title = await regenerateTitleForNotebook(editor.notebook);
                vscode.window.showInformationMessage(`Title regenerated: ${title}`);
            } catch (error: any) {
                console.error('Failed to regenerate title:', error);
                vscode.window.showErrorMessage(`Failed to regenerate title: ${error.message}`);
            }
        })
    );

    // Debug Context command
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.debugContext', async () => {
            const editor = vscode.window.activeNotebookEditor;
            if (!editor) {
                vscode.window.showWarningMessage('No active notebook editor.');
                return;
            }

            if (editor.notebook.notebookType !== 'mutsumi-notebook') {
                vscode.window.showWarningMessage('This command only works with Mutsumi notebooks.');
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
                vscode.window.showWarningMessage('No code cell found in notebook.');
                return;
            }

            const lastCell = cells[lastCodeCellIndex];
            const currentPrompt = lastCell.document.getText();

            try {
                const { messages } = await buildInteractionHistory(
                    editor.notebook,
                    lastCodeCellIndex,
                    currentPrompt
                );

                // Build content for temporary document
                let content = '=== Complete LLM Context Debug Output ===\n\n';
                content += `Total Messages: ${messages.length}\n`;
                content += `Notebook: ${editor.notebook.uri.path}\n`;
                content += `Last Executed Cell: ${lastCodeCellIndex}\n\n`;

                // Display all messages with their roles
                for (let i = 0; i < messages.length; i++) {
                    const msg = messages[i];
                    content += `--- Message ${i + 1} [${msg.role.toUpperCase()}] ---\n\n`;
                    
                    if (typeof msg.content === 'string') {
                        content += msg.content;
                    } else if (Array.isArray(msg.content)) {
                        // Handle multi-modal content (text + images)
                        for (const part of msg.content) {
                            if (part.type === 'text') {
                                content += part.text;
                            } else if (part.type === 'image_url') {
                                content += '[Image: ' + (part.image_url?.url?.substring(0, 50) || 'unknown') + '...]';
                            }
                            content += '\n';
                        }
                    }
                    
                    content += '\n\n';
                }

                content += '=== End of Context ===\n';

                // Create and show temporary document
                const doc = await vscode.workspace.openTextDocument({
                    content: content,
                    language: 'markdown'
                });
                await vscode.window.showTextDocument(doc, { preview: true });

                vscode.window.showInformationMessage(`Debug context displayed. Total messages: ${messages.length}`);
            } catch (error) {
                console.error('Failed to debug context:', error);
                vscode.window.showErrorMessage(`Failed to debug context: ${error}`);
            }
        })
    );

    // View Context command
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.viewContext', async () => {
            const editor = vscode.window.activeNotebookEditor;
            if (!editor || editor.notebook.notebookType !== 'mutsumi-notebook') {
                vscode.window.showWarningMessage('Please open a Mutsumi notebook first.');
                return;
            }

            const quickPick = vscode.window.createQuickPick();
            quickPick.placeholder = 'Current Context Files & Macros';
            quickPick.matchOnDetail = true;

            const updateItems = () => {
                const metadata = editor.notebook.metadata as any;
                // 只过滤出 files
                const items: any[] = (metadata.contextItems || []).filter((item: any) => item.type === 'file');
                const macroContext: Record<string, string> = metadata.macroContext || {};
                const macroEntries = Object.entries(macroContext);

                const qpItems: any[] = [];

                // Add Macros section header if there are macros
                if (macroEntries.length > 0) {
                    qpItems.push({
                        label: 'Macros',
                        kind: vscode.QuickPickItemKind.Separator
                    });
                    
                    for (const [name, value] of macroEntries) {
                        qpItems.push({
                            label: `    $(symbol-field) ${name}`,
                            description: 'macro',
                            detail: `"${value}"`,
                            // Macros are not removable via this UI currently
                            item: { type: 'macro', key: name, content: `@{define ${name}, "${value}"}` }
                        } as any);
                    }
                }

                // 只显示 Files（不再显示 rules 和 tools）
                if (items.length > 0) {
                    if (macroEntries.length > 0) {
                        qpItems.push({
                            label: 'Files',
                            kind: vscode.QuickPickItemKind.Separator
                        });
                    }

                    for (const item of items) {
                        // item.type 应该都是 'file'，使用文件图标
                        const icon = '$(file)';
                        
                        const qpItem: any = {
                            label: `${icon} ${item.key}`,
                            description: item.type,
                            detail: item.content ? `${item.content.substring(0, 50).replace(/\n/g, ' ')}...` : '(empty)',
                            item: item
                        };

                        // 添加移除按钮
                        qpItem.buttons = [{
                            iconPath: new vscode.ThemeIcon('close'),
                            tooltip: 'Remove from context'
                        }];

                        qpItems.push(qpItem);
                    }
                }
                
                quickPick.items = qpItems;
            };

            updateItems();

            quickPick.onDidTriggerItemButton(async (e) => {
                const itemToRemove = (e.item as any).item;
                if (!itemToRemove) return;

                const metadata = editor.notebook.metadata as any;
                const currentItems: any[] = metadata.contextItems || [];
                
                // Filter out the item
                const newItems = currentItems.filter(i => 
                    !(i.type === itemToRemove.type && i.key === itemToRemove.key)
                );

                const edit = new vscode.WorkspaceEdit();
                const newMetadata = { ...metadata, contextItems: newItems };
                const nbEdit = vscode.NotebookEdit.updateNotebookMetadata(newMetadata);
                edit.set(editor.notebook.uri, [nbEdit]);
                
                await vscode.workspace.applyEdit(edit);
                
                // Refresh list
                updateItems();
            });

            quickPick.onDidChangeSelection(async (selection) => {
                if (selection[0] && (selection[0] as any).item) {
                    const item = (selection[0] as any).item;
                    const doc = await vscode.workspace.openTextDocument({
                        content: item.content,
                        language: 'markdown'
                    });
                    await vscode.window.showTextDocument(doc, { preview: true });
                    quickPick.hide();
                }
            });

            quickPick.onDidHide(() => quickPick.dispose());
            quickPick.show();
        })
    );

    // Select Rules command
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.selectRules', async () => {
            const editor = vscode.window.activeNotebookEditor;
            if (!editor || editor.notebook.notebookType !== 'mutsumi-notebook') {
                vscode.window.showWarningMessage('Please open a Mutsumi notebook first.');
                return;
            }

            const wsFolders = vscode.workspace.workspaceFolders;
            if (!wsFolders) {
                vscode.window.showErrorMessage('No workspace folder open.');
                return;
            }
            const root = wsFolders[0].uri;
            const rulesDir = vscode.Uri.joinPath(root, '.mutsumi', 'rules');

            let allRules: string[] = [];
            try {
                const entries = await vscode.workspace.fs.readDirectory(rulesDir);
                allRules = entries
                    .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.md'))
                    .map(([name]) => name);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to read rules directory: ${error}`);
                return;
            }

            if (allRules.length === 0) {
                vscode.window.showInformationMessage('No rules found in .mutsumi/rules.');
                return;
            }

            const currentActiveRules = (editor.notebook.metadata as any).activeRules;
            
            // If activeRules is undefined, it means ALL are active (legacy/default behavior)
            // So we mark all as picked.
            const items = allRules.map(rule => ({
                label: rule,
                picked: currentActiveRules ? currentActiveRules.includes(rule) : true
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select active rules for this agent',
                canPickMany: true
            });

            if (selected) {
                const newActiveRules = selected.map(i => i.label);
                
                const edit = new vscode.WorkspaceEdit();
                const newMetadata = { ...editor.notebook.metadata, activeRules: newActiveRules };
                const nbEdit = vscode.NotebookEdit.updateNotebookMetadata(newMetadata);
                edit.set(editor.notebook.uri, [nbEdit]);
                
                await vscode.workspace.applyEdit(edit);
                vscode.window.showInformationMessage(`Active rules updated (${newActiveRules.length} active).`);
            }
        })
    );

    // Recompile all skills command
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.recompileSkills', async () => {
            try {
                const skillManager = SkillManager.getInstance();
                await skillManager.recompileAllSkills();
                vscode.window.showInformationMessage('All skills recompiled successfully.');
            } catch (error) {
                console.error('Failed to recompile skills:', error);
                vscode.window.showErrorMessage(`Failed to recompile skills: ${error}`);
            }
        })
    );

    // Toggle auto approve command (OFF -> ON)
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.toggleAutoApprove', async () => {
            try {
                const newState = await toggleAutoApprove();
                // Update global state for UI refresh (this controls icon visibility)
                await vscode.commands.executeCommand('setContext', 'mutsumi:autoApproveEnabled', newState);
                
                if (newState) {
                    vscode.window.showWarningMessage('Auto-approve mode is now ON. Tools will be executed without confirmation.');
                } else {
                    vscode.window.showInformationMessage('Auto-approve mode is now OFF. Tools will require confirmation.');
                }
            } catch (error) {
                console.error('Failed to toggle auto-approve:', error);
                vscode.window.showErrorMessage(`Failed to toggle auto-approve: ${error}`);
            }
        })
    );

    // Toggle auto approve command (ON -> OFF) - same command but different icon
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.toggleAutoApproveOn', async () => {
            try {
                const newState = await toggleAutoApprove();
                // Update global state for UI refresh (this controls icon visibility)
                await vscode.commands.executeCommand('setContext', 'mutsumi:autoApproveEnabled', newState);
                
                if (newState) {
                    vscode.window.showWarningMessage('Auto-approve mode is now ON. Tools will be executed without confirmation.');
                } else {
                    vscode.window.showInformationMessage('Auto-approve mode is now OFF. Tools will require confirmation.');
                }
            } catch (error) {
                console.error('Failed to toggle auto-approve:', error);
                vscode.window.showErrorMessage(`Failed to toggle auto-approve: ${error}`);
            }
        })
    );

    // Set initial context for auto-approve state
    void vscode.commands.executeCommand('setContext', 'mutsumi:autoApproveEnabled', isAutoApproveEnabled());
}
