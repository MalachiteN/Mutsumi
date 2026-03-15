/**
 * @fileoverview Toolbar commands registration for Mutsumi notebook.
 * @module notebook/toolbar
 */

import * as vscode from 'vscode';
import { regenerateTitleForSession, extractMessagesFromNotebook, getTitleGeneratorConfig } from '../agent/titleGenerator';
import { LiteAdapter, LiteAgentSessionConfig } from '../adapters/liteAdapter';
import { AgentOrchestrator } from '../agent/agentOrchestrator';
import { buildInteractionHistory } from '../contextManagement/history';
import { toggleAutoApprove, isAutoApproveEnabled } from '../tools.d/permission';
import { RagService } from '../codebase/rag/service';

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
                const messages = extractMessagesFromNotebook(editor.notebook);
                const config = getTitleGeneratorConfig();

                const adapter = new LiteAdapter();
                const liteConfig: LiteAgentSessionConfig = {
                    model: editor.notebook.metadata?.model,
                    metadata: editor.notebook.metadata 
                        ? JSON.parse(JSON.stringify(editor.notebook.metadata)) as any 
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

    // Helper: Get all available rules from .mutsumi/rules directory
    async function getAvailableRules(): Promise<string[]> {
        const wsFolders = vscode.workspace.workspaceFolders;
        if (!wsFolders) return [];
        
        const root = wsFolders[0].uri;
        const rulesDir = vscode.Uri.joinPath(root, '.mutsumi', 'rules');

        try {
            const entries = await vscode.workspace.fs.readDirectory(rulesDir);
            return entries
                .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.md'))
                .map(([name]) => name);
        } catch {
            return [];
        }
    }

    // Helper: Save active rules to notebook metadata
    async function saveActiveRules(editor: vscode.NotebookEditor, rules: string[]): Promise<void> {
        const edit = new vscode.WorkspaceEdit();
        const newMetadata = { ...editor.notebook.metadata, activeRules: rules };
        const nbEdit = vscode.NotebookEdit.updateNotebookMetadata(newMetadata);
        edit.set(editor.notebook.uri, [nbEdit]);
        await vscode.workspace.applyEdit(edit);
    }

    // View Context command (Unified: Rules + Macros + Files)
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.viewContext', async () => {
            const editor = vscode.window.activeNotebookEditor;
            if (!editor || editor.notebook.notebookType !== 'mutsumi-notebook') {
                vscode.window.showWarningMessage('Please open a Mutsumi notebook first.');
                return;
            }

            const quickPick = vscode.window.createQuickPick();
            quickPick.placeholder = 'Click to toggle rules, click items to view, use × to remove';
            quickPick.matchOnDetail = true;
            
            // Add save button to the title bar
            quickPick.buttons = [
                {
                    iconPath: new vscode.ThemeIcon('save'),
                    tooltip: 'Save Rule Selections'
                }
            ];

            // Load all rules
            const allRules = await getAvailableRules();
            const metadata = editor.notebook.metadata as any;
            const currentActiveRules: string[] = metadata.activeRules || allRules;
            const hasRules = allRules.length > 0;

            // Track which rules are selected (for UI state)
            let selectedRules = new Set<string>(currentActiveRules);
            let hasUnsavedRuleChanges = false;

            const updateItems = () => {
                const items: any[] = (metadata.contextItems || []).filter((item: any) => item.type === 'file');
                const macroContext: Record<string, string> = metadata.macroContext || {};
                const macroEntries = Object.entries(macroContext);

                const qpItems: any[] = [];

                // === SECTION 1: RULES (Top section with checkbox behavior) ===
                if (hasRules) {
                    qpItems.push({
                        label: 'Rules',
                        kind: vscode.QuickPickItemKind.Separator
                    });

                    for (const rule of allRules) {
                        const isSelected = selectedRules.has(rule);
                        const checkboxIcon = isSelected ? '$(star-full)' : '$(star-empty)';
                        
                        const qpItem: any = {
                            label: `${checkboxIcon} ${rule}`,
                            description: 'rule',
                            detail: isSelected ? 'Active (click to disable)' : 'Inactive (click to enable)',
                            kind: isSelected ? undefined : vscode.QuickPickItemKind.Default,
                            item: { type: 'rule', key: rule, isToggleable: true }
                        };
                        qpItems.push(qpItem);
                    }
                }

                // === SECTION 2: MACROS (Middle section with remove button) ===
                if (macroEntries.length > 0) {
                    qpItems.push({
                        label: 'Macros',
                        kind: vscode.QuickPickItemKind.Separator
                    });
                    
                    for (const [name, value] of macroEntries) {
                        const qpItem: any = {
                            label: `$(symbol-field) ${name}`,
                            description: 'macro',
                            detail: `"${value}"`,
                            item: { type: 'macro', key: name, content: `@{define ${name}, "${value}"}` }
                        };

                        // Add view and remove buttons for macros
                        qpItem.buttons = [
                            {
                                iconPath: new vscode.ThemeIcon('open-preview'),
                                tooltip: 'View macro definition'
                            },
                            {
                                iconPath: new vscode.ThemeIcon('close'),
                                tooltip: 'Remove macro'
                            }
                        ];

                        qpItems.push(qpItem);
                    }
                }

                // === SECTION 3: FILES (Bottom section with view and remove button) ===
                if (items.length > 0) {
                    qpItems.push({
                        label: 'Files',
                        kind: vscode.QuickPickItemKind.Separator
                    });

                    for (const item of items) {
                        const qpItem: any = {
                            label: `$(file) ${item.key}`,
                            description: item.type,
                            detail: item.content ? `${item.content.substring(0, 50).replace(/\n/g, ' ')}...` : '(empty)',
                            item: item
                        };

                        // Add view and remove buttons for files
                        qpItem.buttons = [
                            {
                                iconPath: new vscode.ThemeIcon('open-preview'),
                                tooltip: 'View file content'
                            },
                            {
                                iconPath: new vscode.ThemeIcon('close'),
                                tooltip: 'Remove from context'
                            }
                        ];

                        qpItems.push(qpItem);
                    }
                }

                // Show save hint if there are unsaved rule changes
                if (hasUnsavedRuleChanges) {
                    qpItems.push({
                        label: '',
                        kind: vscode.QuickPickItemKind.Separator
                    });
                    qpItems.push({
                        label: '$(save) Click save button above to apply rule changes',
                        description: 'unsaved',
                        item: { type: 'hint' }
                    });
                }
                
                quickPick.items = qpItems;
            };

            updateItems();

            // Handle save button click
            quickPick.onDidTriggerButton(async (button) => {
                if (button.tooltip === 'Save Rule Selections') {
                    const newActiveRules = Array.from(selectedRules);
                    await saveActiveRules(editor, newActiveRules);
                    hasUnsavedRuleChanges = false;
                    updateItems();
                    vscode.window.showInformationMessage(`Active rules updated (${newActiveRules.length} active).`);
                }
            });

            // Handle item button clicks (view/remove)
            quickPick.onDidTriggerItemButton(async (e) => {
                const itemData = (e.item as any).item;
                if (!itemData) return;

                const buttonIndex = quickPick.items.indexOf(e.item);
                const buttons = (e.item as any).buttons || [];
                const buttonIdx = buttons.findIndex((b: any) => b.tooltip === e.button.tooltip);

                // Handle Rules toggle (first button area click on rule items)
                if (itemData.isToggleable) {
                    // Toggle rule selection
                    if (selectedRules.has(itemData.key)) {
                        selectedRules.delete(itemData.key);
                    } else {
                        selectedRules.add(itemData.key);
                    }
                    hasUnsavedRuleChanges = true;
                    updateItems();
                    return;
                }

                // Handle view button click (first button)
                if (buttonIdx === 0 && itemData.content !== undefined) {
                    const doc = await vscode.workspace.openTextDocument({
                        content: itemData.content,
                        language: 'markdown'
                    });
                    await vscode.window.showTextDocument(doc, { preview: true });
                    return;
                }

                // Handle remove button click (second button for macros and files)
                if (buttonIdx === 1 || (itemData.type === 'macro' && buttonIdx === 1) || itemData.type === 'file') {
                    if (itemData.type === 'macro') {
                        // Remove macro
                        const macroContext: Record<string, string> = { ...metadata.macroContext };
                        delete macroContext[itemData.key];
                        
                        const edit = new vscode.WorkspaceEdit();
                        const newMetadata = { ...metadata, macroContext };
                        const nbEdit = vscode.NotebookEdit.updateNotebookMetadata(newMetadata);
                        edit.set(editor.notebook.uri, [nbEdit]);
                        await vscode.workspace.applyEdit(edit);
                        
                        // Update metadata reference
                        metadata.macroContext = macroContext;
                        updateItems();
                        vscode.window.showInformationMessage(`Macro "${itemData.key}" removed.`);
                    } else if (itemData.type === 'file') {
                        // Remove file from contextItems
                        const currentItems: any[] = metadata.contextItems || [];
                        const newItems = currentItems.filter(i => 
                            !(i.type === itemData.type && i.key === itemData.key)
                        );

                        const edit = new vscode.WorkspaceEdit();
                        const newMetadata = { ...metadata, contextItems: newItems };
                        const nbEdit = vscode.NotebookEdit.updateNotebookMetadata(newMetadata);
                        edit.set(editor.notebook.uri, [nbEdit]);
                        await vscode.workspace.applyEdit(edit);
                        
                        // Update metadata reference
                        metadata.contextItems = newItems;
                        updateItems();
                    }
                }
            });

            // Handle item selection (click on item itself)
            quickPick.onDidChangeSelection(async (selection) => {
                if (!selection[0]) return;
                
                const itemData = (selection[0] as any).item;
                if (!itemData || itemData.type === 'hint') return;

                // Handle rule toggle on selection
                if (itemData.isToggleable) {
                    if (selectedRules.has(itemData.key)) {
                        selectedRules.delete(itemData.key);
                    } else {
                        selectedRules.add(itemData.key);
                    }
                    hasUnsavedRuleChanges = true;
                    updateItems();
                    return;
                }

                // For macros and files, view content on selection
                if (itemData.content !== undefined) {
                    const doc = await vscode.workspace.openTextDocument({
                        content: itemData.content,
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

    // Sync toolbar context when auto-approve config changes (cross-window update)
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('mutsumi.autoApproveEnabled')) {
                void vscode.commands.executeCommand(
                    'setContext',
                    'mutsumi:autoApproveEnabled',
                    isAutoApproveEnabled()
                );
            }
        })
    );

    // Test RAG Search command
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.testRagSearch', async () => {
            // 获取查询输入
            const query = await vscode.window.showInputBox({
                prompt: 'Enter natural language query for RAG search',
                placeHolder: 'e.g., "how to handle file operations"',
                ignoreFocusOut: true
            });

            if (!query || !query.trim()) {
                vscode.window.showInformationMessage('Search cancelled or empty query.');
                return;
            }

            try {
                const ragService = await RagService.getInstance(context);
                const workspaces = vscode.workspace.workspaceFolders;

                if (!workspaces || workspaces.length === 0) {
                    vscode.window.showWarningMessage('No workspace folders open.');
                    return;
                }

                // 构建内容
                let content = '=== RAG Search Results ===\n\n';
                content += `Query: "${query}"\n`;
                content += `Workspaces searched: ${workspaces.length}\n\n`;

                // 从每个工作区搜索
                for (const ws of workspaces) {
                    content += `--- Workspace: ${ws.name} (${ws.uri.toString()}) ---\n\n`;
                    
                    try {
                        const results = await ragService.search(ws.uri, query, 5);
                        
                        if (results.length === 0) {
                            content += '(No results found)\n';
                        } else {
                            for (let i = 0; i < results.length; i++) {
                                const r = results[i];
                                content += `[${i + 1}] ${r.filePath}`;
                                if (r.symbolName) {
                                    content += ` :: ${r.symbolName}`;
                                }
                                content += ` (lines ${r.startLine}-${r.endLine}, distance: ${r.distance.toFixed(4)})\n`;
                                content += '```\n';
                                content += r.text.substring(0, 500);
                                if (r.text.length > 500) {
                                    content += '\n...(truncated)';
                                }
                                content += '\n```\n\n';
                            }
                        }
                    } catch (err: any) {
                        content += `(Error: ${err.message})\n`;
                    }
                    
                    content += '\n';
                }

                content += '=== End of Results ===\n';

                // 创建并显示临时文档
                const doc = await vscode.workspace.openTextDocument({
                    content: content,
                    language: 'markdown'
                });
                await vscode.window.showTextDocument(doc, { preview: true });

                vscode.window.showInformationMessage(`RAG search completed across ${workspaces.length} workspace(s).`);
            } catch (error: any) {
                console.error('RAG search failed:', error);
                vscode.window.showErrorMessage(`RAG search failed: ${error.message}`);
            }
        })
    );
}
