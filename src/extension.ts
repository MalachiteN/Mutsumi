/**
 * @fileoverview Main extension entry point for Mutsumi VSCode extension.
 * @module extension
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { MutsumiSerializer } from './notebook/serializer';
import { AgentController } from './controller';
import { AgentSidebarProvider } from './sidebar/agentSidebar';
import { AgentOrchestrator } from './agentOrchestrator';
import { activateEditSupport } from './tools.d/edit_file';
import { AgentTreeItem } from './sidebar/agentTreeItem';
import { ReferenceCompletionProvider } from './notebook/completionProvider';
import { CodebaseService } from './codebase/service';
import { initializeRules } from './contextManagement/prompts';
import { ImagePasteProvider } from './contextManagement/imagePasteProvider';
import { buildInteractionHistory } from './contextManagement/history';
import { generateTitle, sanitizeFileName } from './utils';
import { AgentMessage } from './types';
import { ToolManager } from './toolManager';

/**
 * Checks if a file exists at the given URI.
 * @param {vscode.Uri} uri - URI to check
 * @returns {Promise<boolean>} True if the file exists
 * @example
 * const exists = await fileExists(uri);
 */
async function fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

/**
 * Activates the Mutsumi extension.
 * @description Registers all extension components including notebook serializer,
 * sidebar provider, controller, event listeners, commands, and completion providers.
 * @param {vscode.ExtensionContext} context - Extension context for registering disposables
 * @example
 * export function activate(context: vscode.ExtensionContext) {
 *   // Extension activation logic
 * }
 */
export function activate(context: vscode.ExtensionContext): void {
    // Initialize Codebase Service
    CodebaseService.getInstance().initialize(context).catch(console.error);

    // 1. Notebook Serializer
    context.subscriptions.push(
        vscode.workspace.registerNotebookSerializer(
            'mutsumi-notebook',
            new MutsumiSerializer(),
            { transientOutputs: true }
        )
    );

    // 2. Sidebar
    const sidebarProvider = new AgentSidebarProvider(context.extensionUri);
    sidebarProvider.registerTreeView(context);
    AgentOrchestrator.getInstance().setSidebar(sidebarProvider);

    // 3. Controller
    const agentController = new AgentController();
    const controller = vscode.notebooks.createNotebookController(
        'mutsumi-agent',
        'mutsumi-notebook',
        'Mutsumi Agent'
    );
    controller.supportedLanguages = ['markdown'];
    controller.supportsExecutionOrder = true;
    controller.executeHandler = (cells, notebook, ctrl) => {
        agentController.execute(cells, notebook, ctrl);
    };
    context.subscriptions.push(controller);

    AgentOrchestrator.getInstance().registerController(agentController, controller);

    // 4. Event Listeners for Agent Lifecycle
    context.subscriptions.push(
        vscode.workspace.onDidOpenNotebookDocument(doc => {
            if (doc.notebookType === 'mutsumi-notebook') {
                const uuid = doc.metadata.uuid;
                const model = doc.metadata.model;
                if (uuid) {
                    AgentOrchestrator.getInstance().notifyNotebookOpened(uuid, doc.uri, {
                        ...doc.metadata,
                        model: model
                    });
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidCloseNotebookDocument(doc => {
            if (doc.notebookType === 'mutsumi-notebook') {
                const uuid = doc.metadata.uuid;
                if (uuid) {
                    AgentOrchestrator.getInstance().notifyNotebookClosed(uuid);
                }
            }
        })
    );

    // Auto-rename on save based on metadata name
    let isAutoRenaming = false;
    context.subscriptions.push(
        vscode.workspace.onDidSaveNotebookDocument(async doc => {
            if (isAutoRenaming) {
                return;
            }
            if (doc.notebookType !== 'mutsumi-notebook') {
                return;
            }
            if (doc.uri.scheme !== 'file') {
                return;
            }

            const name = doc.metadata?.name;
            if (typeof name !== 'string' || !name.trim()) {
                return;
            }

            const sanitizedName = sanitizeFileName(name);
            if (!sanitizedName) {
                return;
            }

            const currentBaseName = path.basename(
                doc.uri.fsPath,
                path.extname(doc.uri.fsPath)
            );

            if (sanitizedName === currentBaseName) {
                return;
            }

            try {
                const dir = path.dirname(doc.uri.fsPath);
                let suffix = 0;
                let candidate = sanitizedName;
                let targetUri = vscode.Uri.file(path.join(dir, `${candidate}.mtm`));

                while (await fileExists(targetUri)) {
                    suffix += 1;
                    candidate = `${sanitizedName}-${suffix}`;
                    targetUri = vscode.Uri.file(path.join(dir, `${candidate}.mtm`));
                }

                isAutoRenaming = true;
                await vscode.workspace.fs.rename(doc.uri, targetUri, { overwrite: false });
            } catch (error) {
                console.error('Failed to auto-rename notebook:', error);
            } finally {
                isAutoRenaming = false;
            }
        })
    );

    // File deletion watcher
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.mtm');
    context.subscriptions.push(watcher);
    context.subscriptions.push(
        watcher.onDidDelete((uri) => {
            AgentOrchestrator.getInstance().notifyFileDeleted(uri);
        })
    );

    // Register completion provider for reference syntax
    const completionProvider = vscode.languages.registerCompletionItemProvider(
        'markdown',
        new ReferenceCompletionProvider(),
        '@'
    );
    context.subscriptions.push(completionProvider);

    // Register image paste support
    context.subscriptions.push(
        vscode.languages.registerDocumentPasteEditProvider(
            { language: 'markdown' },
            new ImagePasteProvider(),
            { 
                pasteMimeTypes: ['image/png', 'image/jpeg'],
                providedPasteEditKinds: [vscode.DocumentDropOrPasteEditKind.Text]
            }
        )
    );

    // 5. Commands
    registerCommands(context);

    activateEditSupport(context);
}

/**
 * Registers all extension commands.
 * @private
 * @param {vscode.ExtensionContext} context - Extension context
 */
function registerCommands(context: vscode.ExtensionContext): void {
    // New Agent command
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.newAgent', async () => {
            const wsFolders = vscode.workspace.workspaceFolders;
            if (!wsFolders) {
                vscode.window.showErrorMessage('Please open a workspace folder first.');
                return;
            }
            const root = wsFolders[0].uri;
            const agentDir = vscode.Uri.joinPath(root, '.mutsumi');
            try { 
                await vscode.workspace.fs.createDirectory(agentDir); 
            } catch {
                // Directory may already exist
            }

            await initializeRules(context.extensionUri, root);

            const name = `agent-${Date.now()}.mtm`;
            const newFileUri = vscode.Uri.joinPath(agentDir, name);
            const initialContent = MutsumiSerializer.createDefaultContent([root.fsPath]);
            
            await vscode.workspace.fs.writeFile(newFileUri, initialContent);
            await vscode.window.showNotebookDocument(
                await vscode.workspace.openNotebookDocument(newFileUri),
                { preview: false }
            );
        })
    );

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

            const config = vscode.workspace.getConfiguration('mutsumi');
            const apiKey = config.get<string>('apiKey');
            const baseUrl = config.get<string>('baseUrl');
            const titleModel = config.get<string>('titleGeneratorModel') || config.get<string>('defaultModel');

            if (!apiKey) {
                vscode.window.showErrorMessage('Please set mutsumi.apiKey in VSCode Settings.');
                return;
            }

            if (!titleModel) {
                vscode.window.showErrorMessage('Please set mutsumi.titleGeneratorModel or mutsumi.defaultModel in VSCode Settings.');
                return;
            }

            const messages: AgentMessage[] = [];
            for (const cell of editor.notebook.getCells()) {
                if (cell.kind === vscode.NotebookCellKind.Code) {
                    messages.push({ role: 'user', content: cell.document.getText() });
                    if (cell.metadata?.mutsumi_interaction) {
                        messages.push(...(cell.metadata.mutsumi_interaction as AgentMessage[]));
                    }
                }
            }

            if (messages.length === 0) {
                vscode.window.showWarningMessage('No conversation context found.');
                return;
            }

            try {
                const title = await generateTitle(messages, apiKey, baseUrl, titleModel);

                const edit = new vscode.WorkspaceEdit();
                const newMetadata = { ...editor.notebook.metadata, name: title };
                const nbEdit = vscode.NotebookEdit.updateNotebookMetadata(newMetadata);
                edit.set(editor.notebook.uri, [nbEdit]);
                await vscode.workspace.applyEdit(edit);

                vscode.window.showInformationMessage(`Title regenerated: ${title}`);
            } catch (error) {
                console.error('Failed to regenerate title:', error);
                vscode.window.showErrorMessage(`Failed to regenerate title: ${error}`);
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

    // Open agent file command
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.openAgentFile', async (item: AgentTreeItem) => {
            if (item && item.agentData && item.agentData.fileUri) {
                const uri = vscode.Uri.parse(item.agentData.fileUri);
                try {
                    const doc = await vscode.workspace.openNotebookDocument(uri);
                    await vscode.window.showNotebookDocument(doc, {
                        viewColumn: vscode.ViewColumn.Active,
                        preserveFocus: false,
                        preview: false
                    });
                } catch (e) {
                    vscode.window.showErrorMessage(`Failed to open agent file: ${e}`);
                }
            }
        })
    );

    // Copy reference command
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.copyReference', async (uri?: vscode.Uri) => {
            let targetUri = uri;
            let selection: vscode.Selection | undefined;
            let editor = vscode.window.activeTextEditor;

            if (!targetUri) {
                if (editor) {
                    targetUri = editor.document.uri;
                    selection = editor.selection;
                } else {
                    vscode.window.showErrorMessage('No file selected or active.');
                    return;
                }
            } else {
                if (editor && editor.document.uri.toString() === targetUri.toString()) {
                    selection = editor.selection;
                }
            }

            if (!targetUri) {
                return;
            }

            const workspaceFolder = vscode.workspace.getWorkspaceFolder(targetUri);
            let relativePath = targetUri.fsPath;
            if (workspaceFolder) {
                relativePath = path.relative(workspaceFolder.uri.fsPath, targetUri.fsPath).replace(/\\/g, '/');
            }

            let refString = '';

            if (selection && !selection.isEmpty && !selection.isSingleLine) {
                const start = selection.start.line + 1;
                const end = selection.end.line + 1;
                refString = `@[${relativePath}:${start}:${end}]`;
            } else if (selection) {
                const line = selection.active.line + 1;
                refString = `@[${relativePath}:${line}]`;
            } else {
                refString = `@[${relativePath}]`;
            }

            await vscode.env.clipboard.writeText(refString);
            vscode.window.setStatusBarMessage(`Copied reference: ${refString}`, 3000);
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

            const metadata = editor.notebook.metadata as any;
            const items: any[] = metadata.contextItems || [];
            const macroContext: Record<string, string> = metadata.macroContext || {};
            const macroEntries = Object.entries(macroContext);

            if (items.length === 0 && macroEntries.length === 0) {
                vscode.window.showInformationMessage('No context items found in this session.');
                return;
            }

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
                        item: { type: 'macro', key: name, content: `@{define ${name}, "${value}"}` }
                    });
                }
            }

            // Add Context Items section header if there are items
            if (items.length > 0) {
                if (macroEntries.length > 0) {
                    qpItems.push({
                        label: 'Context Items',
                        kind: vscode.QuickPickItemKind.Separator
                    });
                }

                for (const item of items) {
                    let icon = '$(file)';
                    if (item.type === 'rule') icon = '$(book)';
                    if (item.type === 'tool') icon = '$(tools)';
                    
                    qpItems.push({
                        label: `${icon} ${item.key}`,
                        description: item.type,
                        detail: item.content ? `${item.content.substring(0, 50).replace(/\n/g, ' ')}...` : '(empty)',
                        item: item
                    });
                }
            }

            const selected = await vscode.window.showQuickPick(qpItems, {
                placeHolder: 'Current Context Items (Files, Rules & Macros)',
                matchOnDetail: true
            });

            if (selected && selected.item) {
                const doc = await vscode.workspace.openTextDocument({
                    content: selected.item.content,
                    language: selected.item.type === 'rule' ? 'markdown' : undefined
                });
                await vscode.window.showTextDocument(doc, { preview: true });
            }
        })
    );

    // Recompile all skills command
    context.subscriptions.push(
        vscode.commands.registerCommand('mutsumi.recompileSkills', async () => {
            try {
                const { SkillManager } = await import('./skillManager');
                const skillManager = SkillManager.getInstance();
                await skillManager.recompileAllSkills();
                vscode.window.showInformationMessage('All skills recompiled successfully.');
            } catch (error) {
                console.error('Failed to recompile skills:', error);
                vscode.window.showErrorMessage(`Failed to recompile skills: ${error}`);
            }
        })
    );
}

/**
 * Deactivates the extension.
 * @description Cleanup function called when the extension is deactivated.
 */
export function deactivate(): void {}
